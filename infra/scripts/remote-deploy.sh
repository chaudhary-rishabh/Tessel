#!/usr/bin/env bash
# Sends the deploy files to the EC2 host and runs deploy.sh there, through
# AWS Systems Manager (no SSH keys, no open SSH port).
#
#   infra/scripts/remote-deploy.sh <image-tag>
#
# Environment: AWS_REGION, ECR_REGISTRY, EC2_INSTANCE_ID, COMPOSE_PROFILES,
# SSM_PATH, WEB_DOMAIN, API_DOMAIN, MCP_DOMAIN, ACME_EMAIL.
set -euo pipefail

TAG=${1:?usage: remote-deploy.sh <image-tag>}
for name in AWS_REGION ECR_REGISTRY EC2_INSTANCE_ID WEB_DOMAIN API_DOMAIN MCP_DOMAIN ACME_EMAIL; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is not set" >&2
    exit 1
  fi
done

cd "$(dirname "$0")/../deploy"

deploy_env=$(
  cat <<EOF
AWS_REGION=$AWS_REGION
ECR_REGISTRY=$ECR_REGISTRY
COMPOSE_PROFILES=${COMPOSE_PROFILES:-edge,data}
SSM_PATH=${SSM_PATH:-/tessel/prod}
WEB_DOMAIN=$WEB_DOMAIN
API_DOMAIN=$API_DOMAIN
MCP_DOMAIN=$MCP_DOMAIN
ACME_EMAIL=$ACME_EMAIL
EOF
)

b64() { base64 -w0 "$@"; }

# Files travel inside the command as base64, so the host needs no repo checkout.
commands=$(
  jq -n \
    --arg compose "$(b64 docker-compose.prod.yml)" \
    --arg caddy "$(b64 Caddyfile)" \
    --arg script "$(b64 deploy.sh)" \
    --arg env "$(printf '%s\n' "$deploy_env" | b64)" \
    --arg tag "$TAG" \
    '{commands: [
      "set -euo pipefail",
      "mkdir -p /opt/tessel && cd /opt/tessel",
      "echo \($compose) | base64 -d > docker-compose.prod.yml",
      "echo \($caddy) | base64 -d > Caddyfile",
      "echo \($script) | base64 -d > deploy.sh && chmod +x deploy.sh",
      "echo \($env) | base64 -d > deploy.env",
      "./deploy.sh \($tag)"
    ], executionTimeout: ["2400"]}'
)

echo "Sending deploy of $TAG to $EC2_INSTANCE_ID"
command_id=$(
  aws ssm send-command \
    --region "$AWS_REGION" \
    --instance-ids "$EC2_INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "Deploy tessel $TAG" \
    --timeout-seconds 600 \
    --parameters "$commands" \
    --query Command.CommandId \
    --output text
)

# Poll until the command finishes, then print its output.
status=Pending
for _ in $(seq 1 240); do
  status=$(aws ssm get-command-invocation --region "$AWS_REGION" \
    --command-id "$command_id" --instance-id "$EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in
    Pending | InProgress | Delayed) sleep 10 ;;
    *) break ;;
  esac
done

aws ssm get-command-invocation --region "$AWS_REGION" \
  --command-id "$command_id" --instance-id "$EC2_INSTANCE_ID" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text || true

if [[ "$status" != "Success" ]]; then
  echo "Deploy finished with status: $status" >&2
  exit 1
fi
echo "Deploy of $TAG succeeded"
