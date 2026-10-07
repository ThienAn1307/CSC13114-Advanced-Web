# Self-assessment — PA#1

Submitted by: 23120018 — Nguyễn Ngọc Thiên Ân  
23120031 — Nguyễn Phú Dinh  
23120040 — Hồ Hữu Hoàng Hải

Total I claim: 91 / 100


| Criterion                                       | Max | I claim | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem and users                               | 20  | 18      | `proposal.md` 1: named user (Linh, a clothing shop on Instagram and Zalo, two part-time staff answering messages from 8 to 11 pm); the problem in one sentence ("Each order arrives as a scattered conversation…"); what they do today (retype into a shared Google Sheet, ask the customer to reply "ok"). Linh is a persona, to be checked with two sellers (4, CP1, owner C).                                                                                                                         |
| The LLM feature, and the cost of it being wrong | 25  | 22      | `proposal.md` 2: one feature (chat → draft order) with a quote per field, empty and red when ungrounded, no prices from the LLM; headline failure "missed change of mind" with who (the shop pays return and resend, the customer waits), how much (27,000đ same province, 60,000đ across regions, GHTK price list 22/09/2026) and whether it can be undone (free before the carrier, return and resend after, never if the variant sold out); how we will know (labelled test set, accuracy dashboard). |
| Scope: in and out                               | 15  | 13      | `proposal.md` 3 "In" and "Out, deliberately" (nine exclusions, e.g. platform APIs, carrier integration, discounts, chatbot). Every "In" item has a cell in 4 (duplicate-phone warning in CP3 owner C, 24 h release in CP4 owner B, revenue report in CP5 owner C); no "Out" item appears in 4.                                                                                                                                                                                                           |
| Plan and ownership                              | 20  | 18      | `proposal.md` 4: owners named (A Nguyễn Ngọc Thiên Ân, B Nguyễn Phú Dinh, C Hồ Hữu Hoàng Hải, repeated in the table header); six checkpoints on class Thursdays (15/10 to 24/12), each with work for every owner.                                                                                                                                                                                                                                                                                        |
| Risks                                           | 10  | 10      | `proposal.md` 5: (1) the model misreads chats; this week: 30 labelled chats on gemini-3.8-flash and gemini-3.1-flash-lite; (2) pasted chats lose who said what; this week: copy our own chats from Messenger, Instagram and Zalo, with screenshots as the fallback.                                                                                                                                                                                                                                      |
| Technology choices                              | 10  | 10      | `proposal.md` 6: eight choices, one line each tied to this project; provider Gemini with prices (USD 0.75 in / 3.75 out per 1M tokens, doubling on 01/01/2027), about 300đ per draft, free tier limited to synthetic data by Google's terms.                                                                                                                                                                                                                                                             |


## What I did not manage

- The user in 1 is a persona. We have not talked to a real clothing seller yet, so "about 60 styles", "8 to 11 pm" and "a shared Google Sheet" stay assumptions until CP1.
- The checkpoint dates follow the class Thursdays (Session 2 was on 24/09/2026); we did not check them against official checkpoint dates.
- The cost per draft (about 300đ) is an estimate from assumed token counts (about 6,000 in, 1,800 out) and 26,000đ/USD, not a measurement. Gemini's free-tier limits are only shown in AI Studio, so we do not yet know whether a full test run fits in one day.
- Both risks are on the LLM side. We considered a payment risk (the VNPay callback needs a public URL) and left it out.

## What I would do differently

Talk to one real seller before choosing the user, and agree on owners and checkpoint dates as a team before writing the plan.