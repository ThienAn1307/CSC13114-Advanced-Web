# `POST /v1/labs/{labId}/submissions`: contract, version 1

LeeTKOB, CSC13114 PA#2. Version 1, 9 Nov 2026.

This file is the specification of the endpoint a student uses to submit C++ source for a lab. The contract tests check the API against it. If the code and this file disagree, the code is wrong. If this file is wrong, change it in a separate commit that says why.

Sources, highest first: the class brief, the product owners' FAQ, then `docs/decisions.md` (D4, D5, D6).

**Not in this file:**

- `GET /v1/submissions/{id}`. The `Location` header of a 202 points to it; it is specified later.
- Login. There is no login endpoint in v1; tokens are issued outside this contract (section 1).
- Multipart or file upload. The client reads the `.cpp` file and sends its text as JSON.
- The notice that code is reviewed by hard rules and a model. The submission page shows it before the student submits, not this endpoint. Theo FAQ-06: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-06
- Paging. This endpoint creates one submission and lists nothing.

## 1. Conventions

- The endpoint lives under `/v1`.
- Requests and responses are JSON in UTF-8. A success has `Content-Type: application/json`; an error has `Content-Type: application/problem+json` (section 2).
- Ids are UUIDs, returned in lowercase canonical form, e.g. `0b7f3c1e-5a2d-4e8b-9c41-2f6d8a1b3e70`.
- Timestamps are ISO 8601 strings in UTC with milliseconds, e.g. `2026-11-11T14:59:12.345Z`.
- Sizes are integers in bytes. 64 KB means 65,536 bytes.
- Clients ignore response fields they do not know. The server ignores request body fields it does not know; they also do not count when two bodies are compared for idempotency (section 4.5).

**Authentication.** Every request carries `Authorization: Bearer <JWT>`. The API accepts a token only when all of these hold:

| Part         | Rule                                                             |
| ------------ | ---------------------------------------------------------------- |
| Algorithm    | `HS256`. Any other `alg`, `none` included, is rejected           |
| Signature    | verifies with the server's secret                                |
| `exp`        | present, and later than the time the server receives the request |
| `sub`        | present, the user's id (a UUID)                                  |
| `role`       | present, one of `student`, `ta`, `admin`                         |
| Other claims | ignored                                                          |

A request with no `Authorization` header, a scheme other than `Bearer`, or a token that breaks any rule above gets `401 unauthenticated` with the header `WWW-Authenticate: Bearer`. The response does not say which rule failed.

## 2. Errors

Every 4xx and 5xx response of this endpoint is a **problem details** object (RFC 9457):

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://leetkob.example/problems/validation-failed",
  "title": "Invalid request body",
  "status": 422,
  "detail": "1 field is invalid",
  "errors": [{ "pointer": "/source", "detail": "must be a string" }]
}
```

| Member   | Rule                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`   | `https://leetkob.example/problems/` followed by a slug from the table below. No other values. It is an identifier: clients compare it as a string and never fetch it                                                                                                                               |
| `title`  | the title from the table below                                                                                                                                                                                                                                                                     |
| `status` | a number, equal to the HTTP status of the response                                                                                                                                                                                                                                                 |
| `detail` | one sentence about this occurrence. Never a stack trace, an SQL message, a table name, a file path or a library name                                                                                                                                                                               |
| `errors` | only on `validation-failed`: one entry **per broken field, all of them, not just the first**, each `{ "pointer", "detail" }`. `pointer` is a JSON Pointer (RFC 6901): `/source`, or `""` for the whole body. In v1 the body has one field, so today there is one entry, but clients read the array |

**Clients branch on `type` only, never on `title` or `detail`.**

| Slug                      | Status | Title                    | When                                                                                                                                                                                     | The client                                   |
| ------------------------- | ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `malformed-json`          | 400    | Malformed JSON           | the body is not valid JSON                                                                                                                                                               | fixes the body                               |
| `idempotency-key-missing` | 400    | Idempotency-Key required | no `Idempotency-Key` header                                                                                                                                                              | adds a key                                   |
| `idempotency-key-invalid` | 400    | Invalid Idempotency-Key  | the `Idempotency-Key` header is present but breaks the key rules (section 4.2)                                                                                                           | sends a key that follows the rules           |
| `unauthenticated`         | 401    | Authentication required  | the token is missing or breaks a rule in section 1                                                                                                                                       | gets a new token                             |
| `forbidden-role`          | 403    | Role not allowed         | the token's `role` is not `student`, whatever the `labId`                                                                                                                                | does not retry                               |
| `lab-not-found`           | 404    | Lab not found            | no lab with that id, `labId` is not a UUID, or the lab belongs to a class the student is not a member of                                                                                 | does not retry                               |
| `lab-not-open`            | 409    | Lab not open yet         | the request was received before the lab opens                                                                                                                                            | waits until the lab opens                    |
| `lab-closed`              | 409    | Lab closed               | the request was received at or after the deadline                                                                                                                                        | does not retry; there is no late submission  |
| `source-too-large`        | 413    | Source too large         | `source` is over 65,536 bytes in UTF-8, or the whole body is over 262,144 bytes                                                                                                          | sends shorter source                         |
| `unsupported-media-type`  | 415    | Unsupported media type   | the request has no `Content-Type` header, or its media type is not `application/json` (a `charset=utf-8` parameter is allowed; media type and parameter are compared case-insensitively) | sends the body as `application/json`         |
| `idempotency-key-reused`  | 422    | Idempotency-Key reused   | the key was already used by this student for this lab, in the last 24 hours, with a different body                                                                                       | uses a new key for a new submission          |
| `validation-failed`       | 422    | Invalid request body     | the body breaks a field rule in section 4.2                                                                                                                                              | fixes every field listed in `errors`         |
| `internal`                | 500    | Internal error           | anything else. `detail` is a fixed, generic sentence                                                                                                                                     | retries later with the **same** key and body |

A client that meets a `type` it does not know (a later version may add one, section 5) acts on the status: a 4xx means "do not resend unchanged", a 5xx means "retry later with the same key".

## 3. Resources

**Submission receipt**: the body of a 202.

```json
{
  "id": "6c2e9a40-1f7b-4d3a-8e55-b0c4d2a9f817",
  "labId": "0b7f3c1e-5a2d-4e8b-9c41-2f6d8a1b3e70",
  "status": "queued",
  "receivedAt": "2026-11-11T14:59:12.345Z",
  "sizeBytes": 1834
}
```

| Field        | Type and format          | Meaning                                                                                                      |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `id`         | string, UUID             | the new submission's id; the same id ends the `Location` header                                              |
| `labId`      | string, UUID             | the lab from the path                                                                                        |
| `status`     | string                   | always `"queued"` in this response: the submission is stored and waits to be judged. Judging is asynchronous |
| `receivedAt` | string, ISO 8601 UTC     | the time the server received the request. This is the time compared with the deadline                        |
| `sizeBytes`  | integer from 1 to 65,536 | the length of `source` in UTF-8 bytes                                                                        |

## 4. Endpoint

### 4.1 Who may call it

- **Role:** `student` only. A `ta` or `admin` token gets `403 forbidden-role` for **any** `labId`, so the answer says nothing about which labs exist.
- **Ownership:** a student may submit only to a lab of a class they are a member of. A lab of another class gets `404 lab-not-found`, exactly the same response as a lab that does not exist. Theo FAQ-01: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-01
- The submission is always stored as the caller's own (`sub`); the body cannot name another student.

### 4.2 Request

```http
POST /v1/labs/0b7f3c1e-5a2d-4e8b-9c41-2f6d8a1b3e70/submissions HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
Idempotency-Key: 9d4f1a2b-7c3e-4b5a-8f60-1e2d3c4b5a69

{ "source": "#include <iostream>\nint main() { std::cout << 42; }\n" }
```

| Part                     | Rule                                                                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `labId` (path)           | the lab's UUID. Anything that is not a UUID is `404 lab-not-found`, not a validation error                                                                                                                                                                                             |
| `Content-Type` header    | required: `application/json`, optionally with a `charset=utf-8` parameter; media type and parameter are compared case-insensitively. A missing header, another media type or another charset is `415 unsupported-media-type`, decided from the header alone before the body is read    |
| `Idempotency-Key` header | required; missing is `400 idempotency-key-missing`. 1 to 255 characters, each a visible ASCII character (`!` to `~`), else `400 idempotency-key-invalid`. Compared exactly, case included. One new key per submission the client intends to make; a UUID is a good choice              |
| body                     | a JSON object, else `422 validation-failed` with pointer `""` (for example `[]`, `"text"` or `null`)                                                                                                                                                                                   |
| `source`                 | required. A string of at least 1 character. No U+0000 character and no unpaired surrogate (`\ud800` to `\udfff` on its own). Breaking any of these is `422 validation-failed` with pointer `/source`                                                                                   |
| `source` size            | at most 65,536 bytes when encoded in UTF-8 (64 KB), else `413 source-too-large`. 65,536 bytes is accepted; 65,537 is not. Checked only after every field rule in this table holds (section 4.4, step 7). Theo FAQ-05: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-05 |
| whole body               | at most 262,144 bytes (256 KB), else `413 source-too-large`, checked right after the media type and before anything else (section 4.4, step 2)                                                                                                                                         |
| other body fields        | ignored                                                                                                                                                                                                                                                                                |

A source rejected for its size is not a submission and does not count as one. Theo FAQ-05: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-05

### 4.3 Response

**`202 Accepted`**, with `Location: /v1/submissions/{id}` and the submission receipt (section 3) as the body. 202, not 201: the submission is stored, but judging has not happened yet. The client follows `Location` for the result.

A replayed response (section 4.5) also carries `Idempotent-Replayed: true`. The first response does not carry that header.

### 4.4 Order of checks

The server checks in this order and stops at the first step that fails. **This one list decides every error**: when a request breaks two rules, the earlier step answers.

1. The `Content-Type` header is missing or breaks its rule in section 4.2 (media type `application/json`, charset only `utf-8`): `415 unsupported-media-type`. The server decides this from the header alone, before it reads the body.
2. The body is over 262,144 bytes: `413 source-too-large`.
3. The body is not valid JSON: `400 malformed-json`.
4. The token is missing or invalid (section 1): `401 unauthenticated`.
5. The token's role is not `student`: `403 forbidden-role`.
6. The `Idempotency-Key` header is missing: `400 idempotency-key-missing`. It is present but breaks the key rules (section 4.2): `400 idempotency-key-invalid`.
7. The body breaks a field rule: `422 validation-failed`, listing every broken field. Only when every field rule holds is the size checked: `source` over 65,536 bytes is `413 source-too-large`.
8. No lab with that `labId` exists in a class the student is a member of: `404 lab-not-found`.
9. The key was already used by this student for this lab in the last 24 hours: same body, the original 202 is replayed; different body, `422 idempotency-key-reused` (section 4.5).
10. The request was received before the lab opens: `409 lab-not-open`. At or after the deadline: `409 lab-closed`.
11. The submission is created: `202`.

At any step, a failure of the server itself (the database is down, a bug) is `500 internal`.

Steps 1 to 7 do not read `labId`, so none of their errors reveal whether a lab exists or whether the student belongs to its class. Step 8 answers an unknown lab and another class's lab with the same response. Steps 1 to 3 (media type, body size, malformed JSON) run before authentication: an unauthenticated request with a wrong media type or a broken body gets that error, not 401.

Step 9 comes **before** step 10 on purpose. A student who submitted at 21:59, lost the response, and retries at 22:01 with the same key and body gets the original 202, not `lab-closed`.

### 4.5 Idempotency

A client that gets no answer (a timeout, a dropped connection) sends the same request again with the same key. That retry must not create a second submission.

- Keys are scoped per (student, lab).
- When step 11 succeeds, the server stores the key, a fingerprint of the body and the submission, **in the same transaction as the submission**.
- **Only a 202 is stored.** A request that ends in any 4xx or 5xx stores nothing, so the client may fix the request and send it again with the same key.
- Two bodies are _the same_ when they are equal as JSON values after unknown fields are dropped. In v1 that means the same `source` string. Key order and whitespace between JSON tokens do not count; any difference inside `source`, whitespace included, does.
- A stored key expires 24 hours after it was stored.

| Situation                                                     | Result                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `Idempotency-Key` header                                   | `400 idempotency-key-missing`. Nothing is created                                                                                                                                                                                         |
| A key that breaks the key rules (section 4.2)                 | `400 idempotency-key-invalid`. Nothing is created                                                                                                                                                                                         |
| A key not used before by this student for this lab            | the checks go on; if they pass, `202` and a new submission                                                                                                                                                                                |
| Same key, same body, within 24 hours                          | the stored response: `202`, the identical body (the original `id`, `receivedAt`, and `status: "queued"`, even if judging has moved on), the same `Location`, plus `Idempotent-Replayed: true`. No new submission. Also after the deadline |
| Same key, different body, within 24 hours                     | `422 idempotency-key-reused`. Nothing is created                                                                                                                                                                                          |
| Same key, more than 24 hours after it was stored              | treated as a new key: a new submission if the lab is still open                                                                                                                                                                           |
| Same key, from another student or for another lab             | unrelated to this key: treated as a new key                                                                                                                                                                                               |
| Two requests with the same key at the same moment             | exactly one submission is created. The other request gets the replay if its body is the same, or `422 idempotency-key-reused` if it differs                                                                                               |
| The first request with the key ended in an error (4xx or 500) | nothing was stored, so the key is free. A retry after the deadline gets `409 lab-closed`: only a stored 202 survives the deadline                                                                                                         |

### 4.6 Resubmission and the deadline

- Before the deadline a student may submit as many times as they like. Each request with a new key creates a new submission. The last submission received before the deadline is the one that counts, whatever its result. Theo FAQ-02: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-02
- The window is judged by the time the server receives the request (`receivedAt`), not by when judging finishes. The lab accepts a request received at or after the moment it opens and before its deadline. A submission received before the deadline but still waiting in the queue is valid. Theo FAQ-03: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-03
- There is no late submission and no per-student extension: after the deadline every new submission gets `409 lab-closed`. Theo FAQ-03: https://github.com/tkob-team/LeeTKOB-FAQ/blob/main/FAQ.md#faq-03

### 4.7 When queueing fails

The submission is stored first, then put on the judging queue. If putting it on the queue fails, the client **still gets the 202**: the submission is stored with `status: "queued"`, and the server queues it later on its own. The client sees no difference and does not retry. A submission received on time is never lost and never turns into `lab-closed` on a retry.

## 5. Versions

- The version is in the path: `/v1`.
- **Within `/v1`, only additive changes**: a new optional request field, a new response field, a new endpoint, a new problem type. Clients ignore response fields they do not know, and handle an unknown problem type by its status (section 2).
- Anything else is a breaking change: renaming or removing a field, changing a type, unit or format, tightening a rule (a lower size limit, a stricter key format), changing the status or `type` of an error, or changing the order of checks in section 4.4. A breaking change becomes `/v2`.
- When `/v2` ships, `/v1` keeps its behaviour, exactly as written here, until a Sunset date. From then until that date every `/v1` response carries `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers.
