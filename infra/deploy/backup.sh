#!/usr/bin/env bash
# Backs up the on-host Postgres and the Qdrant search index (data profile) to
# S3. deploy.sh installs a systemd timer that runs this nightly when
# BACKUP_BUCKET is set.
#
#   sudo /opt/tessel/backup.sh
#
# Keep backups for as long as you need with an S3 lifecycle rule on the
# postgres/ and qdrant/ prefixes (see infra/aws/README.md). Not needed with
# RDS, which has its own automated backups. The search index can also be
# rebuilt from the files in S3 by re-indexing, so its backup only saves time.
set -euo pipefail

cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
source deploy.env
set +a
: "${BACKUP_BUCKET:?set BACKUP_BUCKET in deploy.env}"
: "${AWS_REGION:?set AWS_REGION in deploy.env}"
TAG=$(cat .deployed-tag)
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)

compose() { IMAGE_TAG=$TAG docker compose --file docker-compose.prod.yml --env-file deploy.env "$@"; }
running() { compose ps --status running --services | grep -qx "$1"; }
# Each backup is written to a local file and checked before it's uploaded, so a
# dump that fails halfway never lands in S3 looking like a good backup.
WORK=$(mktemp -d /var/tmp/tessel-backup.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
upload() { aws s3 cp "$1" "s3://$BACKUP_BUCKET/$2" --region "$AWS_REGION" --sse AES256 --only-show-errors; }

if running postgres; then
  key="postgres/tessel-$STAMP.dump"
  echo "Backing up Postgres to s3://$BACKUP_BUCKET/$key"
  # Custom format is compressed and lets pg_restore restore selectively.
  compose exec -T postgres pg_dump --username tessel --dbname tessel --format custom >"$WORK/postgres.dump"
  # pg_restore can only list a complete archive.
  compose exec -T postgres pg_restore --list <"$WORK/postgres.dump" >/dev/null
  upload "$WORK/postgres.dump" "$key"
fi

if running qdrant && running api; then
  key="qdrant/tessel-$STAMP.snapshot"
  echo "Backing up the search index to s3://$BACKUP_BUCKET/$key"
  # A full-storage snapshot, streamed out through the API container (which can
  # reach Qdrant and has its address and key), then deleted from the volume.
  compose exec -T api node --input-type=module -e '
    import { Readable } from "node:stream";
    const base = process.env.QDRANT_URL.replace(/\/$/, "");
    const headers = process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {};
    const call = async (method, path) => {
      const res = await fetch(base + path, { method, headers });
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
      return res;
    };
    const { result } = await (await call("POST", "/snapshots?wait=true")).json();
    const download = await call("GET", `/snapshots/${result.name}`);
    await new Promise((resolve, reject) =>
      Readable.fromWeb(download.body).on("error", reject).pipe(process.stdout).on("finish", resolve),
    );
    await call("DELETE", `/snapshots/${result.name}`);
  ' >"$WORK/qdrant.snapshot"
  # A snapshot is a tar archive; a cut-off one can't be listed.
  tar -tf "$WORK/qdrant.snapshot" >/dev/null
  upload "$WORK/qdrant.snapshot" "$key"
fi

echo "Backup complete"
