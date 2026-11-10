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

Tests that need the database read `DATABASE_URL`: CI provides PostgreSQL 16 as a service, and locally you set `DATABASE_URL` in `.env` to the PostgreSQL 16 started by `docker compose` (next section). A database test that finds no `DATABASE_URL` fails; it never skips, because a skipped test keeps the gate green on a broken build. Each test file creates its own throwaway database next to the one in `DATABASE_URL`, migrates it from zero and drops it afterwards, so tests never touch your dev data.

## Local database

```bash
docker compose up -d --wait                  # PostgreSQL 16, same image as CI, on 127.0.0.1:5432
# in .env: DATABASE_URL=postgresql://postgres@localhost:5432/leetkob
npm run migrate --workspace @leetkob/db      # apply the committed SQL migrations
npm run seed --workspace @leetkob/db         # fixed users, classes and labs (packages/db/src/seed.ts)
```

After changing `packages/db/src/schema.ts`, run `npm run generate --workspace @leetkob/db` and commit the new file in `packages/db/drizzle/`. The seed is safe to run again; it moves the lab windows to the current time, so the open lab stays open.

## Layout

npm workspaces (decisions.md, D2):

| Folder            | What it is                                   |
| ----------------- | -------------------------------------------- |
| `packages/shared` | Code shared by the API and the worker        |
| `packages/db`     | Drizzle schema, migrations, seed, data layer |
| `apps/api`        | NestJS HTTP API (added in PA#2)              |
| `apps/worker`     | Judge and constraint checker (added in PA#3) |
| `apps/web`        | React app (added in PA#3)                    |

A new workspace must have a `typecheck` script (`npm run typecheck` fails without one) and its own tests.

## Model, spending and secrets

- The constraint checker will use Gemini Flash-Lite on the **free tier**, with a key created on a Google project that has **no billing account attached**, so the key cannot be charged: the spending limit is 0 (decisions.md D8). No model is called in PA#2, and no key exists in this repository or its history.
- From PA#3 our own limits are enforced in code: a maximum number of model calls per lab, and a request rate below the free-tier limit. Over either limit, the remaining pairs become `unsure`. Theo FAQ-09: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-09
- Only the lab statement, its constraints, and the code with comments, names and student IDs removed will leave our system. On the free tier Google's reviewers may read API input and output ([Gemini API terms](https://aistudio.google.com/docs/terms)), so nothing identifying is sent.
- Keys live only in `.env`, which git ignores. [`.env.example`](.env.example) lists every variable, with no values. The judge sandbox never gets a key.
- The exact model id and the free-tier rate limits are written here before PA#3 (decisions.md D8).
