#!/usr/bin/env bash
# Builds every Tessel image.
#
#   infra/scripts/build-images.sh <registry> <tag> [load|push]
#
#   load  build into the local Docker daemon (default; used by CI smoke tests)
#   push  push to the registry, also tagging :latest (used by deploys)
#
# Environment:
#   PUBLIC_API_URL  API URL baked into the web app (default http://localhost:4000)
#   PLATFORM        target platform (default linux/amd64; use linux/arm64 for Graviton)
#   BUILD_CACHE     set to "gha" to use the GitHub Actions build cache
set -euo pipefail

REGISTRY=${1:?usage: build-images.sh <registry> <tag> [load|push]}
TAG=${2:?usage: build-images.sh <registry> <tag> [load|push]}
MODE=${3:-load}
PUBLIC_API_URL=${PUBLIC_API_URL:-http://localhost:4000}
PLATFORM=${PLATFORM:-linux/amd64}

if [[ "$MODE" != "load" && "$MODE" != "push" ]]; then
  echo "Mode must be load or push, got: $MODE" >&2
  exit 1
fi

cd "$(dirname "$0")/../.."

build() {
  local name=$1 dockerfile=$2
  shift 2
  local args=(--file "$dockerfile" --platform "$PLATFORM" --tag "$REGISTRY/tessel-$name:$TAG")
  if [[ "$MODE" == "push" ]]; then
    args+=(--tag "$REGISTRY/tessel-$name:latest" --push)
  else
    args+=(--load)
  fi
  if [[ "${BUILD_CACHE:-}" == "gha" ]]; then
    args+=(--cache-from "type=gha,scope=$name" --cache-to "type=gha,mode=max,scope=$name")
  fi
  echo "==> Building tessel-$name:$TAG"
  docker buildx build "${args[@]}" "$@" .
}

node_service() {
  local name=$1 package=$2 entry=$3
  build "$name" infra/docker/node.Dockerfile \
    --build-arg "PACKAGE=$package" \
    --build-arg "ENTRY=$entry"
}

node_service api @tessel/api dist/server.mjs
node_service worker @tessel/worker dist/worker.mjs
node_service mcp-server @tessel/mcp-server dist/server.mjs
node_service migrate @tessel/db dist/migrate.mjs
build web infra/docker/web.Dockerfile --build-arg "NEXT_PUBLIC_API_URL=$PUBLIC_API_URL"

echo "==> Built all images with tag $TAG"
