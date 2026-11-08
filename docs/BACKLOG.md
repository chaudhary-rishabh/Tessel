# Backlog

Things noticed along the way that are not needed yet. Each item names the step where it fits best.

- **Dependency updates:** Add Renovate or Dependabot for packages, Docker images, and GitHub Actions. (Step 4)
- **Local S3 and SQS:** Pick free local emulators or a real AWS development account (see D-013). (Step 7)
- **Neo4j health check:** Switch the readiness probe from HTTP to a Bolt `RETURN 1` once the driver is added. (Step 16)
- **TypeScript 7:** Upgrade when `typescript-eslint` supports it (see D-003).
- **Request logging:** Add request-scoped logging with request IDs. (Step 2)
