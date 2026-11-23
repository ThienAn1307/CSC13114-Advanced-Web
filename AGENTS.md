# AGENTS.md

Rules for every assistant, and every person, working in this repo. A line is added only when something went wrong or a rubric asks for it; its story is in brackets (decisions.md D7).

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
- Give the judge sandbox network access, root, a host mount, the Docker socket, or any environment variable holding a secret (brief, section 5). On its `docker run` line, `-v /var/run/docker.sock`, `--privileged`, `--env-file` and `-e GEMINI_API_KEY` are each a stop, and so is the same thing set as an option when the container is created through the Docker API: a socket or host path in `HostConfig.Binds` or `Mounts`, `HostConfig.Privileged: true`, or a secret in `Env`. [PA#3 rubric, "Catching your assistant"]
- Write a memory-limit test that does not read back the memory it allocates. [The compiler removes an allocation nobody reads, and the test passes with no limit at all; session 6, slide 16]
- Call the real model in unit tests. Use a fake. [Before PA#3 the test runner loaded the whole `.env`, so a test could see `GEMINI_API_KEY`; Phú Dinh found it on PR #10. The root `vitest.config.ts` now takes only `DATABASE_URL` from `.env` and removes `GEMINI_API_KEY` and `GOOGLE_API_KEY` from every test run through it (`npm test`); CI sets fake keys to prove it, PR #12]
- Change any file in `eval/dev/`, for any reason. It is the published dev set, byte for byte. [Graders compare its SHA-256 with their copy; PA#3 rubric, "Catching your assistant"]
- Name a dev-set solution (such as `sort-merge/s05`) or quote dev-set code in a prompt or a hard rule. [A checker tuned to the dev set fails on the held-out set; graders search prompts and rules for dev-set ids]
- Call a run on the dev set "real" when its call log has no provider request ids. [Graders read that as a mocked model; PA#3 rubric, criterion 4]
- Squash or rebase a pull request into `main`, or rebuild the history after the work is done. Merge with a merge commit. [PA#3 rubric, criterion 7: it scores one part per commit, tests first, from the commit times; a squash merge folds a test commit and its code commit into one]
- Edit a test, the eval data, a label or the contract to make a check pass. Fix the code, or ask.
- Lower `--audit-level`, turn off a lint rule or raise `--max-warnings` to get green.
- Run `npm audit fix --force`. [It would downgrade ESLint to 9.39.5 and break our config; see the npm audit step of PR #1's CI run: https://github.com/ThienAn1307/CSC13114-Advanced-Web/actions/runs/42584766846]
- Pipe a check's output into another command in CI or in a script used as evidence. If you must, set `shell: bash`, which adds `pipefail`. [GitHub Actions runs our steps as `bash -e {0}`, without `pipefail`, so a failing command before a pipe still passes; see PR #1's CI run: https://github.com/ThienAn1307/CSC13114-Advanced-Web/actions/runs/42584766846]
