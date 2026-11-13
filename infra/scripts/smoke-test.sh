#!/usr/bin/env bash
# Boots the production images with the production compose file and checks
# that every service is healthy and the API works end to end.
#
#   infra/scripts/smoke-test.sh <registry> <tag>
#
# Uses throwaway secrets from infra/deploy/ci/secrets.env. Runs the data
# profile (databases in containers) with S3 and SQS emulators in place of
# AWS (and a mock of SES for email), the web profile so the web app's image
# is checked too, and the voice profile (LiveKit and the voice agent). Skips
# the edge profile (Caddy).
set -euo pipefail

REGISTRY=${1:?usage: smoke-test.sh <registry> <tag>}
TAG=${2:?usage: smoke-test.sh <registry> <tag>}

cd "$(dirname "$0")/../deploy"
WORK=$(mktemp -d)
cp docker-compose.prod.yml livekit.yaml ci/docker-compose.emulators.yml ci/mock-ses.mjs "$WORK/"
cp ../docker/seaweedfs/s3.json "$WORK/"
cp ci/secrets.env "$WORK/.env"
cat >"$WORK/deploy.env" <<EOF
ECR_REGISTRY=$REGISTRY
AWS_REGION=unused
COMPOSE_PROFILES=data,web,voice
EOF
cd "$WORK"
# Database containers get only their own secret, not every app variable.
grep -E '^POSTGRES_PASSWORD=' .env >postgres.env || true
grep -E '^NEO4J_AUTH=' .env >neo4j.env || true
printf 'LIVEKIT_KEYS=%s: %s\n' "$(sed -n 's/^LIVEKIT_API_KEY=//p' .env)" \
  "$(sed -n 's/^LIVEKIT_API_SECRET=//p' .env)" >livekit.env

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

echo "==> Signup through the production image (signed in at once; the confirmation link goes out through SES)"
signup=$(http --header 'Content-Type: application/json' \
  --post-data '{"email":"smoke.test@example.com","password":"a long enough password"}' \
  http://127.0.0.1:4000/auth/signup) || fail "signup request failed"
grep -q '"accessToken"' <<<"$signup" || fail "signup did not return an access token"
sent=""
for _ in $(seq 1 10); do
  sent=$(http 'http://ses:8005/messages?to=smoke.test@example.com') || true
  grep -q "Confirm your email for Tessel" <<<"$sent" && break
  sleep 1
done
grep -q "verify-email?token=" <<<"$sent" || fail "no confirmation link was emailed"
token=$(sed -E 's/.*"accessToken":"([^"]+)".*/\1/' <<<"$signup")
workspaces=$(http --header "Authorization: Bearer $token" http://127.0.0.1:4000/workspaces) || fail "workspaces request failed"
grep -q "Smoke's workspace" <<<"$workspaces" || fail "personal workspace missing"

echo "==> Other services"
# Whole responses go through grep (no -q): grep -q stops reading at the first
# match, and with pipefail the cut-off wget would count as a failure.
compose exec -T web wget -qO- http://127.0.0.1:3000/ | grep "Tessel" >/dev/null || fail "web app did not render"
compose exec -T admin wget -qO- http://127.0.0.1:3001/login | grep "Tessel Admin" >/dev/null || fail "admin app did not render"
compose exec -T mcp-server wget -qO- http://127.0.0.1:4100/health | grep '"ok"' >/dev/null || fail "mcp-server unhealthy"
echo "==> Sign-in for outside MCP clients (OAuth metadata on the API and the MCP server)"
http http://127.0.0.1:4000/.well-known/oauth-authorization-server | grep '"token_endpoint"' >/dev/null ||
  fail "API OAuth metadata missing"
compose exec -T mcp-server wget -qO- http://127.0.0.1:4100/.well-known/oauth-protected-resource/mcp |
  grep '"authorization_servers"' >/dev/null || fail "MCP protected resource metadata missing"
compose exec -T worker wget -qO- http://127.0.0.1:4200/health | grep '"ok"' >/dev/null || fail "worker unhealthy"

echo "==> Voice (the agent registered with LiveKit, and the API hands out a room)"
# The agent's health check passes only while it's connected to LiveKit.
compose exec -T voice node -e "fetch('http://127.0.0.1:4700/').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1) }, () => process.exit(1))" ||
  fail "voice agent is not connected to LiveKit"
workspace_id=$(grep -oE '"id":"[0-9a-f-]{36}"' <<<"$workspaces" | head -1 | cut -d'"' -f4)
voice=$(http --header "Authorization: Bearer $token" --header 'Content-Type: application/json' \
  --post-data '{}' "http://127.0.0.1:4000/workspaces/$workspace_id/voice/sessions") ||
  fail "voice session request failed"
grep -q '"token"' <<<"$voice" || fail "voice session has no room token: $voice"

echo "==> Every check passed"
