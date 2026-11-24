# LeeTKOB

C++ lab judge with an LLM constraint checker that proposes deductions with evidence lines; the TA reviews them before marks are published.
CSC13114 Advanced Web Application Development, HCMUS, team 23120018-23120031-23120040.

- What we build against: [`docs/sources.md`](docs/sources.md) (class brief, then the product owners' FAQ)
- Why the stack and the rules look the way they do: [`docs/decisions.md`](docs/decisions.md)
- Member X's API, DTOs and integration interface for Y: [`docs/member-x-handoff.md`](docs/member-x-handoff.md)

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

## Run the API

```bash
npm run build --workspace @leetkob/api
npm start --workspace @leetkob/api           # reads DATABASE_URL, JWT_SECRET and PORT from .env
```

`POST /v1/labs/{labId}/submissions` is specified in [`docs/contract/post-lab-submissions.md`](docs/contract/post-lab-submissions.md). There is no login endpoint in PA#2: sign an HS256 token with `JWT_SECRET`, `sub` set to a seeded user id (`packages/db/src/seed.ts`), `role` set to `student` and `exp` set to a future expiry time in seconds since the Unix epoch (contract, section 1). Nothing consumes the queue in PA#2; submissions stay `queued` in the database until the worker arrives in PA#3.

## Layout

npm workspaces (decisions.md, D2):

| Folder             | What it is                                                                |
| ------------------ | ------------------------------------------------------------------------- |
| `packages/shared`  | Code shared by the API and the worker                                     |
| `packages/db`      | Drizzle schema, migrations, seed, data layer                              |
| `packages/checker` | Constraint checker: tokenizer, hard rules, `check()`, the checker command |
| `apps/api`         | NestJS HTTP API (added in PA#2)                                           |
| `apps/worker`      | Judge and constraint checker (added in PA#3)                              |
| `apps/web`         | React app (added in PA#3)                                                 |
| `tests/harness`    | Tests of the harness itself (added in PA#3)                               |
| `eval/dev`         | The lecturer's dev set, byte for byte                                     |

`eval/dev` is [fithcmus/awad-leetkob-eval](https://github.com/fithcmus/awad-leetkob-eval) at commit `552c811`, unchanged: `eval/dev.sha256` lists the SHA-256 of every published file, and `tests/harness/src/dev-set.test.ts` fails if a file is changed, added or missing. Lint and Prettier skip it. Score a prediction file with `node eval/dev/eval.mjs --data eval/dev --predictions <file.jsonl>`.

A new workspace must have a `typecheck` script (`npm run typecheck` fails without one) and its own tests.

## Run the checker

The checker reads a folder with the dev set's layout (`problems/<id>/statement.md`, `problems/<id>/constraints.json`, `solutions/<id>/*.cpp`; nothing else) and writes one prediction line per (solution, constraint) for `eval.mjs` (decisions.md D20). Ban lists are decided by the hard rules (D13). With `MODEL_OFF=1` every semantic constraint is `unsure`, and no model client is created and no connection is opened; without it, one Gemini call per semantic constraint decides it.

```bash
MODEL_OFF=1 npm run checker -- --data eval/dev --out predictions.jsonl
node eval/dev/eval.mjs --data eval/dev --predictions predictions.jsonl     # exit 0 or 1, never 2
```

The same command in a container, with no network (the image needs no `npm install`: Node 24 runs the TypeScript sources):

```bash
docker build -f checker/Dockerfile -t leetkob-checker packages/checker
mkdir -p out
docker run --rm --network none -e MODEL_OFF=1 --user "$(id -u):$(id -g)"   -v "$PWD/eval/dev:/data:ro" -v "$PWD/out:/out" leetkob-checker --data /data --out /out/predictions.jsonl
```

With the model on, the command needs `GEMINI_API_KEY` in the environment (it exits 2 without it, and it reads no file for it). `GEMINI_MODEL` is optional; the default is the model of decisions.md D8. `--calls` writes the call log, one JSONL line per call:

```bash
npm run checker -- --data eval/dev --out predictions.jsonl --calls calls.jsonl
```

### The real runs and what one lab costs

Two runs with the real model are committed, each with its predictions, the `eval.mjs` report and a call log (Google's request ids, tokens, time; the second also has the prompt sent and the cost of each call). Neither meets all three thresholds; their READMEs say why. The runs use different models and prompts, so they are not a before-and-after.

| Run                                                                                        | Dev set: wrongful / recall / unsure | Own cases              |
| ------------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------- |
| [`2026-11-23-gemini-3.1-flash-lite`](eval/runs/2026-11-23-gemini-3.1-flash-lite/README.md) | 2 / 86.5% / 5.9%                    | not run                |
| [`2026-11-25-gemini-3.5-flash-lite`](eval/runs/2026-11-25-gemini-3.5-flash-lite/README.md) | 2 / 91.9% / 2.9%                    | 0 / 100% / 0% (passes) |

Cost of one lab, with the arithmetic, from the second run (`gemini-3.5-flash-lite`, 790 input and 122 output tokens per answered call, list price $0.30 and $2.50 per 1M tokens, read on Google's pricing page on 2026-11-25): one call is 790 × 300 + 122 × 2500 = 542,000 nano-USD. A lab of 80 Accepted submissions with 2 semantic constraints is 160 calls, 160 × 542,000 = 86,720,000 nano-USD = **$0.0867 at the paid price, $0 on the free tier we use** (both prices "Free of charge" there). At one call every 4.5 s (under 15 per minute) that is about 12 minutes, and 160 calls are under the free tier's 500 per day.

## Model, spending and secrets

- The constraint checker will use Gemini Flash-Lite on the **free tier**, with a key created on a Google project that has **no billing account attached**, so the key cannot be charged: the spending limit is 0 (decisions.md D8). No model is called in PA#2, and no key exists in this repository or its history.
- From PA#3 our own limits are enforced in code: a maximum number of model calls per lab, and a request rate below the free-tier limit. Over either limit, the remaining pairs become `unsure`. Theo FAQ-09: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-09
- Only the lab statement, its constraints, and the code with comments, names and student IDs removed will leave our system. On the free tier Google's reviewers may read API input and output ([Gemini API terms](https://aistudio.google.com/docs/terms)), so nothing identifying is sent.
- Keys live only in `.env`, which git ignores. [`.env.example`](.env.example) lists every variable, with no values. The judge sandbox never gets a key.
- Model: `gemini-3.1-flash-lite`. Free-tier limits of our development project, read in AI Studio on 2026-11-23: 15 requests per minute, 250,000 tokens per minute, 500 requests per day, per project (decisions.md D8). The checker keeps its request rate below 15 per minute. A dev-set run is 47 model calls (the other 55 pairs are decided by the hard rules).
