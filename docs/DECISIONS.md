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

Tokens, refresh tokens, and client registrations are stored with AES-256-GCM under `ENCRYPTION_KEY`, never returned by the API, and never logged. The version prefix leaves room for key rotation or moving the key to AWS KMS. Production refuses the development key.

## D-058 Connector URLs can't reach private networks

Users choose the URLs Tessel connects to, so every request (including OAuth discovery and each redirect hop) goes through a guard that requires HTTPS and refuses addresses on loopback, private, link-local, and metadata ranges. This blocks server-side request forgery, such as reaching the EC2 metadata endpoint. Local development and tests turn the guard off with `CONNECTORS_ALLOW_PRIVATE_NETWORKS`, which production refuses.

## D-059 Server hints decide approval only when they're safe

A connector tool runs without asking only when its server marks it read-only, or when the user chose "Always allow" for it. Anything else asks first, and tools the server doesn't describe count as destructive, following the MCP spec's defaults. Users can set each tool to ask first, always allow, or off. Tool results come back marked as data, like every other tool's.

## D-060 Personal access tokens are hashed, scoped, and bound to one workspace

A token (`tsl_pat_` plus 24 random bytes) acts as its owner in one workspace with listed scopes; only `documents:read` exists so far. Tessel stores a SHA-256 hash and a short prefix for display, and shows the token once. Tokens expire (7 days to a year, or never if the user chooses), can be revoked, and stop working the moment the owner leaves the workspace, because the lookup joins on membership. "Last used" is updated at most once a minute.

## D-061 Tokens reach only an allowlist of API routes

The API's auth middleware accepts a token only on routes listed in `TOKEN_ROUTES`, checks the route's workspace against the token's, and checks the scope. Everything else (chat, settings, making more tokens) answers 403, so a new route is closed to tokens until someone adds it on purpose.

## D-062 The MCP server is a thin adapter over the API

Tessel's MCP server (Streamable HTTP, stateless, on `mcp.` in production) holds no data access of its own: each tool call goes to the API with the client's token. Permissions, row-level security, rate limits, spend caps, and logging all live in one place, and the MCP server can scale or restart freely. Tools are read-only for now: search documents, list documents, and read a document's text.

## D-063 Four kinds of memory, each with one job

- Short-term: the recent turns of the chat, sent in full (up to 40 messages).
- Summary: once 24 messages sit outside the summary, older turns are folded into a running summary on the thread, and only the newest 12 plus later turns are sent in full. Long chats stay coherent without growing the prompt.
- Long-term: short facts about the user (role, projects, preferences, things they asked Tessel to remember), kept per user and workspace and sent with every reply.
- Episodic: one search point per chat in Qdrant, so `search_past_chats` can find an earlier conversation by meaning.

## D-064 Memory work runs in the worker after replies

Summarizing, extracting memories, and indexing chats all happen in a `memory` BullMQ job after a reply, never on the reply's path. The job is delayed 15 seconds and keyed by chat, so a burst of replies is processed once, and it reads the chat as it is when it runs. Each part fails on its own without affecting the others. The utility model does the work, recorded in the ledger as feature `memory`.

## D-065 The user owns their memory

Memories and memory settings are private to their user (row-level security). Users see every memory with where it came from, can add, edit, and delete them, and can switch memory and chat search off; switching chat search off deletes the index, not just stops using it. The extraction prompt refuses sensitive categories (health, finances, identity numbers, and similar) and removes memories the user asks Tessel to forget. Automatic memories make room for new ones at 200; memories the user wrote are never dropped. The `remember` tool doesn't ask for approval, since it only touches the user's own, editable memory.

## D-066 Caches live in the cache Redis and fail open

Every cache uses the cache Redis instance (evicting least-recently-used keys), never the queue instance. Reads that fail are misses and writes that fail are skipped, so a Redis outage makes Tessel slower, never broken.

## D-067 Embeddings are cached by model and text

The same text with the same model always gives the same vector, so embeddings are cached for a week under a hash of the model, dimensions, and text, packed as float32. Repeat searches, retried ingestion, and re-indexing unchanged chunks skip the model call and cost nothing. Only real calls reach the usage ledger.

## D-068 Search results are cached per workspace version

Hybrid search results are cached for ten minutes under a key that includes the workspace's search version. Anything that changes the workspace's index (indexing, re-indexing, deleting a document) increments that version, in the API or the worker, so every older result becomes unreachable at once without scanning for keys. Workspaces never invalidate each other.

## D-069 Prompt caching through the gateway

Chat calls ask the gateway for automatic prompt caching (`providerOptions.gateway.caching: "auto"`), which adds cache markers for providers that need them (Anthropic) and changes nothing for those that cache on their own. Each reply sends its thread ID as the session affinity header, so follow-up turns, agent steps, and tool loops reach the provider that already holds the cached prefix. Cached input tokens are recorded in the ledger at their lower price.

## D-070 Daily maintenance in one database function

A scheduled worker job (03:17 UTC, registered once however many workers run) calls `app.run_maintenance()`: refresh tokens a day past expiry or a week after revocation, access tokens a month after they ended, approvals nobody answered for a week (the run is cancelled and the reply closed), finished agent checkpoints after a month, and abandoned connector sign-ins. One `SECURITY DEFINER` function keeps the app role from needing broad delete rights.

## D-071 Graph RAG with Neo4j, built while indexing

Vector search finds passages that mention things; it can't follow "who manages the team that owns the ledger?". So while indexing, the worker sends each document in windows of about 6,000 characters (at most 30) to the utility model, which returns entities and relationships through a forced tool call. They go to Neo4j as `Entity` nodes keyed by workspace and normalized name, `MENTIONED_IN` links to the document, and typed `RELATES` links that remember the document and chunk they came from. Re-indexing replaces a document's part of the graph; deleting removes it and any entity nothing else mentions. Graph building runs after the document is searchable, and its failure never fails the document.

## D-072 Relationship questions use the graph, as citable sources

The RAG router also lists the entity names a relationship question is about. A `relate` step finds those entities, walks up to two hops, and turns the relationships into sources (one per document they came from), numbered after the passages, so the answer cites them like any passage and each citation opens the document. The agent gets the same lookup as the `explore_graph` tool. Workspaces are isolated by matching `workspace_id` from a parameter in every query, since Neo4j Community has no row-level security.

## D-073 The graph is optional

Without `NEO4J_BOLT_URL`, Tessel answers from search alone, and `GRAPH_EXTRACTION=false` stops the worker spending model calls on extraction. When the graph is set up, the readiness probe checks it over Bolt, which is how the app talks to it.

## D-074 Signup verifies the email before the account exists

Signup stores a pending challenge (name, Argon2 hash of the password, hashed code) and emails a 6-digit code; the user row is created only when the code is entered. So there are no half-made accounts to clean up, and nobody can claim an address they don't own. Five wrong tries or 15 minutes end a challenge, and resending replaces the code. When the address already has an account, the same 202 response comes back and the owner gets a "you already have an account" email instead of a code, which closes the email enumeration that `email_taken` allowed. Accounts made before this step count as verified.

## D-075 Two-step sign-in with TOTP, written in-house

TOTP is about 100 lines over `node:crypto` (HMAC-SHA1, 6 digits, 30-second steps, one step of clock drift), checked against the RFC 6238 test vectors, so no extra dependency handles secrets. The secret is sealed with the same AES-256-GCM box as connector tokens, so `CONNECTOR_SECRET_KEY` became `ENCRYPTION_KEY`. A code is only accepted for a step later than the last accepted one, enforced by a conditional update, so a code can't be replayed even by two requests at once. Ten recovery codes are stored as SHA-256 hashes (they're random, so a slow hash adds nothing) and each works once. Turning it off needs the password and a current code.

## D-076 Password reset signs out everywhere

A reset link is a 256-bit token stored as a hash, valid once for 30 minutes; asking again retires older links. Using it revokes every refresh token, because a reset usually means the old password can't be trusted, and marks the email verified, since the user proved they read it. Changes to the password or two-step settings email the user.

## D-077 Email through Amazon SES, with an outbox elsewhere

Production sends with SES (`@aws-sdk/client-sesv2`) using the instance role, so no mail credentials are stored; startup refuses any other transport in production. Development and tests use an in-memory outbox that logs each message and serves it at `GET /dev/outbox?to=` (never mounted in production), which is how end-to-end tests read signup codes and reset links.

## D-078 Google and GitHub through the API, handed over with a ticket

The browser goes to the API's `/auth/oauth/:provider/start`, which redirects to the provider with PKCE and a random state, both kept in a cookie sealed with `ENCRYPTION_KEY`. That cookie is `SameSite=Lax` because the provider sends the browser back from its own site, where a `Strict` cookie wouldn't be sent. The callback doesn't set the session cookie itself: it redirects to the web app with a one-time, two-minute ticket in the URL fragment (so it never reaches a server log or a `Referer`), and the app exchanges it with an ordinary same-site request. That keeps the refresh cookie `Strict` and lets two-step sign-in ask for its code exactly as after a password. The redirect URL never comes from the request, and `next` must be a path in the app.

## D-079 Accounts are matched by verified email

A provider account is found by its stable ID first. On first sign-in it joins the Tessel account with the same email only when the provider says the email is verified (Google's `email_verified`, GitHub's verified address); otherwise sign-in is refused, since an unverified email would let anyone claim an existing account. Since signups verify their email too (D-074), both sides of the match are proven. Joining or linking emails the account owner. New accounts made this way have no password; they can set one with the reset link.

## D-080 Sign-in by texted code, through SNS

A number is added only after a texted code confirms it, and each number belongs to one account. Signing in by text answers the same whether or not the number has an account, and sends nothing when it doesn't. SNS sends transactional texts with the instance role; DLT IDs are passed for Indian numbers. It's off in production until `SMS_TRANSPORT=sns`, because SMS needs SNS production access and costs money per text. A text is one factor like a password, so two-step sign-in still applies after it.

## D-081 The API is the OAuth server for MCP clients

MCP clients such as Claude and Cursor can sign in with OAuth 2.1 (the MCP authorization spec) instead of a pasted token. The MCP server is only the protected resource: its 401 points to its protected resource metadata (RFC 9728), which names the API as the authorization server. The API runs the MCP SDK's router (dynamic registration, authorize, token, revoke, and metadata) over Tessel's own store, because it already has the database, users, and sessions; the MCP server stays a thin, stateless proxy. The authorize step saves the request and sends the browser to a consent page in the web app, where the signed-in user picks a workspace and allows or denies. Codes are single-use, last five minutes, and need PKCE; tokens are only issued for Tessel's own MCP server (`resource`). The router is mounted before CORS because clients call it from any origin. The MCP host also serves the authorization server's metadata for clients that look for it there.

## D-082 OAuth access tokens reuse the personal access token path

An approved client gets a grant (client, user, workspace, scopes, refresh token hash) and hour-long `tsl_oat_` access tokens stored in `personal_access_tokens` with the grant's ID. So the API checks them exactly like personal tokens: hashed, workspace-bound, and limited to the same route allowlist and scopes, with no second code path. They're hidden from the hand-made token list. Refresh tokens rotate on every use and the previous one is remembered, so a copied one being replayed ends the grant and its tokens.

## D-083 Invitations are accepted through a database function

The existing row-level security lets owners and admins add members, but an invitee isn't a member yet, so they can't insert their own membership. Rather than loosen the policy, `app.accept_invitation(token_hash)` (security definer) checks that the invitation is open and was sent to the current user's verified email, then adds the membership and marks the invitation used, all in one statement. A second function shows an invitation's preview to anyone holding the link. Inviting the same address again revokes the earlier link. Only the owner can make admins or change roles, so an admin can't promote themselves or others.

## D-084 One audit log, written by the API

Security-relevant actions are recorded in `audit_events` (actor, workspace, action, target, metadata, IP) by the services that perform them. A failed write is logged and never blocks the action, since refusing a password change because the audit log is down would be worse. The table has no row-level security, like the auth tables: workspace owners and admins read their own workspace's events through the API, and platform admins read everything in the admin app. Actor and workspace references are set to null on deletion so history survives, and daily maintenance drops events after a year.

## D-085 The admin app is a separate app, and the API decides

The admin app is its own Next.js app and image on its own domain, so its pages, bundle, and attack surface are kept apart from the product, and it can be put behind extra network rules later. Hiding pages proves nothing, so every admin API call loads the user from the database and checks the role, suspension, and (in production) two-step sign-in; JWT claims alone aren't trusted for this, so a demoted admin is locked out at once. Admins can't change their own role or suspend themselves. Nobody can become an admin through the app: the first one is granted with an operator command on the host.

## D-086 The model registry lives in the database

`models.json` is the starting point. When an admin saves the registry, the whole config is validated with the same schema and stored as one row; the API swaps it in at once, and every API and worker process checks for a newer saved version every minute. An invalid saved config is ignored with an error in the log, and the file's config keeps working. The embedding model can't change from the admin app, because every document would need re-indexing with matching vector sizes.

## D-087 Suspension instead of deletion

Admins suspend accounts rather than delete them, so workspaces, documents, and the audit trail stay intact and the decision can be reversed. A suspended account is signed out everywhere and refused at every sign-in method, at token refresh, and at token lookup. Access tokens already issued are short (15 minutes), which is the accepted gap, rather than adding a database lookup to every request.

## D-088 Plans limit spend in two windows, like Claude

Each plan (Free, Pro, Max, Team) has a five-hour limit and a weekly limit, measured in model cost per person per workspace, so heavy and light models count fairly. A window starts with the first request after the last one ended, which matches how people work in bursts. The limits are checked before any model call, from the usage ledger, and a request over either limit gets `usage_limit_reached` with the time it resets. The earlier daily cost caps stay as a safety net for the whole service. Free can only use models marked `free` in the registry; paid plans can use every model. Limits and prices live in `@tessel/contracts`, so the web app shows the same numbers the API enforces.

## D-089 Extra usage is charged at cost on the next invoice

On paid plans, owners and admins can turn on extra usage with a monthly cap. Past a limit, requests keep working and are marked as extra; their cost is summed per billing period and charged at cost when the period closes (a Stripe invoice item on the renewal invoice, a Razorpay add-on on the next charge). Going past the cap refuses requests again. Charging at cost keeps the rule easy to explain and avoids a second price list.

## D-090 Two payment providers behind one interface

Stripe takes cards worldwide, and Razorpay takes UPI and Indian cards in rupees, so both are offered when configured. Each sits behind a small `PaymentProvider` interface (checkout, change plan, cancel, portal, charge, verify webhook) written with `fetch` instead of the vendors' SDKs, which keeps the API image small and lets one mock server stand in for both in tests. The plan a workspace is on is only ever changed by a verified webhook, never by the browser's return from checkout, and each webhook event is stored by ID so a repeated delivery is applied once. Prices in rupees are set on the Razorpay plans; the USD figures are the source of truth.

## D-091 Team seats follow membership

A team workspace pays for at least two seats and one per member. When someone joins or leaves, the subscription's quantity is updated straight away, with the provider's own proration. Personal workspaces can only take Free, Pro, or Max, and shared workspaces only Free or Team, so a plan always matches who uses it.

## D-092 Editing rewrites the chat from that message

Editing a sent message, or retrying the last reply, sends the message again with `editMessageId`: the server updates that message, deletes everything after it, and writes a new reply, all in the same transaction that saves the new reply. The message keeps its attachments. If the running summary already covered the edited turn it is cleared, so it never describes a conversation that no longer exists. Keeping earlier versions to flip between is left for later; replacing keeps the history the model sees identical to what the person sees.

## D-093 Chat search scans titles and the person's own messages

The sidebar searches chat titles and message text with a case-insensitive `ILIKE`, limited by row-level security to the person's own chats in the workspace, and escapes `%` and `_` so they match literally. That is fast enough at today's sizes without a search index; a trigram index is the next step. Older chats load onto the end of the same cached list, so renames, deletes, and new replies keep updating one list.

## D-094 Theme is a per-browser choice

Light, dark, or the device's setting is stored in the browser, not the account, since the right choice often differs between a phone and a laptop. A tiny inline script sets `data-theme` before the first paint, so a chosen theme never flashes the other one, and the colour tokens switch on that attribute or, without it, on `prefers-color-scheme`.

## D-095 Deleting a workspace ends billing first

Only the owner can delete a team workspace, and only after typing its name. The subscription is cancelled at once (no proration games) before anything is removed; if the provider refuses, nothing is deleted, so a deleted workspace is never charged again. Files in S3 are removed next and must succeed. Search index, chat search, and graph entries are removed on a best-effort basis, since nothing can reach them once the workspace row is gone. Deleting the row cascades through Postgres. Late webhooks for the deleted workspace are acknowledged and ignored. Personal workspaces can't be deleted.

## D-096 Operations on one host: CloudWatch logs and nightly backups

With `LOG_GROUP` set, the deploy writes a Compose override that sends every container's logs to CloudWatch (non-blocking, so a slow CloudWatch never stalls the apps), and Docker keeps a local copy for `docker compose logs`. The nightly backup takes a Postgres dump and a full Qdrant snapshot, streamed straight to S3 through the API container, which already has Qdrant's address and key. SES's account-level suppression list handles bounces and complaints, so the app doesn't need its own bounce handling.
