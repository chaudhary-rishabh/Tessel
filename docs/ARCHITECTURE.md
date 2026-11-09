# Architecture

Tessel is an AI workspace for teams: chat over their own documents, agents that use tools and ask before risky actions, and outside apps connected through MCP. This document describes how the system is put together and the rules every part follows.

## System overview

```mermaid
flowchart TB
  web["Web app<br/>Next.js"] -- "REST + SSE" --> api["API<br/>Express 5"]
  web -- "presigned upload" --> s3["S3 + SQS"]
  s3 -- "upload event" --> worker["Worker<br/>BullMQ + SQS consumers"]
  api -- "jobs" --> worker
  clients["Outside MCP clients"] -- "MCP over HTTP" --> mcp["MCP server"]
  mcp -- "same services" --> api
  api --> shared
  worker --> shared
  subgraph shared["Shared services"]
    gateway["Vercel AI Gateway<br/>LangChain + AI SDK"]
    data["Postgres · Qdrant · Neo4j<br/>Redis cache · Redis queue"]
    apps["Connected apps<br/>via MCP client"]
  end
```

- The web app talks only to the API. Files go straight from the browser to S3.
- Anything slow (ingestion, long agent runs, memory extraction) runs in the worker.
- Every model call goes through `packages/ai` and the Vercel AI Gateway; nothing calls a provider directly.

## Apps

| App               | Purpose                                                     |
| ----------------- | ----------------------------------------------------------- |
| `apps/web`        | Next.js user app: chat, uploads, approvals, settings        |
| `apps/api`        | Express 5 API, split into feature modules                   |
| `apps/worker`     | Background jobs (BullMQ) and S3 upload events (SQS)         |
| `apps/mcp-server` | Exposes workspace search and actions to outside MCP clients |
| `apps/admin`      | Admin app for users, models, usage, and the audit log       |

## Packages

Workspace packages export TypeScript source directly. Apps compile them as part of their own build (Next.js through `transpilePackages`, Node apps through `tsdown`), so there is no separate package build step.

| Package              | Purpose                                              | Added   |
| -------------------- | ---------------------------------------------------- | ------- |
| `@tessel/config`     | Shared tsconfig presets, env loading and validation  | Step 1  |
| `@tessel/logger`     | Structured logging with secret redaction             | Step 1  |
| `@tessel/contracts`  | Zod schemas and types shared by frontend and backend | Step 1  |
| `@tessel/db`         | Drizzle schema, migrations, database client          | Step 1  |
| `@tessel/queue`      | Queue names, job payload schemas, Redis connection   | Step 1  |
| `@tessel/api-client` | axios instance and TanStack Query hooks              | Step 3  |
| `@tessel/ui`         | Shared UI components                                 | Step 3  |
| `@tessel/storage`    | S3 objects, SQS upload events, object key layout     | Step 7  |
| `@tessel/ai`         | Gateway client, model registry, prompts, graphs, RAG | Step 5  |
| `@tessel/tools`      | Built-in tools and the tool registry                 | Step 9  |
| `@tessel/skills`     | Built-in skills                                      | Step 11 |

## Data stores

| Store       | Holds                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Postgres    | Source of truth: users, workspaces, threads, messages, documents, usage ledger, agent checkpoints, long-term memory |
| Qdrant      | Chunk and memory vectors (dense + sparse), always filtered by workspace                                             |
| Neo4j       | Entities and relationships for graph RAG, always filtered by workspace                                              |
| Redis cache | Caching, rate limits, daily spend counters, live run events. Evicts least-recently-used keys                        |
| Redis queue | BullMQ only. Never evicts, persists to disk                                                                         |
| S3          | Original files, parsed text, artifacts. Keys start with the workspace ID                                            |

The two Redis instances are separate on purpose: a cache must be allowed to evict, and a queue must never lose jobs.

## API module pattern

Each feature in `apps/api/src/modules/<name>/` follows the same layout:

| File              | Job                                                 |
| ----------------- | --------------------------------------------------- |
| `*.routes.ts`     | Routes and the middleware chain                     |
| `*.controller.ts` | Reads the request, sends the response, nothing else |
| `*.service.ts`    | Business logic                                      |
| `*.repository.ts` | Database access                                     |
| `*.schemas.ts`    | Zod schemas, re-exported from `@tessel/contracts`   |
| `*.policy.ts`     | Who can do what                                     |
| `*.test.ts`       | Integration tests                                   |

Every request passes through, in order: request ID, request logging, security headers (helmet), CORS, body parsing (1 MB limit), rate limiting, authentication, Zod validation, permission check, controller, and one shared error handler.

Modules are wired in `apps/api/src/app.ts`: each one exposes factory functions (`createXService`, `createXController`, `createXRouter`), so tests can build the whole app against a test database with cheaper settings.

## Authentication

| Piece           | How it works                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords       | Argon2id (19 MiB, 2 iterations). Unknown emails still run a dummy verification so timing doesn't reveal which accounts exist.                                                                                                                                                                                                                                     |
| Access token    | JWT (HS256), 15 minutes, sent as `Authorization: Bearer`. Carries the user ID and role. Stateless.                                                                                                                                                                                                                                                                |
| Refresh token   | 256-bit random value in an httpOnly, `SameSite=Strict`, `Path=/auth` cookie. Stored only as a SHA-256 hash.                                                                                                                                                                                                                                                       |
| Rotation        | Every refresh retires the presented token and issues a new one in the same family (one family = one login session).                                                                                                                                                                                                                                               |
| Reuse detection | Presenting a retired token revokes the whole family. A token rotated less than 10 seconds earlier returns `refresh_token_rotated` instead, because that is almost always two tabs refreshing at once.                                                                                                                                                             |
| Password change | Revokes every session for the user and starts a new one.                                                                                                                                                                                                                                                                                                          |
| Signup          | The form emails a 6-digit code; the account exists only once the code is entered (5 tries, 15 minutes). An address that already has an account gets a note instead, and the response is identical.                                                                                                                                                                |
| Password reset  | A one-time link (30 minutes, stored as a hash). Using it sets the password, revokes every session, and emails a notice. Unknown emails get the same answer and no email.                                                                                                                                                                                          |
| Two-step        | Optional TOTP (RFC 6238) with 10 one-time recovery codes. The secret is encrypted with `ENCRYPTION_KEY`; each accepted code's time step is stored so a code works once. Login then returns a 5-minute challenge token instead of a session.                                                                                                                       |
| Sessions        | Each refresh token family is a signed-in device. Users can list them and sign any one out.                                                                                                                                                                                                                                                                        |
| Google, GitHub  | OAuth with PKCE. The state and verifier ride in a sealed, `SameSite=Lax` cookie scoped to `/auth/oauth`. The callback matches the account by provider ID, then by an email the provider has verified, or creates one with no password. It hands the web app a one-time ticket (2 minutes) in the URL fragment, which `/auth/oauth/exchange` trades for a session. |
| Phone           | Users add a number in Settings after confirming a texted code; then they can log in with a texted code (10 minutes, 5 tries). Numbers without an account get the same answer and no text. SNS in production, an outbox elsewhere.                                                                                                                                 |
| Every method    | Ends in the same place: two-step sign-in still asks for its code, and the last way to sign in can't be removed.                                                                                                                                                                                                                                                   |
| Email           | Amazon SES in production. Elsewhere an in-memory outbox logs messages and serves them at `GET /dev/outbox` for tests.                                                                                                                                                                                                                                             |
| CSRF            | Auth routes reject browser requests whose `Origin` is not an allowed web origin, on top of `SameSite=Strict`.                                                                                                                                                                                                                                                     |

Endpoints: `POST /auth/signup`, `/auth/signup/verify`, `/auth/signup/resend`, `/auth/login`, `/auth/login/two-factor`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/oauth/exchange`, `/auth/oauth/:provider/link`, `/auth/phone/start`, `/auth/phone/verify`, `/auth/refresh`, `/auth/logout`; `GET /auth/options`, `/auth/oauth/:provider/start`, `/auth/oauth/:provider/callback`; `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`; `GET /users/me`; `POST /users/me/password`, `/users/me/two-factor/setup|enable|disable|recovery-codes`, `/users/me/phone`, `/users/me/phone/verify`; `GET /users/me/identities`; `DELETE /users/me/identities/:provider`, `/users/me/phone`; `GET|POST /workspaces`; `GET|PATCH /workspaces/:workspaceId`. AI endpoints are listed under [AI gateway](#ai-gateway).

## Members and the audit log

- Team workspaces have an owner, admins, and members. Owners and admins invite by email; the link (`/invite/:token`, 7 days, stored as a hash) shows the workspace to anyone, and only the account with that verified email can accept, through `app.accept_invitation`, since the invitee isn't a member yet. Personal workspaces can't have other members.
- The owner changes roles and hands ownership over (becoming an admin). Admins remove members; the owner removes anyone; anyone but the owner can leave. Removing someone also ends their tokens and connected apps there, because token checks require membership.
- Endpoints under `/workspaces/:workspaceId`: `GET /members`, `PATCH|DELETE /members/:userId`, `POST /transfer`, `GET|POST /invitations`, `DELETE /invitations/:invitationId`, `GET /audit-log`. Links: `GET /invitations/:token`, `POST /invitations/:token/accept`.
- `audit_events` records who did what, from which IP: sign-ups, sign-ins (with method), password, two-step, and sign-in method changes, sessions signed out, members and invitations, workspace changes, access tokens, connected apps, connectors, and deleted documents. Workspace owners and admins read their workspace's events in Settings → Activity; platform admins read all of them. Writing an event never fails the action. Events are kept for a year.

## Admin app

- `apps/admin` is a separate Next.js app on its own domain (`admin.example.com`, port 3001 locally). It signs in with the same API session as the web app, so `WEB_ORIGIN` lists both origins.
- Every `/admin` API route reloads the user and requires `role = admin` and no suspension, so removing an admin takes effect at once; personal access tokens never work there. With `ADMIN_REQUIRE_TWO_FACTOR` (on in production) admins also need two-step sign-in.
- Pages: overview figures, users (search, detail, suspend, make admin, sign out everywhere), the model registry, usage by day, model, workspace, and person, and the audit log with filters. Cross-workspace figures come from `app.admin_*` security-definer functions, since usage and workspaces are behind row-level security.
- The first admin is made on the host with `grant-admin` (see `infra/aws/README.md`, section 9); after that, admins make admins.
- Suspending an account signs it out everywhere, refuses every sign-in method and token refresh, and stops its personal access tokens and OAuth tokens (`app.resolve_access_token` checks it). An access token already issued lasts until it expires, at most 15 minutes.
- Endpoints: `GET /admin/overview`, `GET /admin/users`, `GET|PATCH /admin/users/:userId`, `POST /admin/users/:userId/sign-out`, `GET|PUT /admin/models`, `GET /admin/usage`, `GET /admin/audit-log`.

## Tenant isolation

Workspaces are the tenant boundary. Isolation is enforced twice:

1. **In code:** tenant queries join on the caller's membership, and services return 404 (never 403) for workspaces the caller doesn't belong to, so their existence isn't revealed.
2. **In Postgres:** row-level security policies on tenant tables (see `packages/db/migrations/0001_row_level_security.sql`). The API connects as the restricted `tessel_app` role, which neither owns the tables nor bypasses RLS. Each request's tenant work runs in `withUserContext(db, userId, …)`, a transaction that sets `app.user_id`; without it, tenant tables return nothing.

| Role                                      | Purpose                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Database owner (`DATABASE_MIGRATION_URL`) | Runs migrations. Never used by the running API.                                                                              |
| `tessel_app` (`DATABASE_URL`)             | The API's runtime role. RLS always applies. Its login and password are set by `pnpm db:migrate`, never stored in migrations. |

`users` and `refresh_tokens` are not tenant-scoped (auth reads them before any user context exists), so access to them is enforced in application code.

## Rate limiting

Counters live in the cache Redis, so limits hold across API instances. If Redis is down, limiting fails open after a 250 ms timeout rather than taking the API down.

| Limiter                         | Default           | Key               |
| ------------------------------- | ----------------- | ----------------- |
| All routes except health checks | 300 per minute    | IP                |
| Signup                          | 10 per hour       | IP                |
| Login                           | 10 per 15 minutes | IP + hashed email |
| Refresh                         | 30 per minute     | IP                |
| Password change                 | 5 per 15 minutes  | IP + user         |
| Completions and chat messages   | 20 per minute     | IP + user         |
| Attachment uploads              | 20 per minute     | IP + user         |

## AI gateway

Every model call goes through `@tessel/ai`. Nothing else in the codebase talks to a provider.

```mermaid
flowchart LR
  caller["Chat, agents, RAG,<br/>worker jobs"] --> model["TesselChatModel"]
  model -- "1. check caps" --> redis["Redis spend counters"]
  model -- "2. call" --> gateway["Vercel AI Gateway"]
  model -. "gateway down" .-> direct["OpenAI or Anthropic directly"]
  model -- "3. usage callback" --> ledger["Postgres usage ledger"]
  ledger -. "Redis down" .-> redis
```

| Piece          | How it works                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model registry | `packages/ai/models.json`: models, prices per million tokens, capabilities, picker visibility, plan tier, emergency fallback target, and the default model for each role.                |
| Chat models    | `ai.chatModel(context, modelId)` returns a LangChain chat model for one user and workspace. It supports `invoke`, `stream`, tools, and structured output.                                |
| Embeddings     | `ai.embeddings(context)` returns LangChain embeddings through the gateway's `/embeddings` endpoint, in batches of 128.                                                                   |
| Spend caps     | Checked before every call: per user, per workspace, and for the whole service, per UTC day. A capped request returns 429 `daily_cost_cap_reached` with `Retry-After`.                    |
| Usage ledger   | One `usage_events` row per call: tokens, cost, route, status (`ok`, `error`, `aborted`, `blocked`), latency, request ID. Stopped calls are recorded with estimated tokens. Append-only.  |
| Moderation     | The latest user message is classified before the chat model sees it. A blocked message returns 422 `content_blocked` and is recorded with status `blocked`.                              |
| Fallback       | Network errors, 5xx, 429, and gateway account errors retry once on the gateway, then go straight to the provider if a fallback key is set. The ledger records which route served a call. |
| Testing        | `@tessel/ai/testing` has a mock gateway (OpenAI-compatible, streaming, tool calls, embeddings) used by unit, API, and end-to-end tests. `pnpm --filter @tessel/ai mock-gateway` runs it. |

Endpoints: `GET /models` (picker list, no prices); `POST /workspaces/:workspaceId/completions` (one non-streaming reply; streaming chat arrives in step 6); `GET /workspaces/:workspaceId/usage?days=30` (owners and admins see the workspace, members see their own usage).

## Chat

| Piece       | How it works                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data        | `threads`, `messages`, and `attachments`, private to the member who started the thread (row-level security in `0003_chat.sql`).                                                                                                    |
| Sending     | `POST /workspaces/:workspaceId/chat` with `{ threadId?, model?, content, attachmentIds }`. All checks run first; then the user message and an empty assistant message (status `streaming`) are saved and the stream opens.         |
| Events      | `start` (thread, saved user message, assistant message ID), `token` (text), `done` (saved reply), `title` (new threads only), or `error` (saved failed reply). A comment every 15 seconds keeps proxies from closing idle streams. |
| Context     | The system prompt plus the newest messages that fit (up to 40 messages and 400k characters). Failed replies are left out; stopped replies stay.                                                                                    |
| Stopping    | The client aborts the request. The reply is saved as `stopped` with the text the user saw.                                                                                                                                         |
| Titles      | After the first reply, the utility model names the thread (recorded as feature `title`), with the first words of the message as a fallback.                                                                                        |
| Attachments | `POST /workspaces/:workspaceId/attachments` (multipart `file`), then referenced by ID when sending. `GET …/attachments/:id/content` serves the file to its owner.                                                                  |
| Web         | Live replies sit in a Zustand store outside components, so a new chat keeps streaming while the page moves to its URL. Finished messages land in the TanStack Query cache for the thread.                                          |

Other endpoints: `GET /workspaces/:workspaceId/threads?before=` (newest first, paginated), `GET|PATCH|DELETE /workspaces/:workspaceId/threads/:threadId`.

## Knowledge (documents and search)

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant S as S3
  participant Q as SQS
  participant W as Worker
  participant V as Qdrant
  B->>A: POST /documents (name, size)
  A-->>B: presigned PUT URL
  B->>S: PUT file
  B->>A: POST /documents/:id/complete
  S-->>Q: ObjectCreated event (AWS)
  A-->>Q: same event (emulators only)
  Q->>W: long poll
  W->>W: BullMQ job: parse, chunk, embed
  W->>S: parsed.txt
  W->>V: dense + keyword vectors
  B->>A: POST /search
  A->>V: hybrid query, workspace filter
```

| Piece        | How it works                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formats      | PDF (page by page), Word (.docx), text, Markdown, CSV, JSON, HTML. Up to 50 MB and about 2 million characters per document.                                                                  |
| Storage keys | `workspaces/{workspaceId}/documents/{documentId}/original` and `…/parsed.txt`; chat attachments at `workspaces/{workspaceId}/attachments/{id}`.                                              |
| Statuses     | `uploading` → `queued` → `processing` → `ready`, or `failed` with a reason the user can act on (`no_text`, `unreadable_file`, `daily_cost_cap_reached`, …). Failed documents can be retried. |
| Chunks       | About 1,500 characters with 200 of overlap, never crossing a page, each with its page number for citations.                                                                                  |
| Vectors      | Dense embeddings from the registry's embedding model, plus hashed keyword vectors weighted like BM25. Stored in one Qdrant collection with `workspace_id` as a tenant index.                 |
| Search       | `POST /workspaces/:workspaceId/search`: both vectors, fused with reciprocal rank fusion, filtered by workspace and optionally by document. Recorded in the ledger as feature `search`.       |
| Reliability  | SQS messages are deleted only after their job is queued; failing messages move to a dead-letter queue. Jobs retry three times with backoff, and re-running a job gives the same result.      |

### Answering from documents

```mermaid
flowchart LR
  msg["New message"] --> route{"route<br/>(utility model)"}
  route -- "documents won't help" --> answer["Stream the answer"]
  route -- "up to 3 rewritten queries" --> retrieve["retrieve<br/>hybrid search per query,<br/>fused (top 20)"]
  retrieve --> rerank["rerank<br/>(utility model scores 0–3,<br/>keeps best 6)"]
  rerank --> answer
```

- Runs before the answer streams, as a LangGraph graph in `@tessel/ai` (`createRagPipeline`). The stream sends `status: searching`, then `sources`, then `status: writing`.
- The composer's documents setting chooses when to search: when it helps (the router decides), always, or never. Workspaces with nothing indexed skip search without any model call.
- The answer cites sources as `[n]`. Each reply is saved with its sources and which ones it cited (`messages.sources`).
- Router, query embeddings, and reranker are recorded in the ledger as feature `rag`.

Endpoints: `GET|POST /workspaces/:workspaceId/documents`, `GET|DELETE …/documents/:documentId`, `POST …/documents/:documentId/complete`, `POST …/documents/:documentId/reprocess`, `GET …/documents/:documentId/download`, `POST /workspaces/:workspaceId/search`.

### Graph RAG

```mermaid
flowchart LR
  doc["Indexed document"] --> windows["windows of ~6,000 chars"]
  windows --> extract["utility model<br/>extract_graph"]
  extract --> neo[("Neo4j<br/>Entity, MENTIONED_IN, RELATES")]
  q["Relationship question"] --> router["router: graph_entities"]
  router --> relate["relate: find entities,<br/>walk 2 hops"]
  neo --> relate
  relate --> sources["numbered sources<br/>(one per document)"]
```

- `@tessel/graph` holds the Neo4j store, a memory store for tests, extraction, and fact formatting. The worker builds the graph after indexing; the API uses it in the RAG pipeline (`relate`), the `explore_graph` tool, and `GET /workspaces/:workspaceId/graph?entity=…`.
- The Documents page shows how many entities and connections were found, and lets you look up a name's connections.

## Tools and approvals

```mermaid
flowchart LR
  model["Model step<br/>(tools bound)"] -- "no tool calls" --> done["Save reply"]
  model -- "tool calls" --> check{"risk?"}
  check -- "read" --> run["Run tool<br/>(as the user, 30 s limit)"]
  run --> model
  check -- "write / destructive" --> wait["Save checkpoint in agent_runs,<br/>reply status waiting"]
  wait -- "Allow / Decline" --> resume["resumeAgent"]
  resume --> model
```

- The tool registry and ReAct loop live in `@tessel/ai` (`defineTool`, `runAgent`, `resumeAgent`); the API's workspace tools are in `chat.tools.ts`: search documents, list documents, create a document, delete a document, calculate, check the time.
- Tool calls stream as `tool` events and are saved on the reply (`messages.tool_calls`). Passages found by `search_documents` become citable sources like those from the RAG pipeline.
- A paused reply ends its stream with `done` status `waiting`. `POST /workspaces/:workspaceId/threads/:threadId/tool-calls/:callId/decision` with `{ approved }` claims the run and streams the rest of the reply, starting with `resume`.
- A new message in the chat cancels a waiting run. Runs are private to the chat's owner (row-level security on `agent_runs`).
- Model steps are recorded in the ledger as feature `chat`, like any other reply step, under the reply's spend caps.

## Agent modes

```mermaid
flowchart TB
  subgraph Plan
    p1["plan<br/>(thinker: make_plan)"] --> p2["execute step<br/>(ReAct sub-agent)"]
    p2 --> p3{"review progress<br/>(critic)"}
    p3 -- continue / revise --> p2
    p3 -- finish --> p4["answer (streamed)"]
  end
  subgraph Review
    r1["draft<br/>(ReAct sub-agent)"] --> r2{"review draft<br/>(critic)"}
    r2 -- good --> r3["publish draft"]
    r2 -- issues --> r4["revise (streamed)"]
  end
  subgraph Team
    t1{"supervise<br/>(thinker: delegate)"} -- hand off --> t2["worker<br/>(ReAct, own tools)"]
    t2 --> t1
    t1 -- finish --> t3["write (streamed)"]
  end
```

- `runOrchestrator` / `resumeOrchestrator` in `@tessel/ai` run the chosen mode; Answer mode is the step 9 agent. Each mode is a LangGraph graph over one JSON state, saved in `agent_runs` when a sub-agent pauses for approval.
- Team workers in chat: researcher (search and list documents), analyst (calculator, time), editor (create and delete documents, with approval).
- Stages stream as `activity` events and are saved on the reply (`messages.activity`, with `messages.agent_mode`). The interface shows them in a panel above the tool calls.
- Finished replies are moderated before they're saved; a blocked reply becomes an error (`reply_blocked`).

## Skills

- A skill is a name, a description of when to use it, and instructions. Built-in skills are code in `@tessel/ai` (`builtInSkills`); workspace skills are rows in `skills`.
- Each reply lists enabled skills in the system prompt (`skillsPrompt`) and offers the `load_skill` tool, which returns a skill's instructions marked as instructions to follow (unlike other tool results, which are data).
- Endpoints: `GET|POST /workspaces/:workspaceId/skills`, `PATCH|DELETE …/skills/:skillId`. Saving moderates the text; names are unique per workspace and can't match a built-in one.
- The web app's Skills page lists workspace and built-in skills, with a switch to turn each workspace skill on or off.

## Connectors (MCP client)

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant S as MCP server / app
  B->>A: POST /workspaces/:id/connectors (OAuth app)
  A->>S: discovery, client registration (SDK)
  A-->>B: authorizationUrl (state, PKCE)
  B->>S: user signs in and allows
  S-->>B: redirect to API callback with code
  B->>A: GET /connectors/oauth/callback
  A->>S: code exchange, list tools
  A-->>B: redirect to /connectors?connected=…
```

- `@tessel/mcp` holds the client (Streamable HTTP via the MCP SDK), the OAuth provider, credential encryption, the URL guard, the tool adapter, and a mock server for tests.
- Connections live in `connector_connections` (private to their user), with encrypted credentials, cached tools, and per-tool approval choices.
- Each reply adds the user's enabled connector tools (named like `github_create_issue`), opens a client per connector on first use, and closes them when the reply ends. In team mode an integrations specialist gets these tools.
- Endpoints: `GET|POST /workspaces/:workspaceId/connectors`, `POST …/connectors/:connectionId/refresh`, `PATCH|DELETE …/connectors/:connectionId`, and `GET /connectors/oauth/callback`.

## MCP server (Tessel for outside clients)

```mermaid
flowchart LR
  client["MCP client<br/>(Claude Desktop, Cursor)"] -- "Bearer tsl_pat_…" --> mcp["mcp-server<br/>Streamable HTTP"]
  mcp -- "same token" --> api["API<br/>TOKEN_ROUTES allowlist"]
  api --> pg[("Postgres<br/>hashed tokens, RLS")]
  api --> qdrant[("Qdrant")]
```

- Users create personal access tokens in Settings (`GET|POST /workspaces/:workspaceId/access-tokens`, `DELETE …/access-tokens/:tokenId`). The token is shown once, with the settings an MCP client needs.
- The API accepts a token only on allowlisted routes in its own workspace: listing and reading documents, document text (`GET …/documents/:documentId/text`), search, and `GET /access-tokens/current`.
- The MCP server (`@tessel/mcp/server`, run by `apps/mcp-server`) checks the token with the API, then serves `search_documents`, `list_documents`, and `read_document`, each a call to the API with the same token.
- Clients that support MCP authorization sign in instead of pasting a token:

```mermaid
sequenceDiagram
  participant C as MCP client
  participant M as mcp-server
  participant A as API (OAuth server)
  participant W as Web app
  C->>M: POST /mcp, no token
  M-->>C: 401, resource_metadata=…/.well-known/oauth-protected-resource/mcp
  C->>A: /.well-known/oauth-authorization-server, POST /register
  C->>A: GET /authorize (PKCE, resource)
  A-->>W: redirect to /oauth/consent/:id
  W->>A: approve (signed in, picks a workspace)
  A-->>C: redirect with a one-time code
  C->>A: POST /token, then refresh as needed
  C->>M: POST /mcp, Bearer tsl_oat_…
```

- The API is the authorization server, using the MCP SDK's router (`/register`, `/authorize`, `/token`, `/revoke`, metadata) with Tessel's own store. Clients register themselves; their registration is sealed with `ENCRYPTION_KEY`.
- Access tokens (`tsl_oat_`) last an hour and are stored like personal access tokens, so the same allowlist and workspace checks apply. Refresh tokens rotate on every use; reusing an old one ends the grant.
- Settings → Connected apps lists each client and disconnects it. Consent endpoints: `GET /oauth/authorizations/:authorizationId`, `POST …/approve`, `POST …/deny`; `GET|DELETE /users/me/connected-apps`.

## Memory

```mermaid
flowchart LR
  reply["Reply finishes"] -- "memory job (15 s debounce)" --> worker["worker: processThreadMemory"]
  worker --> summary["threads.summary<br/>(summary memory)"]
  worker --> facts["memories<br/>(long-term)"]
  worker --> episodes[("Qdrant tessel_episodes<br/>(episodic)")]
  facts --> prompt["next reply's system prompt"]
  summary --> prompt
  episodes --> tool["search_past_chats tool"]
```

- `@tessel/memory` holds the store, the summarizer and extractor (utility model), the episode index, the memory tools, and `processThreadMemory`, which the worker runs for each `memory` job.
- Replies include up to 60 memories and the thread summary in the system prompt, and offer `remember` and `search_past_chats` when the user's settings allow.
- Endpoints: `GET /workspaces/:workspaceId/memory`, `PUT …/memory/settings`, `POST|DELETE …/memory/memories`, `PATCH|DELETE …/memory/memories/:memoryId`. Settings has a Memory section for all of it.

## Caching

| Layer          | Where                     | Key                                                  | Lifetime                        |
| -------------- | ------------------------- | ---------------------------------------------------- | ------------------------------- |
| Embeddings     | Cache Redis               | model, dimensions, hash of text                      | 7 days                          |
| Search results | Cache Redis               | workspace, search version, hash of query vectors     | 10 minutes or the next re-index |
| Prompts        | Provider, via the gateway | automatic cache markers, session affinity per thread | the provider's (5 minutes)      |
| Model list     | Browser                   | `Cache-Control: private, max-age=300` and ETag       | 5 minutes, then revalidated     |

`withSearchCache` wraps the Qdrant index in both the API and the worker; the worker's writes bump the workspace's search version. All caches fail open.

## Background jobs

| Queue       | Job           | When                         | What it does                                                          |
| ----------- | ------------- | ---------------------------- | --------------------------------------------------------------------- |
| `documents` | `ingest`      | after an upload event        | parse, chunk, embed, and index a document                             |
| `memory`    | `thread`      | 15 s after a reply, per chat | summary, long-term, and episodic memory                               |
| `system`    | `maintenance` | daily at 03:17 UTC           | old tokens, unanswered approvals, old checkpoints, abandoned sign-ins |

## Billing

| Concern       | Approach                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plans         | `PLANS` in `@tessel/contracts`: Free, Pro ($20), Max ($100), and Team ($30 a seat, two seats or more). Each has a five-hour and a weekly limit in model cost, per person per workspace, and a model tier.                                                                      |
| State         | `billing_accounts` (one row per paying workspace: plan, status, provider, subscription, seats, period, extra usage), `usage_windows` (when each person's windows started), `extra_usage_requests` (requests billed as extra), and `billing_events` (webhook IDs already seen). |
| Enforcement   | `createUsageLimits` runs before each chat and completion request: checks the model tier, then both windows against the usage ledger, then extra usage under its cap. A canceled plan counts as Free.                                                                           |
| Payments      | `modules/billing/providers.ts`: Stripe (Checkout, Billing Portal, invoice items) and Razorpay (subscriptions, add-ons), both over `fetch`. Webhooks at `/billing/webhooks/stripe` and `/billing/webhooks/razorpay` are verified with the raw body before JSON parsing.         |
| Plan changes  | Only verified webhooks change a plan. Switching plans updates the existing subscription; team seats follow membership.                                                                                                                                                         |
| Extra usage   | Charged at cost when a period closes, on the renewal invoice (Stripe) or the next charge (Razorpay).                                                                                                                                                                           |
| Local and e2e | `pnpm --filter @tessel/api mock-payments` (port 4600) plays Stripe and Razorpay, with payment pages and signed webhooks. Set `PAYMENTS_MOCK_URL` to use it; production refuses it.                                                                                             |

## Web app

| Concern          | Approach                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server data      | TanStack Query. Hooks and cache keys live in `@tessel/api-client/react`, so every page reads and invalidates data the same way.                                                                                                                                                                                                                                                 |
| UI state         | Zustand: the session (status, user, access token) and the last-opened workspace. Server data is never copied into Zustand.                                                                                                                                                                                                                                                      |
| HTTP             | One axios instance from `@tessel/api-client`. A request interceptor adds the access token; a response interceptor refreshes once on a 401 and retries. Concurrent 401s share a single refresh, a refresh that raced another tab is retried once, and only a rejected refresh (not a network error) signs the user out. Every response is validated against `@tessel/contracts`. |
| Access token     | Kept in memory only. On page load, the app exchanges the httpOnly refresh cookie for a new token.                                                                                                                                                                                                                                                                               |
| Route protection | Client-side gates (`RequireSession`, `GuestOnly`). The refresh cookie belongs to the API host, so the web server can't see it; the API is the real gate. `next` redirects only accept paths inside the app.                                                                                                                                                                     |
| Forms            | react-hook-form with the same Zod schemas the API uses. API field errors land on the matching input; other errors show at the top of the form.                                                                                                                                                                                                                                  |
| Streaming        | `fetch` with SSE for chat (`api.chat.send` in `@tessel/api-client`), since axios can't stream response bodies in the browser. It refreshes the token once on a 401, like axios.                                                                                                                                                                                                 |
| Design           | Tokens in `apps/web/app/globals.css` (Tailwind v4 `@theme`), with a matching dark palette. Fonts are bundled (Bricolage Grotesque for headings, Atkinson Hyperlegible Next for text). Shared components live in `@tessel/ui`.                                                                                                                                                   |
| Mobile           | The sidebar becomes a drawer below 768 px. Inputs use 16 px text so iOS doesn't zoom, tap targets are at least 44 px, and layouts use `dvh` and safe-area insets.                                                                                                                                                                                                               |

## Deployment

| Piece            | Where                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images           | `infra/docker/node.Dockerfile` (api, worker, mcp-server, migrate) and `infra/docker/web.Dockerfile`, built by `infra/scripts/build-images.sh`                                                |
| Production stack | `infra/deploy/docker-compose.prod.yml` with profiles: apps (always), `edge` (Caddy + HTTPS), `data` (databases on the host), `tools` (migrate job)                                           |
| Deploy           | `.github/workflows/deploy.yml` runs after CI passes on `main`: build, push to ECR, run `infra/deploy/deploy.sh` on EC2 through SSM                                                           |
| Secrets          | SSM Parameter Store under `/tessel/prod`, written to a root-only `.env` on each deploy                                                                                                       |
| Health           | Every service has a health check; deploys wait for all of them and roll back on failure                                                                                                      |
| Backups          | Nightly `pg_dump` and a Qdrant snapshot to S3 from a systemd timer when the databases run on the host (`infra/deploy/backup.sh`, `restore.sh`)                                               |
| Logs             | With `LOG_GROUP` set, every container logs to CloudWatch through a Compose override written by `deploy.sh`; otherwise rotated local files                                                    |
| CI safety net    | Every pull request builds all production images and boots the full production stack (`infra/scripts/smoke-test.sh`) with S3 and SQS emulators, including a signup through the real API image |

Setup steps: [infra/aws/README.md](../infra/aws/README.md).

## Conventions

- **Configuration:** Each app validates its environment with Zod at startup (`parseEnv`) and fails fast with every problem listed. Locally, `.env` at the repo root is loaded; in containers, variables come from the environment.
- **Errors:** Every error response has the shape `{ error: { code, message, requestId?, details? } }`.
- **Health:** Services expose `GET /health` (liveness). The API also exposes `GET /health/ready`, which checks every dependency with a timeout and returns 503 if any is down. Dependency error details are hidden in production.
- **Logging:** Structured JSON through `@tessel/logger`. Passwords, tokens, API keys, and auth headers are redacted.
- **Shutdown:** Apps close servers, workers, and connections on `SIGTERM` before exiting, with a forced exit after a timeout.
- **Jobs:** Queue names and payload schemas live in `@tessel/queue`. Workers validate payloads; bad input fails without retries.
- **Imports:** Workspace packages are imported by name (`@tessel/db`), never by relative path across packages.

## Security baseline

Built into each step as it lands; deep security testing comes after phase 1.

- Passwords hashed with Argon2id, short-lived access tokens, rotating refresh tokens with reuse detection (built in step 2).
- Membership checks on every tenant query, plus Postgres row-level security per workspace (built in step 2).
- Rate limits on every route, with stricter limits on auth routes (built in step 2).
- Workspace filters on every Qdrant and Neo4j query, and workspace-prefixed S3 keys.
- Moderation of user input before any chat model sees it (built in step 5); output moderation and prompt-injection checks on messages and uploaded documents.
- Daily spend caps per user, workspace, and service, and an append-only usage ledger for every model call (built in step 5).
- Retrieved documents, tool results, and MCP results are treated as data, never instructions.
- Workspace and user IDs come from the session, never from the model or tool arguments.
- Write and destructive tools require approval; every tool has a timeout and a call limit.
- Secrets live in AWS SSM Parameter Store in production, never in code or images.
