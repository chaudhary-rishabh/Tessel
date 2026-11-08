# Backlog

Things noticed along the way that are not needed yet. Each item names the step where it fits best.

- **Dependency updates:** Add Renovate or Dependabot for packages, Docker images, and GitHub Actions. (Step 4)
- **Local S3 and SQS:** Pick free local emulators or a real AWS development account (see D-013). (Step 7)
- **Neo4j health check:** Switch the readiness probe from HTTP to a Bolt `RETURN 1` once the driver is added. (Step 16)
- **TypeScript 7:** Upgrade when `typescript-eslint` supports it (see D-003).
- **Signup email enumeration:** Signup returns `email_taken`. Switch to a neutral response once email verification exists. (Step 17)
- **Session list:** Let users see and revoke their active sessions (data is already stored per refresh token family). (Step 17)
- **Token cleanup:** Scheduled worker job to delete expired and long-revoked refresh tokens. (Step 15)
- **Member management:** Endpoints to invite, change roles, and remove workspace members (RLS policies already cover these). (Step 18)
