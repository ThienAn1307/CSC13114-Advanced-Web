# Decisions

Engineering choices for LeeTKOB that the brief leaves to the team (brief, section 5), with the reason for each.
Product behaviour comes from the brief and the FAQ first; see [`sources.md`](sources.md).

**Status:** proposed by Thiên Ân (23120018) on 2026-11-09, **to be confirmed by Phú Dinh and Hoàng Hải**.
A decision changes only through a pull request that edits this file and says why.

## D1. TypeScript everywhere

One language for the API, the worker, the checker and the web app. Checks: ESLint, Prettier, `tsc`, Vitest.

**Why:** PA#2 criterion 3 wants each check as one command, the same locally and in CI. A second language doubles every check. `eval.mjs` already needs Node in CI.

## D2. One repository, a monolith plus a worker

npm workspaces: `apps/api` (HTTP), `apps/worker` (judge and checker, consumes the queue), `apps/web` (React), `packages/shared` (shared types and helpers).
`apps/web` is added in PA#3, not PA#2: a React shell earns no PA#2 points and adds its own lint, typecheck and test setup.

**Why:** the brief requires a queue between submitting and judging (section 4, item 2), and the judge must start sandbox containers. A separate worker keeps Docker access out of the API process. Only the worker touches Docker; only the checker code reads the model key. Three services would mean more deployables and message contracts than the team needs (brief, section 5: fewer moving parts is legitimate).

## D3. NestJS 12, PostgreSQL 16, Drizzle, BullMQ on Redis, Vitest

| Part           | Choice                                                         | Why                                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP framework | NestJS 12, request validation with `class-validator` DTOs      | A team member has built a NestJS app; guards fit the role and ownership checks. NestJS 12 keeps `class-validator` "fully supported" ([v12 release notes](https://github.com/nestjs/nest/releases/tag/v12.0.0)) |
| Database       | PostgreSQL 16                                                  | Transactions and row locks for Publish; a unique index for idempotency keys; two processes share it safely                                                                                                     |
| Query layer    | Drizzle, SQL migrations committed and reviewed                 | Typed queries that read like SQL; no runtime engine                                                                                                                                                            |
| Queue          | BullMQ on Redis (`@nestjs/bullmq`)                             | First-party NestJS module; Redis is reused for real-time results in PA#5                                                                                                                                       |
| Tests          | Vitest with `unplugin-swc`, one `npm test` over all workspaces | See below                                                                                                                                                                                                      |

**Why Vitest, not Jest**: NestJS 12 packages ship only as ES modules. Plain Jest failed to load them ("Must use import to load ES Module"); Jest passed only with `NODE_OPTIONS=--experimental-vm-modules`, an experimental Node flag. The v12 release notes say "Vitest is the default test runner for ESM projects". Vitest 5.1 with `unplugin-swc` (SWC emits the decorator metadata NestJS needs) passed the same NestJS and React tests with no flag.

## D4. The PA#2 contract is `POST /v1/labs/{labId}/submissions`

**Why:** it is on the PA#3 critical path, so the work is reused, and it has the errors we least want a stranger to see: class membership, the time window, size limits and retried uploads. We did not pick `publish` because the session 7 starter already has that contract.

## D5. Who is calling (PA#2)

- The API verifies `Authorization: Bearer <JWT>` (user id and role) with a Passport JWT guard. There is no login endpoint yet; contract tests sign tokens with their own test-only secret, set in the test setup; `.env.example` lists `JWT_SECRET` with no value.
- No token or a bad token: 401.
- The **role check runs first**: anyone who is not a student gets 403 `forbidden-role` for any `labId`, so the response says nothing about which labs exist.
- A student who is not a member of the lab's class gets 404 `lab-not-found`, the same as for a lab that does not exist (FAQ-01: students see only their own class's labs).

## D6. Rules of the submission endpoint

| Topic             | Rule                                                                                                                                                                                                                                                                                                         | Why                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Body              | `application/json`, `{ "source": string }`, at most 64 KB counted in UTF-8 bytes                                                                                                                                                                                                                             | FAQ-05 size limit; one shape to validate. The web app reads a `.cpp` file and sends its text |
| Success           | `202 Accepted`, `Location: /v1/submissions/{id}`, body `{id, labId, status: "queued", receivedAt, sizeBytes}`                                                                                                                                                                                                | Judging is asynchronous; 202 does not suggest it is done                                     |
| `Idempotency-Key` | Required header. Missing: 400 `idempotency-key-missing`. Same key and same body: the original 202 is replayed, nothing new is created. Same key and different body: 422 `idempotency-key-reused`. Scoped per (student, lab), stored in the same transaction as the submission, successes only, kept 24 hours | A retried upload must not create two submissions (PA#2 rubric, criterion 5)                  |
| Time window       | Before the lab opens: 409 `lab-not-open`. After the deadline: 409 `lab-closed`. Judged by the time the server receives the request                                                                                                                                                                           | FAQ-03: no late work; receive time decides                                                   |
| Bad body          | Over 64 KB: 413 `source-too-large`. Missing, empty or wrong type: 422 `validation-failed` with `errors[]` listing every broken field. Malformed JSON: 400 `malformed-json`                                                                                                                                   | Size is a limit, not a field error; list every broken field (session 5)                      |
| Body limit        | The JSON body parser accepts up to 256 KB, so a source just over 64 KB reaches our own 413. A body over 256 KB, and malformed JSON, still come back as `problem+json` from the global exception filter                                                                                                       | Verified by prototype on 2026-11-09                                                          |
| Enqueue fails     | The submission is saved as `queued` and the student still gets 202. A worker sweep re-enqueues rows still `queued` after a set delay                                                                                                                                                                         | A submission received on time must not be lost, or turn into `lab-closed` on retry           |
| Errors            | Every error is RFC 9457 `application/problem+json`; clients branch on `type`                                                                                                                                                                                                                                 | Criterion 5                                                                                  |
| Versioning        | `/v1` in the path. Inside v1 only additive changes; clients ignore fields they do not know. A breaking change becomes `/v2`, and v1 keeps its behaviour until a Sunset date                                                                                                                                  | Criterion 5: what happens when it changes                                                    |

The full contract goes in `docs/contract/post-lab-submissions.md`.

## D7. Rules file for mixed assistants

`AGENTS.md` is the only rules file. `CLAUDE.md` contains one line, `@AGENTS.md`, so Claude Code reads the same rules. `.claude/settings.json` enforces the allowed, ask-first and never tiers for Claude Code; for the other tools the tiers live as text in `AGENTS.md`.

A rule line is added when an assistant actually got something wrong, or when a rubric asks for it; the AI-LOG entry, the commit or the rubric line is the line's story (PA#2 rubric, criterion 1).

## D8. Model provider: Gemini Flash-Lite, free tier only

Team rule: wherever we choose a model or AI service, we pick the free version.

- **Two keys, both free tier, no billing account attached:** one for development (dev eval set and our own cases), one for the deployment. A key with no billing account cannot be charged, so the spend limit is 0 by construction; the README says so, and names the model and the free-tier rate limits.
- **Our own limits in code**, which the brief asks for anyway (section 3, "a cost cap per lab"): a maximum number of model calls per lab, and a request rate below the free-tier limit. Over either limit, the remaining pairs become `unsure` (FAQ-09 lists "lab đã vượt hạn mức chi phí" as an `unsure` cause).
- **What leaves our system:** only the statement, the constraints, and code with comments, names and student IDs removed (brief, section 3). On the free tier Google's terms say "human reviewers may read, annotate, and process your API input and output" and "Do not submit sensitive, confidential, or personal information to the Unpaid Services" ([Gemini API terms](https://aistudio.google.com/docs/terms)). We accept this because nothing identifying is sent. The submission page tells students that their stripped code goes to Google's free Gemini API and may be read by Google's reviewers (FAQ-06 notice), and the README and AI-LOG say the same.

**Considered and rejected:** a paid project with a spend cap (Google does not use prompts on paid services, but it needs a card, and the AI Studio project cap is "experimental" with about 10 minutes of overage, per [AI Studio billing](https://aistudio.google.com/docs/billing)).

**Risk we accept:** free-tier rate limits may slow an eval run (102 pairs) or a burst of 80 submissions. The hard rules run first and need no model call; the rest waits in the queue.

## D9. Protecting `main`

- A pull request is required; the `gates` check is required; nobody can bypass, admins included.
- One approving review is required.
- `CODEOWNERS` covers `.github/`, the test folders and the eval data, so nobody (person or assistant) weakens the gate without review (session 7).
- Protection is switched on after the `gates` job has run once on a pull request. From then on nothing is pushed straight to `main` (PA#2 rubric, criterion 4).

## D10. PA#2 split and timeline

| Who           | PA#2 scope                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thiên Ân      | The contract; the contract tests, written from the contract only, not from the endpoint's code; workspaces, the four check commands, CI, `AGENTS.md` and permissions, `.env.example`, branch protection, `CODEOWNERS`; the blocked-PR and contract-break demos; `PA2.md`, AI-LOG, self-assessment, packaging |
| Hoàng Hải (X) | NestJS skeleton (modules, config validated at startup); the global `problem+json` exception filter, including validation errors with `errors[]`; the JWT guard and role check; the endpoint (controller, DTO, service) on top of Y's data functions                                                          |
| Phú Dinh (Y)  | Postgres in `docker compose`; Drizzle schema and migrations for `users`, `classes`, `class_members`, `labs`, `submissions` and idempotency keys; a seed script; the data functions the endpoint needs, with their own unit tests                                                                             |

**Data functions (Phú Dinh builds, Hoàng Hải calls):** find a lab for a student, returning nothing when the lab does not exist or the student is not in its class (the single query behind the 404 rule in D5); look up an idempotency key by (student, lab, key); insert a submission and its idempotency key in one transaction; list submissions not yet enqueued (for the outbox sweep in D6).
Thiên Ân writes the signatures, the order of checks and the test list in an internal contract and sends it to both by message on Monday; they confirm or correct it, so Hoàng Hải can build the endpoint against a fake while Phú Dinh builds the real functions.

**Reviews (D9):** Hoàng Hải and Phú Dinh approve each other's pull requests; either of them approves Thiên Ân's. Each teammate reads the other half before the PA#6 oral.

| When                          | Thiên Ân                                                                                          | Hoàng Hải (X)                                      | Phú Dinh (Y)                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Mon 9/11 to Tue 10/11 morning | Workspaces, check commands, CI, `AGENTS.md`; contract draft, review, **frozen by Tue 10/11 noon** | Skeleton, filter, guard; confirm the data contract | Compose, schema, migrations, seed; confirm the data contract |
| Tue 10/11                     | Contract tests; protection on after the first CI run; `CODEOWNERS`; the blocked PR                | The endpoint on the agreed functions               | The data functions and their unit tests                      |
| Wed 11/11, by 22:00           | The deliberate contract break; `PA2.md`, AI-LOG, self-assessment, tag `pa2`, zip                  | Fixes                                              | Fixes                                                        |

## Out of scope for PA#2

A login endpoint; `.cpp` multipart upload; judging, the checker and model calls (contract tests replace the queue with a fake through NestJS dependency injection); Redis in CI; `apps/web`; TA test submissions (checking a TA's sample solution is a separate feature).

## PA#3 decisions

**Status:** proposed by Thiên Ân on 2026-11-21 for the PA#3 kickoff, revised on 2026-11-23 after review, **to be confirmed by Phú Dinh and Hoàng Hải**. If D11 is accepted, the queue row of D3, the "Enqueue fails" row of D6 and the Stack line of `AGENTS.md` change in the same pull request.

## D11. The queue is a PostgreSQL table (replaces BullMQ in D3)

A submission row is the job. A worker claims the oldest `queued` row with `SELECT ... FOR UPDATE SKIP LOCKED`, marks it `judging` with a lease time and a fresh claim token, and commits. When a lease runs out (the worker died), the row can be claimed again with a new token. A worker writes its results only `WHERE id = $1 AND claim_token = $2`, so a worker whose lease ran out cannot overwrite the results of the one that took over. Each test's judge result and each verdict is written once: the per-test results go in with the status change in one transaction, and verdicts have a unique index on `(submission_id, constraint_id)` and are inserted with `ON CONFLICT DO NOTHING`.

**Why:** the outbox of D6 is already this table. PA#3 criterion 2 asks that a submission made while the worker is stopped is judged exactly once after it starts again; here that is one transaction, one claim token and one unique index. The deployment runs one service fewer.
**Cost:** no BullMQ retries or dashboard; we write the claim and the lease ourselves. **Alternative:** keep BullMQ and add Redis to CI and to the deployment.
**Changes with it:** D3 (the Queue row, and "Redis is reused for real-time results in PA#5", which PA#5 decides again), D6 ("Enqueue fails": the row is the job, so there is nothing to re-enqueue), the README, `REDIS_URL` in `.env.example`, and the comment in `apps/api/src/outbox-queue.ts`.

## D12. Two worker processes: judge and check

One codebase in `apps/worker`, two entrypoints, two services in compose. `judge` can start containers and has no `GEMINI_API_KEY`. `check` has the key and no access to Docker; it runs `packages/checker` on Accepted submissions only (FAQ-04). `judge` starts each sandbox with an explicitly empty environment: no `-e`, no `--env-file`, and the `docker` command itself is spawned with only the variables it needs.

**Why:** the process that starts the sandboxes never holds the key, so it cannot pass it on (brief, section 5; session 6: "the worker passes its environment on").

## D13. Hard rules: a C++ tokenizer and rules that know declarations

`packages/checker` splits the code into tokens. Comments and string, character and raw-string literals are not code; preprocessor lines are. The header name of an `#include` (`<string>`) is one token that names a file, not a banned name. A constraint whose text starts with "Do not use" or "Do not call" is a ban list, and the banned names are the words in backticks in its text (dev set README). A banned name matches:

- as a qualified name (`std::sort`, `std :: sort`, `::qsort`), also through a namespace alias (`namespace rg = std::ranges;` then `rg::sort`);
- as an unqualified name (`sort`, `qsort`) unless the student declared something of that name. Code that compiles found an undeclared name in a library, whether through `using`, argument-dependent lookup (`sort(v.begin(), v.end())` with no `using`) or a C header;
- as a keyword (`for`, `goto`);
- as a member (`.rbegin()`, `->rend()`) when the banned name has no namespace.

A macro or alias that names a banned function is caught at its `#define`, `using` or `typedef` line, because those lines are code. If a backtick holds something that is not a name, the hard rule does not decide that constraint. No rule names a problem.

**Why:** the traps (the student's own `sort`, a banned name in a comment or a string, `<algorithm>` included only for `std::swap`) must not fire (PA#3 criterion 3). A tokenizer needs no native dependency, and every rule can be explained at the oral. **Alternative:** tree-sitter-cpp (WASM) for a full syntax tree; the rules about names would still be ours.

## D14. One model call per (submission, semantic constraint)

The prompt holds the statement, that one constraint, and the code with comments blanked and the student's identity replaced (D15). String literals stay in the code, so an injection inside a string still reaches the model: the prompt marks the code as data to judge, never as instructions. A constraint that a hard rule decided is never sent to the model. The model returns `verdict`, `evidence` (line and text) and `reason`, and nothing else: there is no deduction field. Our code checks the answer against that schema and each evidence line against the code (D15). A failure, or no answer within the time limit, becomes `unsure` with its cause (FAQ-09).

Each call writes one row to the call log: submission, constraint, the provider's request id, model, input and output tokens, time in milliseconds, cost, and the outcome (PA#3 criterion 4).

**Why:** a timeout or a schema failure costs one pair, not the whole submission, and the call log has one row per pair (PA#3 criteria 4 and 5).

## D15. Line numbers never move

Comments are replaced by spaces and every newline is kept, so line N of the prompt is line N of the submission. The student's name, email and student id are replaced by placeholders on the same line. Each evidence entry's text from the model (trimmed) is first compared with line N **of the prompt**; a mismatch makes the pair `unsure` ("evidence does not match the code", FAQ-09). Only then is the entry written with the text of the original line, which `eval.mjs` compares. Comparing with the original line instead would hide a made-up line behind the real one.

## D16. Deployment: one VM from Azure for Students

An Ubuntu VM running `docker compose`. Only the web port is open to everyone; SSH accepts only the team's keys (no password login); PostgreSQL is not reachable from outside. The VM has at least 2 GiB of memory, because it runs PostgreSQL, the API, two workers and the sandboxes; the 1 GiB sizes are not used. The size and its monthly price are taken from the portal at sign-up and written here, so the credit lasts until 31/12. Azure for Students gives credit without a card, verified with the school email (to be confirmed at sign-up). It runs from PA#3 until the PA#6 oral; the PA#4 red team attacks it.

**Why:** the judge worker must start containers, which a PaaS does not allow. A laptop behind a tunnel would run strangers' code on our own machine, and would have to stay on until the end of December.

## D17. Sign-in, classes and screens

`POST /v1/auth/login` with email and password. Passwords are hashed with Node's built-in `crypto.scrypt`, so no dependency is added; the token stays HS256 as in D5. The admin creates classes and TAs and assigns TAs to classes. A TA adds students to a class they teach, one of the two ways FAQ-01 allows (the other, an invite code, is not built). A TA sees only the labs and the review queue of their own classes: a lab of another class gets `404 lab-not-found`, the same answer as a lab that does not exist (the rule D5 set for students in the PA#2 contract, now for TAs too). The web app (D2) is React with Vite: sign-in; admin; the TA's labs, a new lab, adding students and the review queue; the student's labs, the submit page and the submission's status. The status page polls every 2 seconds; real-time updates come in PA#5.

## D18. Verdicts go only to the TA's review queue

Every verdict, from a hard rule or from the model, is a proposal in the TA's review queue. Nothing turns a verdict into a grade or a deduction. Before grades are published, the student sees only the judge's result for each test (FAQ-02); constraint verdicts, hard rule and model alike, stay hidden. Theo FAQ-08: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-08. PA#3 has no Publish. When Publish is built, it refuses while any queue item has no TA decision, `unsure` included (FAQ-09, FAQ-12).

**Why:** the syllabus rule for PA#3: a model verdict that changes a grade, or reaches the student as a deduction, without the TA, costs criteria 4, 5 and 6.

## D19. The sandbox (PA#3 criterion 2)

The judge compiles and runs inside the sandbox: two `docker run` per submission (compile, then the tests), code and tests in through stdin and results out through stdout, nothing mounted. Flags: `--network none --user 65534:65534 --read-only --tmpfs /tmp:rw,exec,nosuid,size=16m --memory 256m --memory-swap 256m --pids-limit 16 --cpus 1 --cap-drop ALL --security-opt no-new-privileges`, output capped at 1 MB, the lab's CPU limit, and a wall clock in the worker that runs `docker kill` on the container (FAQ-05 for the numbers). The image `judge-cpp` is pinned by digest. Each of the nine minimum attacks has one submission in `sandbox/attacks/` and one test; CI job `sandbox` runs them on every pull request and on the `pa3` tag.

**Why:** criterion 2 asks for all nine with an attack each, compiling inside the sandbox, and a CI run on the tag. Never on the command: `-v /var/run/docker.sock`, `--privileged`, `--env-file`, `-e GEMINI_API_KEY`.

## D20. The checker command (PA#3 criterion 6)

`npm run checker -- --data <folder> --out <file.jsonl>` reads a folder with the dev set's layout and writes one prediction line per (solution, constraint). It needs only `statement.md` and `constraints.json` of each problem. `checker/Dockerfile` builds an image that runs the same command. With `MODEL_OFF=1` it creates no model client and opens no network connection, so it runs under `docker run --network none`; the hard rules decide the ban lists (D13) and every semantic pair is `unsure`. Our own cases live in `eval/own/` with the same layout: at least 5, each labelled and tagged, at least one `trap` and one `injection`, each compiled with `g++ -std=c++17 -O2` and run against the tests before it is labelled.

**Why:** the lecturer runs one command on the held-out set, with no network when the model is off; `eval.mjs` must exit 0 or 1 on its output, never 2.
