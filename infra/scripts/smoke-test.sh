#!/usr/bin/env bash
# Boots the production images with the production compose file and checks
# that every service is healthy and the API works end to end.
#
#   infra/scripts/smoke-test.sh <registry> <tag>
#
# Uses throwaway secrets from infra/deploy/ci/secrets.env. Runs the data
# profile (databases in containers) and skips the edge profile (Caddy).
set -euo pipefail

REGISTRY=${1:?usage: smoke-test.sh <registry> <tag>}
TAG=${2:?usage: smoke-test.sh <registry> <tag>}

cd "$(dirname "$0")/../deploy"
WORK=$(mktemp -d)
cp docker-compose.prod.yml "$WORK/"
cp ci/secrets.env "$WORK/.env"
cat >"$WORK/deploy.env" <<EOF
ECR_REGISTRY=$REGISTRY
AWS_REGION=unused
COMPOSE_PROFILES=data
EOF
cd "$WORK"
# Database containers get only their own secret, not every app variable.
grep -E '^POSTGRES_PASSWORD=' .env >postgres.env || true
grep -E '^NEO4J_AUTH=' .env >neo4j.env || true

compose() { IMAGE_TAG=$TAG docker compose --project-name tessel-smoke --file docker-compose.prod.yml --env-file deploy.env "$@"; }
cleanup() {
  if [[ "${KEEP:-}" != "1" ]]; then compose --profile tools down --volumes --remove-orphans >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() {
  echo "SMOKE TEST FAILED: $*" >&2
  compose ps || true
  compose logs --tail 80 || true
  exit 1
}

echo "==> Starting data services"
compose up --detach --wait --wait-timeout 300 postgres redis-cache redis-queue qdrant neo4j || fail "data services did not become healthy"

echo "==> Running migrations"
compose --profile tools run --rm migrate || fail "migrations failed"

echo "==> Starting apps"
compose up --detach --wait --wait-timeout 180 || fail "apps did not become healthy"

http() { compose exec -T api wget -qO- "$@"; }

echo "==> API readiness (every dependency up)"
ready=$(http http://127.0.0.1:4000/health/ready) || fail "readiness check failed"
echo "$ready"
grep -q '"status":"ready"' <<<"$ready" || fail "API is not ready"

echo "==> Signup through the production image"
signup=$(http --header 'Content-Type: application/json' \
  --post-data '{"email":"smoke@example.com","password":"a long enough password","name":"Smoke Test"}' \
  http://127.0.0.1:4000/auth/signup) || fail "signup request failed"
grep -q '"accessToken"' <<<"$signup" || fail "signup did not return an access token"
token=$(sed -E 's/.*"accessToken":"([^"]+)".*/\1/' <<<"$signup")
workspaces=$(http --header "Authorization: Bearer $token" http://127.0.0.1:4000/workspaces) || fail "workspaces request failed"
grep -q "Smoke's workspace" <<<"$workspaces" || fail "personal workspace missing"

echo "==> Other services"
compose exec -T web wget -qO- http://127.0.0.1:3000/ | grep -q "Tessel" || fail "web app did not render"
compose exec -T mcp-server wget -qO- http://127.0.0.1:4100/health | grep -q '"ok"' || fail "mcp-server unhealthy"
compose exec -T worker wget -qO- http://127.0.0.1:4200/health | grep -q '"ok"' || fail "worker unhealthy"

echo "==> Every check passed"
