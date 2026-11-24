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

`POST /v1/labs/{labId}/submissions` is specified in [`docs/contract/post-lab-submissions.md`](docs/contract/post-lab-submissions.md). `POST /v1/auth/login` accepts an email and password and returns a one-hour bearer token. The other D17 routes list and create classes and labs, assign TAs and students, and list a student's own submission statuses. Hidden test input and output are returned to the TA only. The judge worker is separate work: until it is connected, submissions remain `queued`.

## Initial administrator and web app

Apply the migrations and build the API first. Set `DATABASE_URL` in the shell for the bootstrap command. It accepts an email and display name as arguments and the password on standard input; it never accepts a password as a command-line argument. It creates an admin or activates an existing seeded admin, and refuses to run after an admin has credentials. Use a password of at least 12 characters. For example, in PowerShell, read the password without displaying it:

```powershell
$securePassword = Read-Host 'Initial admin password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) | npm run bootstrap-admin --workspace @leetkob/api -- admin@example.test 'Admin'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
```

Start the API and run `npm run dev --workspace @leetkob/web` for the web app. The Vite development server proxies `/v1` to the local API. Sign in as the admin, create a class and assign a TA; the TA can add students and create labs with statements, constraints and test cases. A new account needs an initial password; assigning an existing account never changes its password. Students see their own submissions, polled every two seconds. Keep the API and web app behind HTTPS outside local development.

### TA review queue

The TA's class page lists constraint proposals and their evidence. A TA explicitly chooses pass or violation; a violation requires matching source lines. Changes retain a history, and the deduction is always read from the lab's constraint. Students cannot access this queue and do not see proposals before publication (Theo FAQ-08: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-08). Only the latest submission per student and lab appears (Theo FAQ-02: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-02). There is no Publish action in PA#3.

The worker integration boundary is `PostgresReviewQueue.storeProposals(submissionId, proposals)` from `@leetkob/db`: it accepts proposals only after `judge_results` records `AC`, validates evidence against the stored source, and deduplicates by submission and constraint. The judge/check worker still needs to write `judge_results` and the per-test verdicts in `judge_test_results`, then call this boundary for Accepted submissions; this branch does not claim that the queue-to-model pipeline is already connected. The student sees only their own overall and per-test verdicts, never the test input or expected output.

For the worker integration, `judge()` on `feat/pa3-judge-sandbox` returns an overall `status` and an ordered `tests` array; persist each test status with a one-based `position` in `judge_test_results`. The checker `check()` on `feat/checker-model-call` returns `verdicts` in the shape accepted by `storeProposals`; call it only after an `AC` result is stored, then pass its `verdicts` to the queue. Keep the checker call log separately as required by D14. These interfaces live on separate branches and require integration and an end-to-end test when the worker is available.

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
