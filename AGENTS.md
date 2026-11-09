# AGENTS.md

Rules for every assistant, and every person, working in this repo. A line is added only when something went wrong; its story is in brackets (decisions.md D7).

## Stack

TypeScript, strict, ES modules, in npm workspaces (D1, D2). NestJS 12, PostgreSQL 16 with Drizzle, BullMQ on Redis, Vitest with `unplugin-swc` (D3). Model: Gemini Flash-Lite, free tier (D8). Nothing else without asking.

- Tests use Vitest. Do not add Jest. [Jest could not load NestJS 12, which ships only as ES modules, without an experimental Node flag; see decisions.md D3.]
- Keep `typescript` at `~6.0` until typescript-eslint supports 7. [TypeScript 7.0 is out, but typescript-eslint 8.72 accepts only `<6.1.0`, so installing the latest breaks lint; see the pin in package.json, commit 153240b.]

## Commands

| What                         | Command                                    |
| ---------------------------- | ------------------------------------------ |
| Lint                         | `npm run lint`                             |
| Format check                 | `npm run format:check`                     |
| Type check                   | `npm run typecheck`                        |
| Tests                        | `npm test`                                 |
| All four, as CI runs them    | `npm run check`                            |
| Format the files you changed | `npx prettier --write <files you changed>` |

- Run `npm run check` before every commit. CI (`.github/workflows/ci.yml`, job `gates`) runs the same command.
- Format only the files you changed, never `npm run format`.

## Conventions

- Errors are RFC 9457 `application/problem+json`. A `type` comes only from `docs/contract/`.
- Times are UTC, ISO 8601 with `Z`.
- Cite the FAQ in place: `Theo FAQ-NN: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-NN`.
- A decision changes only through a PR that edits `docs/decisions.md` and says why.
- The contract changes in its own commit, never together with code that breaks it.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `chore:`). One branch and one PR per change.

## Permissions

- **Allowed:** read and search the repo; `npm run check`, `lint`, `format:check`, `typecheck`, `test`; `npx prettier --write` on files you changed; `git status`, `git diff`, `git log`; the local dev server; `docker compose` on your machine.
- **Ask first:** `git commit`; `git push`; opening a PR; adding or upgrading a dependency; a migration file; anything under `.github/`, `CODEOWNERS`, `docs/contract/`, `docs/decisions.md`; the eval data.
- **Never:** everything in the next section. A person types these, if ever.

## Never

- Commit or push to `main`, or force-push.
- Read or write `.env`, or put a key anywhere but `.env` (not in code, tests, logs, prompts or CI files).
- Give the judge sandbox network access, root, a host mount, the Docker socket, or any environment variable holding a secret (brief, section 5).
- Call the real model in unit tests. Use a fake.
- Edit a test, the eval data, a label or the contract to make a check pass. Fix the code, or ask.
- Lower `--audit-level`, turn off a lint rule or raise `--max-warnings` to get green.
- Run `npm audit fix --force`. [It would downgrade ESLint to 9.39.5 and break our config; see the npm audit step of PR #1's CI run: https://github.com/ThienAn1307/CSC13114-Advanced-Web/actions/runs/42584766846]
- Pipe a check's output into another command in CI or in a script used as evidence. If you must, set `shell: bash`, which adds `pipefail`. [GitHub Actions runs our steps as `bash -e {0}`, without `pipefail`, so a failing command before a pipe still passes; see PR #1's CI run: https://github.com/ThienAn1307/CSC13114-Advanced-Web/actions/runs/42584766846]
