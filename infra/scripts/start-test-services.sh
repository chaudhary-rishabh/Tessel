#!/usr/bin/env bash
# Starts the S3, SQS, Qdrant, and Neo4j services for CI, with the same settings as
# infra/docker/docker-compose.yml, and waits until each one answers.
# (GitHub service containers can't take a command, which SeaweedFS needs.)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)

docker run -d --name tessel-objectstore -p 8333:8333 \
  -v "$ROOT/infra/docker/seaweedfs/s3.json:/etc/seaweedfs/s3.json:ro" \
  chrislusf/seaweedfs:3.99 \
  server -dir=/data -ip.bind=0.0.0.0 -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json \
  -s3.allowedOrigins=http://localhost:3000 >/dev/null
docker run -d --name tessel-sqs -p 9324:9324 softwaremill/elasticmq-native:1.6.11 >/dev/null
docker run -d --name tessel-qdrant -p 6333:6333 qdrant/qdrant:v1.20.0 >/dev/null
docker run -d --name tessel-neo4j -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/tessel-local-password \
  -e NEO4J_server_memory_heap_max__size=512M \
  -e NEO4J_server_memory_pagecache_size=256M \
  neo4j:2026.10.1 >/dev/null

wait_for() {
  local name=$1 url=$2
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "$url"; then
      echo "$name is up"
      return 0
    fi
    sleep 2
  done
  echo "$name did not start" >&2
  docker logs "tessel-$name" 2>&1 | tail -40 >&2
  return 1
}

wait_for objectstore http://localhost:8333/healthz
wait_for sqs "http://localhost:9324/?Action=ListQueues"
wait_for qdrant http://localhost:6333/readyz
wait_for neo4j http://localhost:7474
