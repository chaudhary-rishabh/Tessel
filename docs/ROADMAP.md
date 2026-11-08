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
| 15   | Memory and graph         | Caching layers                                                                 | Repeat requests hit the cache; re-indexing clears it |        |
| 16   | Memory and graph         | Neo4j graph RAG                                                                | A relationship question is answered from the graph   |        |
| 17   | Accounts, admin, billing | Email verification, password reset, OAuth, 2FA, mobile OTP, MCP server OAuth   | Each login method passes end-to-end tests            |        |
| 18   | Accounts, admin, billing | Admin app: users, model registry, usage, audit log                             | Only admins can open it, checked on the backend      |        |
| 19   | Accounts, admin, billing | Billing: plans, payments, usage limits, extra usage, team seats                | Upgrade, limit, and reset flows pass                 |        |
| 20   | Accounts, admin, billing | Full end-to-end test run, fixes, final deploy                                  | All tests pass and it's live                         |        |

## Later phases

- **Phase 2:** Website and app generation with live preview, artifacts, image and video generation, text to speech, transcription, voice.
- **Phase 3:** Load testing, deep security testing, red teaming, evals, polish.
