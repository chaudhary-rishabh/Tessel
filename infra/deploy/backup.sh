#!/usr/bin/env bash
# Backs up the on-host Postgres (data profile) to S3. deploy.sh installs a
# systemd timer that runs this nightly when BACKUP_BUCKET is set.
#
#   sudo /opt/tessel/backup.sh
#
# Keep backups for as long as you need with an S3 lifecycle rule on the
# postgres/ prefix (see infra/aws/README.md). Not needed with RDS, which has
# its own automated backups.
set -euo pipefail

cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
source deploy.env
set +a
: "${BACKUP_BUCKET:?set BACKUP_BUCKET in deploy.env}"
: "${AWS_REGION:?set AWS_REGION in deploy.env}"
TAG=$(cat .deployed-tag)

key="postgres/tessel-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
echo "Backing up Postgres to s3://$BACKUP_BUCKET/$key"
# Custom format is compressed and lets pg_restore restore selectively.
IMAGE_TAG=$TAG docker compose --file docker-compose.prod.yml --env-file deploy.env \
  exec -T postgres pg_dump --username tessel --dbname tessel --format custom |
  aws s3 cp - "s3://$BACKUP_BUCKET/$key" --region "$AWS_REGION" --sse AES256 --only-show-errors
echo "Backup complete"
