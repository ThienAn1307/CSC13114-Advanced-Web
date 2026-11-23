# Real run on the dev set: `gemini-3.1-flash-lite`, 2026-11-23

The first run of the checker with the real model (PA#3 criterion 4). It **fails** the eval, and is
kept as it came out; later runs go in their own folders.

- Code: commit `5b35b1e` (`feat: the checker command calls Gemini unless MODEL_OFF=1 …`). The run
  was made from the working tree just before that commit, with the same `cli.ts` and `predict.ts`.
- Model: `gemini-3.1-flash-lite` on the free tier of the development project (decisions.md D8);
  every call in `calls.jsonl` reports `modelVersion` `gemini-3.1-flash-lite`.
- Command, run by Thiên Ân with the key loaded from `.env` into that one process:

  ```bash
  node --env-file=.env packages/checker/src/cli.ts --data eval/dev \
    --out eval/runs/2026-11-23-gemini-3.1-flash-lite/predictions.jsonl \
    --calls eval/runs/2026-11-23-gemini-3.1-flash-lite/calls.jsonl
  node eval/dev/eval.mjs --data eval/dev --predictions eval/runs/2026-11-23-gemini-3.1-flash-lite/predictions.jsonl \
    --json eval/runs/2026-11-23-gemini-3.1-flash-lite/summary.json > eval/runs/2026-11-23-gemini-3.1-flash-lite/report.txt
  ```

| File                         | What it is                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `predictions.jsonl`          | 102 lines, one per (solution, constraint)                                                                                                                                              |
| `calls.jsonl`                | 47 lines, one per model call: solution, constraint, the provider's `requestId` (Gemini `responseId`), model, tokens in and out, milliseconds, outcome, and the error for a failed call |
| `report.txt`, `summary.json` | what `eval.mjs` printed and wrote; it exited 1                                                                                                                                         |

## Result

| Metric              | Value            | Threshold     |
| ------------------- | ---------------- | ------------- |
| wrongful deductions | 2                | = 0, failed   |
| recall              | 86.5% (32 of 37) | ≥ 90%, failed |
| unsure rate         | 5.9% (6 of 102)  | ≤ 20%, met    |

The 55 ban-list pairs were decided by the hard rules with no model call; the 47 semantic pairs
made the 47 calls.

- **5 calls failed with HTTP 503** ("This model is currently experiencing high demand"). Each became
  `unsure`, cause `model-error`, for that pair only (D14). Four of them were violations, so they are
  four of the five violations not caught.
- **1 call was stopped by the evidence check** (D15): the model cited a line whose text did not
  match the prompt, so the pair became `unsure`, cause `evidence-mismatch`. That is the fifth
  violation not caught.
- **2 wrongful deductions**, both on `dynamic-array` C3 ("Release every block you allocate … A
  program that allocates nothing passes"): the model counted the memory that `std::vector` and
  `std::basic_string` allocate inside the library as the student's own allocations.

## Cost

Free tier: **$0** (Google's pricing page for `gemini-3.1-flash-lite`, read 2026-11-23: input and
output "Free of charge"). At the paid price on the same page, $0.25 per 1M input tokens and $1.50
per 1M output tokens (thinking included):

- this run, 30,823 input and 4,778 output tokens over the 42 calls that answered:
  0.030823 × $0.25 + 0.004778 × $1.50 = $0.0077 + $0.0072 = **$0.015**;
- per call on average: 30,823 / 42 ≈ 734 input and 4,778 / 42 ≈ 114 output tokens;
- one lab of 80 Accepted submissions with 2 semantic constraints is 160 calls:
  160 × 734 = 117,440 input and 160 × 114 = 18,240 output tokens, so
  0.117 × $0.25 + 0.018 × $1.50 ≈ $0.029 + $0.027 = **$0.057** at the paid price, $0 on the free
  tier, and about 12 minutes at one call every 4.5 s (under 15 per minute and 500 per day).
