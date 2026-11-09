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

Each check is one command. CI runs exactly these commands.

| Check        | Command                | Tool                                      |
| ------------ | ---------------------- | ----------------------------------------- |
| Lint         | `npm run lint`         | ESLint with typescript-eslint, 0 warnings |
| Format check | `npm run format:check` | Prettier (`npm run format` fixes)         |
| Type check   | `npm run typecheck`    | `tsc` in every workspace                  |
| Tests        | `npm test`             | Vitest over every workspace               |
| All four     | `npm run check`        | The same four, in that order              |

## Layout

npm workspaces (decisions.md, D2):

| Folder            | What it is                                   |
| ----------------- | -------------------------------------------- |
| `packages/shared` | Code shared by the API and the worker        |
| `apps/api`        | NestJS HTTP API (added in PA#2)              |
| `apps/worker`     | Judge and constraint checker (added in PA#3) |
| `apps/web`        | React app (added in PA#3)                    |

A new workspace must have a `typecheck` script (`npm run typecheck` fails without one) and its own tests.
