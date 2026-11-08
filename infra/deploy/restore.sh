#!/usr/bin/env bash
# Restores a Postgres backup made by backup.sh. Stops the apps while it runs.
#
#   sudo /opt/tessel/restore.sh postgres/tessel-2026-11-08T203000Z.dump
#
# List backups with: aws s3 ls s3://$BACKUP_BUCKET/postgres/
set -euo pipefail

cd "$(dirname "$0")"
KEY=${1:?usage: restore.sh <s3-key>}
set -a
# shellcheck disable=SC1091
source deploy.env
set +a
: "${BACKUP_BUCKET:?set BACKUP_BUCKET in deploy.env}"
TAG=$(cat .deployed-tag)
compose() { IMAGE_TAG=$TAG docker compose --file docker-compose.prod.yml --env-file deploy.env "$@"; }

echo "Stopping the apps"
compose stop api worker mcp-server

echo "Restoring s3://$BACKUP_BUCKET/$KEY"
aws s3 cp "s3://$BACKUP_BUCKET/$KEY" - --region "$AWS_REGION" --only-show-errors |
  compose exec -T postgres pg_restore --username tessel --dbname tessel --clean --if-exists --no-owner

echo "Starting the apps"
compose up --detach --wait --wait-timeout 180 api worker mcp-server
echo "Restore complete"
