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

LocalStack no longer offers a free tier, so it is not part of the local stack. Step 7 chose free emulators (see D-035).

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

## D-035 SeaweedFS and ElasticMQ stand in for S3 and SQS outside AWS

Local development, CI tests, and the production-image smoke test use SeaweedFS (S3 API, signed requests, presigned URLs, CORS) and ElasticMQ (SQS API). Both are actively maintained, Apache-licensed, and run in a container each, so the same AWS SDK code runs everywhere with only endpoints changed. Neither can send S3 bucket notifications, so `UPLOAD_EVENTS=api` makes the API put the same S3-shaped event on the queue when the browser reports an upload done; in AWS (`UPLOAD_EVENTS=s3`) S3 sends it. The worker can't tell the difference. MinIO was ruled out because its community edition no longer ships images.

## D-036 Uploads go S3 → SQS → BullMQ → worker

The browser uploads straight to S3 through a presigned URL that fixes the key, size, and type, so files never pass through the API. S3 announces new originals on SQS, which survives worker restarts and moves repeatedly failing messages to a dead-letter queue. The worker's consumer turns each message into a BullMQ job (job ID from the document ID, so duplicates collapse) and deletes the message only after the job is queued. BullMQ then gives retries with backoff, concurrency limits, and job locks for long documents. Ingestion is idempotent: chunk IDs are stable and old chunks are removed before new ones are written.

## D-037 Hybrid search: dense vectors plus BM25-style keyword vectors in Qdrant

Each chunk gets a dense embedding (meaning) and a sparse vector of hashed terms with BM25 term-frequency saturation (exact words, names, codes). Qdrant stores both, applies inverse document frequency to the sparse side itself (the `idf` modifier), and fuses the two result lists with reciprocal rank fusion in one query. Every query is filtered by `workspace_id`, which is a tenant payload index so each workspace's points sit together. Computing sparse vectors in-process avoids running a second model; a learned sparse model (SPLADE) can replace it later without changing storage. Reranking arrives with the RAG pipeline in step 8.

## D-038 Documents belong to the workspace; ingestion acts as the uploader

Documents are shared knowledge: every member can read and search them, and the uploader, owners, and admins can change or delete them (row-level security in `0004_documents.sql`). S3 events carry only the object key, so a narrow `SECURITY DEFINER` function tells the worker who uploaded a document; everything after that runs as that user, under the same row-level security as the API, and embeddings count against the uploader's spend caps.

## D-039 Nightly Postgres backups to S3 from the host

While Postgres runs on the EC2 host, `deploy.sh` installs a systemd timer that runs `pg_dump` (custom format) into an encrypted S3 bucket each night, and an S3 lifecycle rule expires old backups. `restore.sh` restores one with the apps stopped. Moving to RDS replaces this with RDS automated backups and point-in-time recovery.

## D-040 Retrieval runs as a small LangGraph graph before the answer streams

Route, retrieve, and rerank are nodes in a LangGraph `StateGraph`, with a conditional edge that skips retrieval when the router says documents won't help. The answer itself then streams through the normal chat path, so tokens, stop, and the usage ledger behave exactly as in plain chat. The router and reranker use the cheap utility model with forced tool calls, so their output is structured and validated with Zod. Each stage degrades instead of failing the reply: a broken router searches with the message as written, a broken reranker keeps the fused search order, and broken search answers without documents. Search is skipped without any model call when the user turns it off or the workspace has nothing indexed. The graph is the base the agent orchestrator extends in step 10.

## D-041 A small model reranks, rather than a dedicated reranking model

Hybrid search returns up to 20 candidates (fused across up to three rewritten queries); the utility model scores each 0 to 3 and the best six with a score of at least 1 become sources. This needs no extra provider or API beyond the gateway and handles any language. A dedicated reranker (for example Cohere Rerank) is cheaper per passage and faster at scale; the reranker is one function, so it can be swapped once evaluations in phase 3 show where it pays off.

## D-042 Numbered sources, cited inline and stored with the reply

Sources go into the system prompt as numbered `<source>` blocks marked as data, and the model cites them as `[1]`, `[2]`. The stream sends the sources before the first token, and the reply is saved with every source it was given and whether it cited it, so citations still work after a reload and if the document later changes. The interface turns each valid marker into a chip that shows the passage, its file and page, and a link to the original; markers that don't match a source stay plain text.

## D-043 Our own ReAct loop, checkpointed as JSON in Postgres

The agent (`runAgent` in `@tessel/ai`) is a short loop over LangChain's chat model with tools bound: stream a step, run the tool calls it asked for, feed the results back, repeat, with at most eight steps and the last one answering without tools. When a call needs approval the loop stops and returns a checkpoint: the conversation so far as LangChain's stored-message JSON, the tool call records, the text written, and the pending call. The API saves it in `agent_runs` and the reply as a `waiting` message, so a decision works after a reload, from another device, or after the API restarts. `resumeAgent` picks up exactly where it stopped. LangGraph's checkpointer would also do this, but it needs its own tables and serialises whole graph state; a plain JSON row is easy to inspect, to protect with row-level security, and to expire. Step 10 builds the orchestrator as a LangGraph graph and calls this loop as one of its nodes.

## D-044 Approval depends on what a tool can change

Every tool declares a risk: `read`, `write`, or `destructive`. Read-only tools (search, list, calculate, check the time) run straight away; anything that writes or deletes waits for the user, with a sentence saying what will happen ("Create "notes.md" in the workspace"). Tools act only as the signed-in user, through the same services and row-level security as the API, so an approved call still can't do what the user couldn't. Per-tool "always allow" settings and admin policies come with connectors in step 12.

## D-045 Tool input is validated and tool output is marked as data

The model's arguments are checked against each tool's Zod schema before anything runs; invalid calls come back to the model as errors it can correct. Results go back wrapped in `<tool_result>` tags, capped at 12,000 characters, and the system prompt says they are data, not instructions, to blunt prompt injection from documents. Each tool has a 30-second timeout and follows the reply's stop signal. Errors that explain themselves (a permission error, a bad expression) are shown as written; anything unexpected becomes "The tool failed unexpectedly" so hostnames and stack details stay in the logs.

## D-046 A new message cancels a pending approval

If the user replies instead of deciding, the waiting run is cancelled, its pending call is marked cancelled, and the conversation continues from the new message. This keeps one live run per chat and matches what people expect from Claude-style chat: moving on means "no". Decisions claim the run atomically (`waiting` to `running` in one update), so a double click or a second tab gets a 409 instead of running the tool twice.

## D-047 Agent modes are chosen in the chat box, not guessed

The composer offers four ways to reply: Answer (the ReAct agent from step 9), Plan (plan-and-execute), Review (reflection), and Team (a supervisor with specialist workers). The choice is a user preference that sticks between messages and is saved on each reply. Guessing the mode with a router would add a model call to every message and surprise people when it guessed wrong; an explicit choice is cheap, predictable, and easy to explain. Models that can't call tools always answer directly, since planning and delegating use forced tool calls.

## D-048 The orchestrator is LangGraph graphs over a JSON checkpoint

Each mode is a small LangGraph `StateGraph` whose nodes read and write one plain state object: plan → execute → review progress → answer; draft → review → publish or revise; supervise ⇄ work → write. Work inside a node (a plan step, a worker's task, a draft) is a ReAct sub-agent with tools, so approvals work in every mode: when a sub-agent pauses, the node records where it is, the graph ends, and the whole state is saved in `agent_runs` like a step 9 checkpoint. Resuming starts the graph at the saved node and continues the paused sub-agent with the user's decision. Checkpoints saved before modes existed still resume (they are read as Answer mode).

## D-049 Helpers think, the reply model writes

Planning and delegating use the model the user picked, since their choices shape the whole answer; progress checks and draft reviews use the cheaper utility model. Helper calls are recorded in the ledger as feature `agent` and count against the same spend caps. Sub-agents' working text is never streamed as the answer: the user sees the stages and tool calls live, and only the final answer streams as text. Each helper falls back instead of failing the reply: an unusable plan becomes one step, an unusable review counts as "good", an unusable hand-off finishes the team's work.

## D-050 Finished replies are moderated too

Input is checked before the model sees it (D-031). The finished reply is now checked as well, before it's saved. A blocked reply is replaced with an error the interface explains (`reply_blocked`), because the user already saw it stream. If the check itself fails, the reply is kept: the input already passed, and losing a good answer to a classifier outage is the worse failure.

## D-051 Neighbouring read-only tool calls run in parallel

When a model asks for several tools in one step, calls that need no approval run at the same time and their results go back in the order the model asked. A call that needs approval, an unknown tool, or invalid arguments ends the batch first, so ordering and pause points stay exactly as before.

## D-052 Skills load on demand through a tool

The system prompt lists every enabled skill by name and one-line description; the full instructions arrive only when the agent calls `load_skill`. That keeps many skills cheap in context and makes it visible in the reply which skill was used (it shows as a step). It's the same progressive-disclosure approach as Claude's skills. Skills work in every agent mode, since sub-agents get the same tool.

## D-053 Workspace skills are shared and moderated

A skill belongs to the workspace: every member can read and use it, write their own, and turn their own on or off; the author, owners, and admins can edit or delete it (row-level security in `0009_skills.sql`). Names come from titles in kebab-case, are unique per workspace, and can't reuse a built-in name, so a workspace skill never silently replaces one. Because the agent follows a skill's text, it is moderated when saved, and the prompt says loaded skills never override safety rules or the need for approval.

## D-054 Built-in skills live in code

Tessel ships four skills (meeting notes, email draft, document summary, decision memo) as code in `@tessel/ai`, so they're versioned and reviewed with the prompts that use them and need no seed data. They're always on for now; switching them off per workspace is in the backlog.

## D-055 Connectors are remote MCP servers, per user

Tessel connects to apps through the Model Context Protocol over Streamable HTTP, with the official TypeScript SDK. Only remote servers are supported: running local (stdio) servers would mean running users' commands on shared machines. Each connection belongs to one user in one workspace and is invisible to everyone else (row-level security), because it signs in as that user; teammates connect their own accounts. The catalog offers GitHub, Notion, and Linear, and any other server can be added by URL.

## D-056 OAuth through the SDK, with a server-side callback

Sign-in follows the MCP authorization spec, and the SDK does the work: protected-resource and authorization-server discovery, dynamic client registration, PKCE, the code exchange, and token refresh. Tessel supplies a provider that keeps the results on the connection. The app's sign-in page redirects to the API (`/connectors/oauth/callback`), not the web app, so codes and tokens never touch the browser's JavaScript. A single-use, hashed `state` that expires after ten minutes finds the connection; a narrow `SECURITY DEFINER` function looks it up before the user is known. Apps without dynamic registration (GitHub) use a configured OAuth app, or a personal access token when none is configured.

## D-057 Connector credentials are encrypted at rest

Tokens, refresh tokens, and client registrations are stored with AES-256-GCM under `CONNECTOR_SECRET_KEY`, never returned by the API, and never logged. The version prefix leaves room for key rotation or moving the key to AWS KMS. Production refuses the development key.

## D-058 Connector URLs can't reach private networks

Users choose the URLs Tessel connects to, so every request (including OAuth discovery and each redirect hop) goes through a guard that requires HTTPS and refuses addresses on loopback, private, link-local, and metadata ranges. This blocks server-side request forgery, such as reaching the EC2 metadata endpoint. Local development and tests turn the guard off with `CONNECTORS_ALLOW_PRIVATE_NETWORKS`, which production refuses.

## D-059 Server hints decide approval only when they're safe

A connector tool runs without asking only when its server marks it read-only, or when the user chose "Always allow" for it. Anything else asks first, and tools the server doesn't describe count as destructive, following the MCP spec's defaults. Users can set each tool to ask first, always allow, or off. Tool results come back marked as data, like every other tool's.
