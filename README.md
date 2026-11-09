# LeeTKOB

C++ lab judge with an LLM constraint checker that proposes deductions with evidence lines; the TA reviews them before marks are published.
CSC13114 Advanced Web Application Development, HCMUS, team 23120018-23120031-23120040.

- What we build against: [`docs/sources.md`](docs/sources.md) (class brief, then the product owners' FAQ)
- Why the stack and the rules look the way they do: [`docs/decisions.md`](docs/decisions.md)

## Setup

Node 24.9 or later (`.nvmrc` says 24).

```bash
npm ci
```

## Checks

Each check is one command, and each also runs locally. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml), job `gates`) runs `npm ci`, then `npm run check`, then `npm audit --audit-level=high`.

| Check            | Command                        | Tool                                                       |
| ---------------- | ------------------------------ | ---------------------------------------------------------- |
| Lint             | `npm run lint`                 | ESLint with typescript-eslint, 0 warnings                  |
| Format check     | `npm run format:check`         | Prettier (`npm run format` fixes)                          |
| Type check       | `npm run typecheck`            | `tsc` in every workspace                                   |
| Tests            | `npm test`                     | Vitest over every workspace                                |
| All four         | `npm run check`                | The same four, in that order                               |
| Dependency audit | `npm audit --audit-level=high` | npm; fails on a high or critical advisory (also run by CI) |

Tests that need the database read `DATABASE_URL`: CI provides PostgreSQL 16 as a service, and locally you set `DATABASE_URL` in `.env` to a local PostgreSQL 16 (Phú Dinh's `docker compose` will provide one). A database test that finds no `DATABASE_URL` fails; it never skips, because a skipped test keeps the gate green on a broken build.

## Layout

npm workspaces (decisions.md, D2):

| Folder            | What it is                                   |
| ----------------- | -------------------------------------------- |
| `packages/shared` | Code shared by the API and the worker        |
| `apps/api`        | NestJS HTTP API (added in PA#2)              |
| `apps/worker`     | Judge and constraint checker (added in PA#3) |
| `apps/web`        | React app (added in PA#3)                    |

A new workspace must have a `typecheck` script (`npm run typecheck` fails without one) and its own tests.
