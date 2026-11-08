#!/usr/bin/env bash
# EC2 user data for Amazon Linux 2023. Installs Docker and the Compose plugin
# and prepares /opt/tessel. Paste into "User data" when launching the instance,
# or run once with sudo on an existing instance.
set -euo pipefail

dnf install -y docker
systemctl enable --now docker

# Docker Compose v2 plugin (AL2023 doesn't package it). Set COMPOSE_VERSION
# (for example v2.40.0) to pin a release; the default is the latest one.
COMPOSE_URL=https://github.com/docker/compose/releases
if [[ -n "${COMPOSE_VERSION:-}" ]]; then
  COMPOSE_URL="$COMPOSE_URL/download/$COMPOSE_VERSION"
else
  COMPOSE_URL="$COMPOSE_URL/latest/download"
fi
ARCH=$(uname -m)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "$COMPOSE_URL/docker-compose-linux-${ARCH}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version

# Swap gives small instances headroom during image pulls and Neo4j start-up.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

mkdir -p /opt/tessel
chmod 750 /opt/tessel

# The SSM agent ships with AL2023; make sure it runs so deploys can reach the host.
systemctl enable --now amazon-ssm-agent
