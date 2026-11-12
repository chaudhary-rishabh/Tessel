#!/usr/bin/env bash
# Deploys one image tag on the EC2 host. Run from /opt/tessel by the deploy
# workflow (over AWS Systems Manager), or by hand for a rollback:
#
#   sudo /opt/tessel/deploy.sh <image-tag>
#
# Reads compose settings from deploy.env. Writes app secrets to .env from
# SSM Parameter Store (every parameter under $SSM_PATH becomes NAME=value).
set -euo pipefail

cd "$(dirname "$0")"
TAG=${1:?usage: deploy.sh <image-tag>}

if [[ ! -f deploy.env ]]; then
  echo "deploy.env is missing in $(pwd)" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source deploy.env
set +a
: "${ECR_REGISTRY:?set ECR_REGISTRY in deploy.env}"
: "${AWS_REGION:?set AWS_REGION in deploy.env}"
SSM_PATH=${SSM_PATH:-/tessel/prod}
export COMPOSE_PROFILES=${COMPOSE_PROFILES:-edge,data}
if [[ ",$COMPOSE_PROFILES," == *",edge,"* ]]; then
  for name in WEB_DOMAIN API_DOMAIN MCP_DOMAIN ADMIN_DOMAIN ACME_EMAIL; do
    if [[ -z "${!name:-}" ]]; then
      echo "$name must be set in deploy.env when the edge profile is on" >&2
      exit 1
    fi
  done
fi

# Caddy serves the web app's domain only when the web app runs on this host.
# Otherwise (the web app on Vercel) it would keep asking Let's Encrypt for a
# certificate for a domain that points somewhere else.
mkdir -p caddy-sites
rm -f caddy-sites/web.caddy
if [[ ",$COMPOSE_PROFILES," == *",web,"* ]]; then
  cat >caddy-sites/web.caddy <<'CADDY'
{$WEB_DOMAIN} {
	import common
	reverse_proxy web:3000
}
CADDY
fi

compose() {
  local files=(--file docker-compose.prod.yml)
  [[ -f docker-compose.logs.yml ]] && files+=(--file docker-compose.logs.yml)
  IMAGE_TAG=$1 docker compose "${files[@]}" --env-file deploy.env "${@:2}"
}

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

# With LOG_GROUP set, every container logs to CloudWatch instead of local files.
# The override replaces each service's logging block, so Compose recreates the
# containers whose logging changed.
rm -f docker-compose.logs.yml
if [[ -n "${LOG_GROUP:-}" ]]; then
  log "Sending container logs to CloudWatch log group $LOG_GROUP"
  {
    echo "services:"
    for service in $(IMAGE_TAG=unused docker compose --file docker-compose.prod.yml --env-file deploy.env --profile tools config --services); do
      cat <<YAML
  $service:
    logging: !override
      driver: awslogs
      options:
        awslogs-region: "$AWS_REGION"
        awslogs-group: "$LOG_GROUP"
        tag: "{{.Name}}"
        mode: non-blocking
        max-buffer-size: 4m
YAML
    done
  } >docker-compose.logs.yml
fi

log "Loading secrets from SSM ${SSM_PATH}"
umask 077
aws ssm get-parameters-by-path \
  --region "$AWS_REGION" \
  --path "$SSM_PATH" \
  --recursive \
  --with-decryption \
  --query 'Parameters[*].[Name,Value]' \
  --output text |
  while IFS=$'\t' read -r name value; do
    printf '%s=%s\n' "${name##*/}" "$value"
  done >.env.next
if [[ ! -s .env.next ]]; then
  echo "No parameters found under $SSM_PATH" >&2
  exit 1
fi
mv .env.next .env
# Database containers get only their own secret, not every app variable.
grep -E '^POSTGRES_PASSWORD=' .env >postgres.env || true
grep -E '^NEO4J_AUTH=' .env >neo4j.env || true

log "Logging in to ECR"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null

PREVIOUS=$(cat .deployed-tag 2>/dev/null || true)

log "Pulling images for $TAG"
compose "$TAG" --profile tools pull --quiet

DATA_SERVICES=$(compose "$TAG" config --services | grep -E '^(postgres|redis-cache|redis-queue|qdrant|neo4j)$' || true)
if [[ -n "$DATA_SERVICES" ]]; then
  log "Starting data services"
  # shellcheck disable=SC2086
  compose "$TAG" up --detach --wait --wait-timeout 300 $DATA_SERVICES
fi

if [[ -n "$DATA_SERVICES" && -n "${BACKUP_BUCKET:-}" ]]; then
  log "Scheduling nightly backups (Postgres and the search index) to s3://$BACKUP_BUCKET"
  cat >/etc/systemd/system/tessel-backup.service <<UNIT
[Unit]
Description=Back up Tessel's Postgres and Qdrant to S3
[Service]
Type=oneshot
ExecStart=$(pwd)/backup.sh
UNIT
  cat >/etc/systemd/system/tessel-backup.timer <<UNIT
[Unit]
Description=Nightly Tessel backup
[Timer]
OnCalendar=*-*-* 21:00:00 UTC
RandomizedDelaySec=30m
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now tessel-backup.timer >/dev/null
fi

log "Running database migrations"
compose "$TAG" --profile tools run --rm migrate

# Migrations run before the new version starts, so they must stay compatible
# with the version currently running (add columns, don't rename or drop them).
# Healthy containers only prove the processes run; readiness proves the API
# reaches Postgres, Redis, S3, SQS, Qdrant, and Neo4j with this version's settings.
ready() {
  for _ in $(seq 1 30); do
    compose "$TAG" exec -T api wget -qO- http://127.0.0.1:4000/health/ready >/dev/null 2>&1 && return 0
    sleep 2
  done
  log "The API isn't ready:"
  compose "$TAG" exec -T api wget -qO- --content-on-error http://127.0.0.1:4000/health/ready || true
  return 1
}

log "Starting the new version"
if compose "$TAG" up --detach --wait --wait-timeout 300 --remove-orphans && ready; then
  echo "$TAG" >.deployed-tag
  if [[ ",$COMPOSE_PROFILES," == *",edge,"* ]]; then
    # Caddy reads its config at start; a running Caddy needs a reload to pick up
    # a changed Caddyfile or web site file.
    compose "$TAG" exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null ||
      log "Caddy didn't reload its config; it keeps the previous one"
  fi
  log "Deployed $TAG"
else
  log "New version failed its health or readiness checks"
  compose "$TAG" ps
  compose "$TAG" logs --tail 50 || true
  if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$TAG" ]]; then
    log "Rolling back to $PREVIOUS"
    compose "$PREVIOUS" up --detach --wait --wait-timeout 300 --remove-orphans
  fi
  exit 1
fi

log "Removing images older than a week"
docker image prune --all --force --filter "until=168h" >/dev/null || true
