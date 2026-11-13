# Roadmap

Phase 1 is built in 20 steps. Each step ends tested, merged, and (from step 4) deployed.

| Step | Area                     | Delivers                                                                       | Done when                                            | Status |
| ---- | ------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------- | ------ |
| 1    | Foundation               | Monorepo, shared packages, app shells, local data services, CI                 | Everything installs, builds, and passes checks       | Done   |
| 2    | Foundation               | API core, email and password login, workspaces, roles, row-level security      | Login and cross-workspace tests pass                 | Done   |
| 3    | Foundation               | Web app shell, axios and token refresh, TanStack Query, Zustand, mobile layout | Login works end to end on desktop and mobile         | Done   |
| 4    | Foundation               | Docker images, CI/CD to ECR and EC2                                            | A push to main deploys automatically                 | Done   |
| 5    | Chat                     | AI gateway, model registry, moderation, usage ledger, daily cost cap           | Every model call is recorded                         | Done   |
| 6    | Chat                     | Streaming chat, stop, model picker, attachments                                | A streamed chat works on desktop and mobile          | Done   |
| 7    | Knowledge                | Ingestion: S3, SQS, worker, Qdrant hybrid search                               | An uploaded PDF reaches ready                        | Done   |
| 8    | Knowledge                | RAG pipeline and router with citations                                         | Answers cite the right chunks                        | Done   |
| 9    | Agents                   | Tool registry, ReAct agent, approvals                                          | Approve and reject work, even after a restart        | Done   |
| 10   | Agents                   | Orchestrator: plan-and-execute, reflection, supervisor                         | Each pattern can be reached from the chat box        | Done   |
| 11   | Agents                   | Built-in and custom skills                                                     | A user-created skill changes the agent's behaviour   | Done   |
| 12   | Agents                   | MCP client and connectors                                                      | A GitHub tool call works with approval               | Done   |
| 13   | Agents                   | MCP server with personal access tokens                                         | An outside MCP client can search the workspace       | Done   |
| 14   | Memory and graph         | Short-term, summary, long-term, and episodic memory                            | Memory carries across threads and can be edited      | Done   |
| 15   | Memory and graph         | Caching layers                                                                 | Repeat requests hit the cache; re-indexing clears it | Done   |
| 16   | Memory and graph         | Neo4j graph RAG                                                                | A relationship question is answered from the graph   | Done   |
| 17   | Accounts, admin, billing | Email verification, password reset, OAuth, 2FA, mobile OTP, MCP server OAuth   | Each login method passes end-to-end tests            | Done   |
| 18   | Accounts, admin, billing | Admin app: users, model registry, usage, audit log                             | Only admins can open it, checked on the backend      | Done   |
| 19   | Accounts, admin, billing | Billing: plans, payments, usage limits, extra usage, team seats                | Upgrade, limit, and reset flows pass                 | Done   |
| 20   | Accounts, admin, billing | Full end-to-end test run, fixes, final deploy                                  | All tests pass and it's live                         | Done   |

## Phase 2

Phase 2 adds voice, generated media, and generated apps, then clears the Phase 2 backlog. Voice comes first. Each step ends tested and merged; the EC2 host stays stopped until the whole phase is done, then everything deploys together.

| Step | Area      | Delivers                                                                                                     | Done when                                                                      | Status      |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------- |
| 21   | Voice     | LiveKit server, voice agent (speech to text, model, text to speech), voice sessions, transcripts in the chat | A spoken turn round-trips through the agent in CI and is saved to the chat     | In progress |
| 22   | Voice     | Voice mode: full-screen talk view, live captions, mute, interrupt, mobile                                    | A browser with a fake microphone holds a conversation end to end               | Not started |
| 23   | Voice     | Your own voice: record with consent and a spoken check, clone, choose, delete                                | A verified recording becomes a voice the agent speaks with                     | Not started |
| 24   | Voice     | Read aloud, dictation in the composer, documents and memory in voice, latency dashboard in admin             | Every reply can be heard; p50 and p95 voice latency show in admin              | Not started |
| 25   | Artifacts | Code, HTML, React, SVG, Mermaid, and documents open in a side panel with versions                            | A generated page renders in a sandboxed frame and keeps its versions           | Not started |
| 26   | Apps      | Multi-file website and app generation with a live preview, export, and download                              | A generated app runs in the preview and downloads as a project                 | Not started |
| 27   | Media     | Image generation and editing in chat, with a gallery                                                         | An image is generated, edited, and saved to the gallery                        | Not started |
| 28   | Media     | Video generation as a background job, with progress                                                          | A video job finishes in the worker and plays in the chat                       | Not started |
| 29   | Media     | Transcription of audio and video uploads into searchable documents                                           | An uploaded recording is transcribed and answers questions with citations      | Not started |
| 30   | Backlog   | The Phase 2 items in BACKLOG.md                                                                              | Each item ships with its tests                                                 | Not started |
| 31   | Release   | Full end-to-end run, fixes, deploy, live checks                                                              | All tests pass, it's live, and voice latency meets the target on the live host | Not started |

### Voice targets

- **Latency:** under 600 ms from the end of the user's speech to the first audio of the reply, at the median, measured per turn (end-of-turn delay + time to the model's first token + time to the first audio) and shown in admin. 95th percentile under 900 ms.
- **Feels like a conversation:** the user can interrupt at any point, the agent stops within a few hundred milliseconds, and a pause mid-sentence doesn't end the turn.
- **Kept like a chat:** every voice conversation is a chat, with its transcript, usage, and limits, and can be continued by text.

## Later phases

- **Phase 3:** Load testing, deep security testing, red teaming, evals, polish.
