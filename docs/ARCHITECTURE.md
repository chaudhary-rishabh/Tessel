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

| App               | Purpose                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `apps/web`        | Next.js user app: chat, uploads, approvals, settings                  |
| `apps/api`        | Express 5 API, split into feature modules                             |
| `apps/worker`     | Background jobs (BullMQ) and S3 upload events (SQS)                   |
| `apps/mcp-server` | Exposes workspace search and actions to outside MCP clients           |
| `apps/admin`      | Admin app for users, models, usage, and audit logs (added in step 18) |

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
| `@tessel/ai`         | Gateway client, model registry, prompts, graphs, RAG | Step 5  |
| `@tessel/tools`      | Built-in tools and the tool registry                 | Step 9  |
| `@tessel/skills`     | Built-in skills                                      | Step 11 |

## Data stores

| Store       | Holds                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| Postgres    | Source of truth: users, workspaces, threads, messages, documents, usage, agent checkpoints, long-term memory |
| Qdrant      | Chunk and memory vectors (dense + sparse), always filtered by workspace                                      |
| Neo4j       | Entities and relationships for graph RAG, always filtered by workspace                                       |
| Redis cache | Caching, rate limits, live run events. Evicts least-recently-used keys                                       |
| Redis queue | BullMQ only. Never evicts, persists to disk                                                                  |
| S3          | Original files, parsed text, artifacts. Keys start with the workspace ID                                     |

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

Every request passes through, in order: request ID, security headers, rate limit, authentication, Zod validation, permission check, controller, and one shared error handler.

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

- Passwords hashed with argon2, short-lived access tokens, rotating refresh tokens with reuse detection.
- Ownership checks on every resource, plus Postgres row-level security per workspace.
- Workspace filters on every Qdrant and Neo4j query, and workspace-prefixed S3 keys.
- Moderation on input and output, prompt-injection checks on messages and uploaded documents.
- Retrieved documents, tool results, and MCP results are treated as data, never instructions.
- Workspace and user IDs come from the session, never from the model or tool arguments.
- Write and destructive tools require approval; every tool has a timeout and a call limit.
- Secrets live in AWS Secrets Manager in production, never in code or images.
