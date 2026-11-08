# Decisions

Short records of the choices that shape the codebase. Add a new entry instead of rewriting an old one; mark replaced entries as superseded.

## D-001 Turborepo + pnpm monorepo

Web, API, worker, and MCP server share types, schemas, and logic. One repo with pnpm workspaces keeps them in sync, and Turborepo caches builds and runs tasks in parallel.

## D-002 Workspace packages export TypeScript source

Packages point `exports` at `src/*.ts` instead of building to `dist`. Apps compile them in their own build: Next.js through `transpilePackages`, Node apps through `tsdown` with workspace packages bundled in. This removes a build step and keeps go-to-definition pointing at real source.

Consequence: Node apps bundle `@tessel/*` code but keep third-party packages external, so each app lists every runtime dependency it needs, including those used by workspace packages.

## D-003 TypeScript 6.0 with Bundler module resolution

TypeScript is pinned to `~6.0` because `typescript-eslint` supports TypeScript below 6.1. Revisit when it supports TypeScript 7. All code is ESM and uses `moduleResolution: Bundler`, since every app runs through a bundler or `tsx`.

## D-004 Express 5 for the API

Familiar, minimal, and Express 5 forwards errors from async handlers automatically. Features are organised as modules with a fixed file layout (see ARCHITECTURE.md).

## D-005 Zod for all validation

Environment variables, request bodies, job payloads, and model structured output are all validated with Zod. Schemas shared with the frontend live in `@tessel/contracts`.

## D-006 Drizzle ORM on Postgres

Close to SQL, light at runtime, generates plain SQL migrations, and works with Postgres row-level security.

## D-007 LangChain + LangGraph for AI orchestration

LangGraph gives durable checkpoints, pause-and-resume for approvals, and explicit control over agent and RAG flows. LangChain provides models, tools, retrievers, and middleware on top of it.

## D-008 Vercel AI Gateway for model access

One API key for every provider and modality (text, embeddings, reranking, and later image, video, and audio), no token markup, built-in fallbacks, and nothing to host. LangChain uses its OpenAI-compatible and Anthropic-format endpoints; AI SDK 7 is used for non-chat modalities. All calls go through `@tessel/ai`, so switching gateways later is a config change. A direct provider key is kept as an emergency fallback for chat.

## D-009 Two Redis instances

The cache uses `allkeys-lru` eviction; BullMQ requires `noeviction` and persistence. Sharing one instance would let cache pressure delete queued jobs.

## D-010 BullMQ for internal jobs, SQS for S3 events

S3 can notify SQS directly when a file lands. Everything else (embedding batches, memory extraction, agent runs) uses BullMQ for retries, priorities, and flows.

## D-011 Qdrant for vectors, Neo4j for relationships only

Qdrant has built-in hybrid search (dense + sparse with fusion). Neo4j is used only for relationship questions, because it is the most expensive service to run.

## D-012 Email and password login first

Phase 1 starts with email and password (argon2, 15-minute access JWT, rotating refresh token in an httpOnly cookie). Email verification, password reset, OAuth, two-factor authentication, and mobile OTP come in step 17.

## D-013 Local AWS emulation decided in step 7

LocalStack no longer offers a free tier, so it is not part of the local stack. Step 7 will choose between free local emulators for S3 and SQS or a small real AWS development account.

## D-014 Docker images on EC2 with Docker Compose

Images are built in CI, pushed to ECR, and deployed to EC2 with Docker Compose. Simple to run and easy to move to a managed orchestrator later.

## D-015 Row-level security with a restricted runtime role

Tenant tables have Postgres RLS policies keyed on `app.user_id`, set per transaction by `withUserContext`. The API connects as `tessel_app`, which cannot bypass RLS; migrations run as the owner. Membership checks for policies use `SECURITY DEFINER` helper functions so policies don't recurse. This makes a missing `WHERE` clause a non-event instead of a data leak.

## D-016 Refresh token rotation with reuse detection and a short grace window

Refresh tokens are opaque, hashed at rest, rotated on every use, and grouped into families (one per login). Reusing a retired token revokes the family. A 10-second grace window returns a distinct `refresh_token_rotated` error instead, so two tabs refreshing at once don't log the user out. The revocation is committed outside the rotation transaction so the error path can't roll it back.

## D-017 Rate limiting in Redis that fails open

Limits are shared across instances through the cache Redis. If Redis is unavailable, requests pass after a 250 ms command timeout: a short loss of rate limiting is better than a full outage. Login limits key on IP plus a hash of the email, so emails are never stored in Redis keys.

## D-018 Argon2id through @node-rs/argon2

Prebuilt native binaries, so no install scripts or build toolchain in CI and Docker images. Defaults follow the OWASP minimum (19 MiB, 2 iterations).

## D-019 Access token in memory, refresh on demand

The access token never touches browser storage, so a cross-site scripting bug can't read a long-lived credential from `localStorage`. The page restores a session by calling `/auth/refresh` with the httpOnly cookie. The axios client refreshes only when a request returns 401, shares one refresh across concurrent requests, and signs the user out only when the API rejects the refresh.

## D-020 Client-side route gates

Protected pages are gated in the browser rather than in Next.js middleware: the refresh cookie is scoped to the API host and path, so the web server can't read it. The API enforces every permission; the gates only decide what to show.

## D-021 Self-hosted fonts and a token-based design system

Fonts ship through Fontsource packages, so builds never fetch from a font CDN and pages don't depend on third-party requests. Colors, fonts, and radii are defined once as Tailwind v4 theme tokens, with a dark palette under `prefers-color-scheme`.

## D-022 Playwright end-to-end tests on desktop and phone

Every end-to-end test runs twice: Desktop Chrome and a Pixel 7 viewport. Tests run the real web app against the real API and database, with rate limits scaled up through `RATE_LIMIT_SCALE` for the test run only.

## D-023 Caddy on the host instead of a load balancer (for now)

The plan named an Application Load Balancer with ACM. With one EC2 host, Caddy in the Compose stack does the same job (HTTPS with automatic Let's Encrypt certificates, routing by domain, streaming responses) without the load balancer's monthly cost or setup. When there is more than one app host, add a load balancer and drop the `edge` profile; nothing else changes.

## D-024 Secrets in SSM Parameter Store

App secrets are `SecureString` parameters under `/tessel/prod`, written to a root-only `.env` on each deploy. Parameter Store is free at this scale and the EC2 role reads only that path. Secrets Manager adds automatic rotation; switch when rotation is needed (for example with RDS-managed passwords).

## D-025 One Dockerfile for every Node service

`infra/docker/node.Dockerfile` builds any workspace package: `turbo prune` reduces the repo to that package, dependencies install from manifests first for layer caching, and `pnpm deploy --prod` produces a folder with only production dependencies. Images run as the unprivileged `node` user. The web app has its own Dockerfile because it uses Next.js standalone output.

## D-026 Deploys over Systems Manager with automatic rollback

GitHub Actions assumes an AWS role through OIDC (no stored keys), pushes images tagged with the commit, and runs `deploy.sh` on the host through SSM (no SSH port). The script runs migrations, starts the new version, waits for every health check, and restores the previous tag if any check fails. Because migrations run before the new version starts, they must stay compatible with the version still running.

## D-027 One chat model class in front of every model call

Every model call goes through `TesselChatModel` in `@tessel/ai`, a LangChain chat model that checks the daily spend caps, calls the gateway's OpenAI-compatible endpoint, and falls back to the provider directly when the gateway is unreachable. A usage callback attached to it writes one ledger row per call. Because agents, RAG graphs, and plain completions all use this class, none of them can skip the caps or the ledger. Inner provider models are called through their `_generate` and `_streamResponseChunks` methods, so streaming callbacks see each token once, whichever route served it.

## D-028 Emergency fallback only when the gateway itself fails

The gateway already retries across providers, so Tessel falls back only on errors that point at the gateway: network errors, timeouts, 5xx, 429, and account problems (401, 402, 403). Bad requests (400, 404, 409, 413, 422) and cancellations never fall back, and a stream never switches routes once tokens have reached the user. Fallback keys are optional; without them the gateway is the only route.

## D-029 Prices from the model registry, in nano-dollars

Models, their prices, and the defaults for each role (chat, utility, moderation, embedding) live in `packages/ai/models.json`, validated with Zod at startup and replaceable through `AI_MODELS_FILE` without a rebuild. Cost is computed from those prices and stored as integer nano-dollars, so a single embedding call doesn't round to zero and sums stay exact. Embeddings use the cost the gateway reports when it reports one. The admin app (step 18) moves the registry into the database.

## D-030 Daily spend caps in Redis, the ledger as the source of truth

Caps apply per user, per workspace, and for the whole service, and are checked before every model call. Counters are Redis keys per UTC day, updated after each call, so a cap can be exceeded by at most the calls already running. If Redis is down, user and workspace spend are summed from the Postgres ledger instead, so an outage never turns caps off. The ledger is append-only for the app role. The 5-hour and weekly plan limits in step 19 build on the same ledger.

## D-031 Moderation with a small model, failing open by default

User messages are classified by a cheap model (`defaults.moderation`) through the same gateway, so moderation calls are capped and recorded like any other. Only clear categories block a message (sexual content involving minors, mass-casualty weapons, malware, violent threats, hate); self-harm is detected but never blocked, so a person in distress gets a careful answer. If the check itself fails, the message goes through and the failure is logged; `AI_MODERATION_ON_FAILURE=block` reverses that.

## D-032 Chat streams over server-sent events, and stop means disconnect

`POST /workspaces/:workspaceId/chat` checks and saves the message, then streams the reply as server-sent events (`start`, `token`, `done`, `title`, `error`). Everything that can refuse a message (membership, model, attachments, spend caps, moderation) runs before the stream opens, so refusals are ordinary JSON errors. The browser reads the stream with `fetch`, since axios can't stream in the browser. Pressing stop aborts the request; the API sees the connection close, aborts the model call, saves what was streamed as a stopped reply, and the usage ledger records the call as aborted with estimated tokens. No separate stop endpoint is needed while one API instance serves each stream.

## D-033 Chats are private to the member who started them

Threads, messages, and attachments carry the owner's user ID, and row-level security only lets that user (while still a member) read or change them. Workspace admins see usage totals, not conversations. Shared projects and chats can come later as an explicit sharing feature rather than a default.

## D-034 Attachments in Postgres until S3 arrives

Step 6 accepts images (PNG, JPEG, GIF, WebP up to 5 MB) and UTF-8 text files (up to 1 MB), identified by their contents, not the type the browser claims. They are stored in Postgres so chat works before S3 exists; step 7 moves file storage to S3 and adds PDFs and office documents through ingestion. Text files are sent to the model inside `<attachment>` tags as data; images go to models that can read them, and other models refuse the message up front.
