# Contributing

## Workflow

1. Create a branch from `main`: `feat/<step>-<short-name>` (for example `feat/02-auth`), or `fix/<short-name>`.
2. Keep each pull request to one roadmap step or one fix.
3. Before pushing, run `pnpm check` (lint, format, typecheck, tests) and `pnpm build`.
4. Open a pull request; CI must pass before merging.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, with an optional scope, for example `feat(api): add refresh token rotation`.

## Code rules

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md) before larger changes. Record new architectural choices in DECISIONS.md.
- Validate all external input with Zod: environment, request bodies, job payloads, model output.
- New API features follow the module layout in ARCHITECTURE.md.
- No `console.log`; use `@tessel/logger`.
- Every feature ships with tests: integration tests for API routes, unit tests where logic is non-trivial.
- Never commit secrets. `.env` is ignored; add new variables to `.env.example` with a safe placeholder.
- Put ideas that are out of scope for the current change in [docs/BACKLOG.md](docs/BACKLOG.md).
