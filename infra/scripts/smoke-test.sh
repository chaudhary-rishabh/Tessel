#!/usr/bin/env bash
# Boots the production images with the production compose file and checks
# that every service is healthy and the API works end to end.
#
#   infra/scripts/smoke-test.sh <registry> <tag>
#
# Uses throwaway secrets from infra/deploy/ci/secrets.env. Runs the data
# profile (databases in containers) with S3 and SQS emulators in place of
# AWS (and a mock of SES for email), and skips the edge profile (Caddy).
set -euo pipefail

REGISTRY=${1:?usage: smoke-test.sh <registry> <tag>}
TAG=${2:?usage: smoke-test.sh <registry> <tag>}

cd "$(dirname "$0")/../deploy"
WORK=$(mktemp -d)
cp docker-compose.prod.yml ci/docker-compose.emulators.yml ci/mock-ses.mjs "$WORK/"
cp ../docker/seaweedfs/s3.json "$WORK/"
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

compose() {
  IMAGE_TAG=$TAG docker compose --project-name tessel-smoke \
    --file docker-compose.prod.yml --file docker-compose.emulators.yml --env-file deploy.env "$@"
}
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
compose up --detach --wait --wait-timeout 300 postgres redis-cache redis-queue qdrant neo4j objectstore sqs ses ||
  fail "data services did not become healthy"

echo "==> Running migrations"
compose --profile tools run --rm migrate || fail "migrations failed"

echo "==> Starting apps"
compose up --detach --wait --wait-timeout 180 || fail "apps did not become healthy"

http() { compose exec -T api wget -qO- "$@"; }

echo "==> API readiness (every dependency up, including S3, SQS, and Qdrant)"
# Emulators can report healthy a little before they serve requests, so allow a minute.
ready=""
for _ in $(seq 1 30); do
  ready=$(http http://127.0.0.1:4000/health/ready 2>/dev/null) && break
  sleep 2
done
echo "$ready"
grep -q '"status":"ready"' <<<"$ready" ||
  fail "API is not ready: $(compose exec -T api wget -qO- --content-on-error http://127.0.0.1:4000/health/ready 2>&1 || true)"

echo "==> Signup through the production image (the code arrives by email through SES)"
started=$(http --header 'Content-Type: application/json' \
  --post-data '{"email":"smoke@example.com","password":"a long enough password","name":"Smoke Test"}' \
  http://127.0.0.1:4000/auth/signup) || fail "signup request failed"
challenge=$(sed -E 's/.*"challengeId":"([^"]+)".*/\1/' <<<"$started")
[[ "$challenge" =~ ^[0-9a-f-]{36}$ ]] || fail "signup did not start a verification: $started"
code=""
for _ in $(seq 1 10); do
  # The subject starts with the code: "123456 is your Tessel code".
  code=$(http 'http://ses:8005/messages?to=smoke@example.com' | grep -oE '"subject":"[0-9]{6} ' | grep -oE '[0-9]{6}' | tail -1) || true
  [[ -n "$code" ]] && break
  sleep 1
done
[[ -n "$code" ]] || fail "no signup code was emailed"
signup=$(http --header 'Content-Type: application/json' \
  --post-data "{\"challengeId\":\"$challenge\",\"code\":\"$code\"}" \
  http://127.0.0.1:4000/auth/signup/verify) || fail "signup verification failed"
grep -q '"accessToken"' <<<"$signup" || fail "signup did not return an access token"
token=$(sed -E 's/.*"accessToken":"([^"]+)".*/\1/' <<<"$signup")
workspaces=$(http --header "Authorization: Bearer $token" http://127.0.0.1:4000/workspaces) || fail "workspaces request failed"
grep -q "Smoke's workspace" <<<"$workspaces" || fail "personal workspace missing"

echo "==> Other services"
compose exec -T web wget -qO- http://127.0.0.1:3000/ | grep -q "Tessel" || fail "web app did not render"
compose exec -T admin wget -qO- http://127.0.0.1:3001/login | grep -q "Tessel Admin" || fail "admin app did not render"
compose exec -T mcp-server wget -qO- http://127.0.0.1:4100/health | grep -q '"ok"' || fail "mcp-server unhealthy"
echo "==> Sign-in for outside MCP clients (OAuth metadata on the API and the MCP server)"
http http://127.0.0.1:4000/.well-known/oauth-authorization-server | grep -q '"token_endpoint"' ||
  fail "API OAuth metadata missing"
compose exec -T mcp-server wget -qO- http://127.0.0.1:4100/.well-known/oauth-protected-resource/mcp |
  grep -q '"authorization_servers"' || fail "MCP protected resource metadata missing"
compose exec -T worker wget -qO- http://127.0.0.1:4200/health | grep -q '"ok"' || fail "worker unhealthy"

echo "==> Every check passed"
