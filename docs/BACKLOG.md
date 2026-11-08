# Backlog

Things noticed along the way that are not needed yet. Each item names the step where it fits best.

- **Local S3 and SQS:** Pick free local emulators or a real AWS development account (see D-013). (Step 7)
- **Neo4j health check:** Switch the readiness probe from HTTP to a Bolt `RETURN 1` once the driver is added. (Step 16)
- **TypeScript 7:** Upgrade when `typescript-eslint` supports it (see D-003).
- **Signup email enumeration:** Signup returns `email_taken`. Switch to a neutral response once email verification exists. (Step 17)
- **Session list:** Let users see and revoke their active sessions (data is already stored per refresh token family). (Step 17)
- **Token cleanup:** Scheduled worker job to delete expired and long-revoked refresh tokens. (Step 15)
- **Member management:** Endpoints to invite, change roles, and remove workspace members (RLS policies already cover these). (Step 18)
- **Forgot password link:** Add to the login page with the reset flow. (Step 17)
- **Theme switch:** Let users override the system light or dark setting. (Step 20)
- **Toasts:** A shared notification pattern for actions that finish away from their form. (Step 6)
- **Visual regression:** Screenshot comparisons in CI for key screens. (Phase 3)
- **Database backups:** Nightly `pg_dump` of the on-host Postgres to S3, plus a tested restore. Not needed once on RDS. (Step 7, with S3)
- **Centralised logs:** Ship container logs to CloudWatch (the `awslogs` driver) with retention. (Step 20)
- **Image vulnerability scans in CI:** Run Trivy on the built images. (Phase 3)
- **Gateway cost reconciliation:** Compare ledger costs with the gateway's own usage report nightly, and use the cost the gateway reports for chat calls too (it is already used for embeddings). (Step 18)
- **Plan tiers for models:** Enforce each model's `tier` against the workspace's plan. (Step 19)
- **Global cap during a Redis outage:** The ledger fallback covers user and workspace caps; the service-wide cap waits for Redis. A cached daily total would close the gap. (Step 15)
- **Output moderation:** Check model replies as well as user input, starting with streamed chat. (Step 6)
- **Anthropic fallback test:** The direct Anthropic route is built but only the OpenAI route is covered by tests. Add a mock of the Messages API. (Step 20)
- **Prompt caching:** Turn on the gateway's automatic caching for long system prompts and documents. (Step 15)
