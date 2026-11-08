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
  for name in WEB_DOMAIN API_DOMAIN MCP_DOMAIN ACME_EMAIL; do
    if [[ -z "${!name:-}" ]]; then
      echo "$name must be set in deploy.env when the edge profile is on" >&2
      exit 1
    fi
  done
fi

compose() {
  IMAGE_TAG=$1 docker compose --file docker-compose.prod.yml --env-file deploy.env "${@:2}"
}

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

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

log "Running database migrations"
compose "$TAG" --profile tools run --rm migrate

# Migrations run before the new version starts, so they must stay compatible
# with the version currently running (add columns, don't rename or drop them).
log "Starting the new version"
if compose "$TAG" up --detach --wait --wait-timeout 300 --remove-orphans; then
  echo "$TAG" >.deployed-tag
  log "Deployed $TAG"
else
  log "New version failed its health checks"
  compose "$TAG" ps
  compose "$TAG" logs --tail 50 api worker mcp-server web || true
  if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$TAG" ]]; then
    log "Rolling back to $PREVIOUS"
    compose "$PREVIOUS" up --detach --wait --wait-timeout 300 --remove-orphans
  fi
  exit 1
fi

log "Removing images older than a week"
docker image prune --all --force --filter "until=168h" >/dev/null || true
