# Member X: submission API and handoff to Y

Implemented on `feat/member-x-submission-api` against
[`contract/post-lab-submissions.md`](contract/post-lab-submissions.md), version 1.
The HTTP contract and decisions are unchanged.

## What X provides

- `apps/api`: strict TypeScript, ES modules, NestJS 12 modules and a startup configuration validator.
- Passport JWT authentication, accepting only HS256, a UUID `sub`, a valid `role`, and an `exp` later than the captured receive time. Other claims are ignored.
- A student role guard before any lab lookup.
- A global RFC 9457 exception filter. Unexpected errors return a fixed generic 500; authentication failures include `WWW-Authenticate: Bearer`.
- `CreateSubmissionDto`, validated with `class-validator`, and a typed receipt DTO. Unknown body fields are dropped. Invalid fields produce one `errors[]` entry per field; invalid body shapes use the root JSON Pointer.
- `POST /v1/labs/:labId/submissions`, with the exact check order in section 4.4, UTF-8 byte limits, captured receive time, idempotency replay, and queue failure handling.
- Implementation tests using fake data and queue adapters. These do not replace Thiên Ân's independently written contract tests or Y's PostgreSQL transaction tests.

## DTO first: what Y builds against

The interface is [`submission-data.ts`](../apps/api/src/submissions/submission-data.ts).
It contains transport-independent types and the four data functions from D10.
The DTO imports no database schema. Y can implement this interface with Drizzle
without changing the controller or service.

| Data              | Required values and invariants                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validated request | Only `source: string`; nonempty, no NUL, valid Unicode, at most 65,536 UTF-8 bytes. Preserve source exactly.                                                                                                      |
| Lab for a student | `id`, `opensAt`, `deadlineAt`; canonical UUID and UTC `Date` values. Missing lab and absent class membership both return `null` from one membership-filtered lookup.                                              |
| Submission input  | Authenticated `studentId`, canonical `labId`, generated receipt `id`, original `source`, queued status, `receivedAt` and `sizeBytes`. Client body fields cannot override ownership.                               |
| Idempotency scope | `(studentId, labId, key)`; the key is case-sensitive.                                                                                                                                                             |
| Stored success    | `requestHash` (64 lowercase hexadecimal SHA-256 characters), immutable original `receipt`, `expiresAt`. Hash is SHA-256 of the exact validated source's UTF-8 bytes, without normalization or JSON serialization. |
| Expiration        | `expiresAt = original receivedAt + 24 hours`. A key is live only when `expiresAt > incoming receivedAt`; equality means expired.                                                                                  |
| Queue payload     | Submission UUID only; deduplicate deliveries by that UUID.                                                                                                                                                        |

The receipt has `{ id, labId, status: 'queued', receivedAt, sizeBytes }`.
Return UUIDs in lowercase and timestamps through `Date.toISOString()` (UTC with
milliseconds). Persist the original receipt: replay must keep `status: 'queued'`
even if the current submission status has advanced.

### Atomic insertion requirement

`insertSubmission(input)` must insert the submission and idempotency record in
one transaction. Serialize writers for the same scope, including when replacing
an expired key. A concurrent live winner returns
`{ created: false, stored: winner }`, rather than an unclassified unique-key error.
Do not create an orphan submission for the losing request.

The service compares the winner's hash and returns either the original receipt
or `422 idempotency-key-reused`. Do not overwrite the winner on a hash mismatch.
All requests ending before a successful insert leave the key reusable.

Y's database tests should exercise the transaction with concurrent connections,
rollback on insertion failure, case-sensitive keys, scope isolation, exact
expiration, and the membership-filtered lab lookup. The in-memory fake is not
evidence of PostgreSQL concurrency correctness.

`listQueuedSubmissions(before, limit)` returns rows still `queued` with
`receivedAt < before`, ordered by `receivedAt` then `id`, limited to `limit`.
This is the interface for the later outbox sweep. Queue delivery must be
idempotent because a sweep can enqueue the same still-queued row again.

## Connecting Y's implementation

`createApp({ config, data, queue })` creates and initializes the Nest application.
It accepts fake adapters in tests and Y's real adapters in the application.
`AppModule.register(...)` also exposes this wiring for Nest testing utilities.

`bootstrap(data, queue)` in [`main.ts`](../apps/api/src/main.ts) validates
`JWT_SECRET` (required, nonblank) and `PORT` (default 3000; integer 1–65535)
from the process environment, enables shutdown hooks, and starts listening.
Configuration errors never include supplied values. The launcher supplies the
environment; this module does not read a dotenv file.

After Y has built the database adapter, the composition root calls:

```ts
import { bootstrap } from './main.js';

await bootstrap(submissionData, submissionQueue);
```

`submissionData` must implement `SubmissionData`; `submissionQueue` must
implement `SubmissionQueue`. Lifecycle ownership for database and queue clients
belongs to that composition root. There is no standalone production start script
until those real adapters are wired. The test fake is never installed as a
production persistence fallback.

Queue enqueue runs after the successful transaction. A queue failure preserves
the durable queued row and still returns 202, as required by D6. PA#2 tests
replace the queue; a live BullMQ adapter and the outbox worker are not implemented
here, in line with the PA#2 scope in `decisions.md`.

## Verification

From the repository root:

```sh
npm run check
npm run build --workspace @leetkob/api
```

The API tests start a real HTTP listener on an ephemeral loopback port; they need
no database, Redis, model, real secret, or dotenv file. Test signing material is
generated in memory for each test process. Existing shared tests are unchanged.

On Windows, use `npm.cmd`/`npx.cmd` when PowerShell blocks the `.ps1` wrappers.
For this checkout, dependencies and the installation caches are on D. To keep
subsequent npm and SWC operations there too, use these process-local settings:

```powershell
$env:npm_config_cache = Join-Path $PWD 'node_modules/.cache/npm'
$env:TEMP = Join-Path $PWD 'node_modules/.cache/tmp'
$env:TMP = $env:TEMP
$env:SWC_NATIVE_BINDING_CACHE = Join-Path $PWD 'node_modules/.cache/swc'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
npm.cmd run check
```

SWC's native cache must be owned by the account running the checks. In a
restricted runner with a different Windows account, native binding loading can
fail before tests start; run the same checks as the checkout's owner.
