# Real run: `gemini-3.5-flash-lite`, 2026-11-25

The second run with the real model (PA#3 criterion 4), on the dev set and on our own cases
(`eval/own`, which is PR #19 and was not used to tune anything before this run). It does **not**
pass the dev set (2 wrongful deductions), and passes our own cases. PA#3 has no pass mark on the
eval; the numbers are reported as they came out.

- Code: commit `56ca58f` (the list price of 3.5), which includes the retries on 429 and 503, the
  call log with prompts and costs, and the two general prompt rules added after the first run
  (`gemini-3.1-flash-lite`, in `../2026-11-23-gemini-3.1-flash-lite`).
- Later fixes to the tokenizer, the hard rules, identity, the evidence check and the client came
  after `56ca58f`. At `fb2f5eb` the prompts rebuilt from `eval/dev` and `eval/own` equal the logged
  ones, 47 of 47 and 6 of 6, so the fixes did not change what this run sent; the evidence check and
  the client do behave differently for other inputs. With the model off, `fb2f5eb` still decides all
  55 ban-list pairs of the dev set with 0 wrongful deductions.
- Model: `gemini-3.5-flash-lite`, chosen because `gemini-3.1-flash-lite` answered HTTP 503
  ("experiencing high demand") to every call we made from 2026-11-23 23:32 until at least
  2026-11-25 00:25, when 3.5 answered 200. (The first run, 3.1 on 2026-11-23 17:42, had answered 41
  of 47.) The runs use different models and different prompts, so their numbers are not a
  before-and-after. Free tier, same limits as 3.1 (decisions.md D8).
- Command, run by Thiên Ân with the key loaded from `.env` into that one process, with
  `GEMINI_MODEL=gemini-3.5-flash-lite`:

  ```bash
  node --env-file=.env packages/checker/src/cli.ts --data eval/dev --out .../dev/predictions.jsonl --calls .../dev/calls.jsonl
  node --env-file=.env packages/checker/src/cli.ts --data eval/own --out .../own/predictions.jsonl --calls .../own/calls.jsonl
  node eval/dev/eval.mjs --data eval/dev --predictions .../dev/predictions.jsonl --json .../dev/summary.json > .../dev/report.txt   # and the same for own
  ```

| File (in `dev/` and `own/`)  | What it is                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `predictions.jsonl`          | one line per (solution, constraint): 102 for the dev set, 12 for our own cases                                                                                                                         |
| `calls.jsonl`                | one line per model call: solution, constraint, the provider's `requestId`, model, tokens in and out, cost in whole nano-USD at the list price, milliseconds, outcome, and **the prompt that was sent** |
| `report.txt`, `summary.json` | what `eval.mjs` printed and wrote                                                                                                                                                                      |

## Result

| Metric              | Dev set (102 pairs)   | Our own cases (12 pairs) | Threshold |
| ------------------- | --------------------- | ------------------------ | --------- |
| wrongful deductions | 2, failed             | 0, met                   | = 0       |
| recall              | 91.9% (34 of 37), met | 100% (5 of 5), met       | ≥ 90%     |
| unsure rate         | 2.9% (3 of 102), met  | 0% (0 of 12), met        | ≤ 20%     |

- **Dev set, 47 calls** (the 55 ban-list pairs use no model): 44 answered, 1 timed out, 2 failed
  with HTTP 503 after the retries. Every failure became `unsure` for its pair (D14).
- **3 violations not caught**: two of them were a timed-out or failed call; one was judged `pass`
  by the model.
- **2 wrongful deductions**, both on `reverse-words` C2 (reverse each word in place, do not build
  the reversed word in a second string), in two solutions that read each word with `cin >> w`
  and reverse it inside `w`: the model counted the string the word is read into as the second
  string.

**Not a prompt we tuned to fix this:** the wrongful deductions above came out of the run and we did
not change the prompt after them.

## The call log

Each prompt holds the lab statement, one constraint, and the code with comments blanked. In the 53
prompts of both sets, no `//` or `/*` is left in the code section outside string literals, and no
text of the injection comments appears. The dev set and our own cases contain no student identity;
in the deployment the worker passes the student's name, email and id so `check()` replaces them (D15).

## Cost

Free tier: **$0**. At the paid list price, read verbatim on Google's pricing page on 2026-11-25
($0.30 per 1M input tokens, $2.50 per 1M output tokens, thinking included):

- the 44 dev-set calls that answered used 34,772 input and 5,380 output tokens: `costNanoUsd` in
  `calls.jsonl` adds up to 23,881,600 nano-USD, **$0.0239**;
- per answered call: 790 input and 122 output tokens on average, so
  790 × 300 + 122 × 2500 = 542,000 nano-USD = $0.000542;
- one lab of 80 Accepted submissions with 2 semantic constraints is 160 calls:
  160 × 542,000 = 86,720,000 nano-USD = **$0.0867** per lab at the paid price, $0 on the free tier.
