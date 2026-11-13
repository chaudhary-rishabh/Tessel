# syntax=docker/dockerfile:1.7
# One Dockerfile for every Node service (api, worker, mcp-server, migrate, voice).
#   PACKAGE      workspace package name, e.g. @tessel/api
#   ENTRY        bundled entry file inside the package, e.g. dist/server.mjs,
#                plus any arguments (the voice agent's is "dist/main.mjs start")
#   NODE_IMAGE   base image; Alpine unless a service needs glibc
#   SYSTEM_PACKAGES  extra OS packages for the runtime image, e.g. ffmpeg for the worker

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install --global pnpm@10.28.0 && pnpm config set store-dir /pnpm/store

# Reduce the repo to the target package and the workspace packages it uses.
FROM base AS pruner
ARG PACKAGE
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.10 prune "${PACKAGE}" --docker

# Install with only package manifests first, so dependency layers stay cached
# until a manifest or the lockfile changes.
FROM base AS builder
ARG PACKAGE
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter="${PACKAGE}"
# A self-contained folder with the package and its production dependencies only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter "${PACKAGE}" deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runner
ARG ENTRY
ARG SYSTEM_PACKAGES=""
RUN if [ -n "$SYSTEM_PACKAGES" ]; then \
      if command -v apk >/dev/null; then apk add --no-cache $SYSTEM_PACKAGES; \
      else apt-get update && apt-get install -y --no-install-recommends $SYSTEM_PACKAGES && rm -rf /var/lib/apt/lists/*; fi; \
    fi
ENV NODE_ENV=production ENTRY=${ENTRY}
WORKDIR /app
# The deployed package: its bundle in dist/, production node_modules, and any
# runtime files it ships (the migrate image's SQL files, for example).
COPY --from=builder --chown=node:node /out ./
USER node
# ENTRY is split on spaces, so it can carry arguments.
CMD ["sh", "-c", "exec node --enable-source-maps $ENTRY"]
