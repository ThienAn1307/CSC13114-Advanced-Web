# Chốt Đơn — chat-to-order for small clothing shops

**PA#1 — Proposal and planning**, CSC13114, HK1 2026–27\
**Members:** Nguyễn Ngọc Thiên Ân (23120018), Nguyễn Phú Dinh (23120031), Hồ Hữu Hoàng Hải (23120040)\
**Repository:** [https://github.com/ThienAn1307/CSC13114-Advanced-Web](https://github.com/ThienAn1307/CSC13114-Advanced-Web)

## 1. Problem and users

**User.** Linh sells women's clothes on Instagram and Zalo — about 60 styles in several sizes and colours — with two part-time staff answering messages from 8 to 11 pm. *(Persona; checked against two real sellers in CP1.)*

**Problem.** Each order arrives as a scattered conversation — items, size, colour and address spread over a dozen messages and often changed midway ("thôi lấy màu đen nha") — and the shop must turn it into a correct order by hand.

**Today.** Staff scroll back through the chat, retype name, phone, address and items into a shared Google Sheet, and ask the customer to reply "ok". A wrong variant shows up only when the parcel is refused or sent back for exchange.

## 2. The LLM feature and the cost of it being wrong

**Feature: chat → draft order.** Staff paste one customer's whole conversation (text or screenshots); the LLM returns a draft matched to the shop's catalogue — product, size, colour, quantity per line, plus name, phone, address. Each field shows the message it came from; a field it cannot ground (size never stated, "màu kem" not in the catalogue) stays empty and red — no guessing. Prices never come from the LLM; code computes totals in integer VND.

**Two checks before anything ships.** Staff check the draft against the quotes and send the customer a private link. The customer re-reads the order, may fix delivery details only, and taps *Confirm* or *Something's wrong*.

**Cost of a wrong answer.** Headline failure: a missed change of mind — beige in message 3, "đổi sang đen" in message 9, the draft keeps beige, and staff and customer both skim past it.

- *Who:* the shop pays the return and the resend; the customer waits for a second delivery.
- *How much* (GHTK prices, 22/09/2026): same province 5,000đ return + 22,000đ resend = **27,000đ**, and the returned piece cannot be sold during the 3–5 working days the return takes; across regions 50% × 40,000đ + 40,000đ = **60,000đ** and 7–12 days. 27,000đ is the price of about 90 drafts (§6).
- *Undoable?* Free until the parcel reaches the carrier; then only by return and resend; never, if the right variant sold out meanwhile.

**How we will know.** Offline: labelled synthetic chats (30 by CP1, 60 by CP3; a third with a change of mind) — share of fully-correct drafts and of missed changes of mind. In use: one dashboard of fields staff corrected, *Something's wrong* taps and returns marked "wrong item".

## 3. Scope

**In.** Shop sign-up and staff invites, with data separated per shop; catalogue (style × size × colour, stock) and a fixed shipping fee; chat → draft, review and confirmation link; VNPay (redirect + callback) or COD, with the owner marking COD as collected; stock held when the link is sent and released after 24 h unless a VNPay payment is in progress, with late money sent to a "needs attention" queue; duplicate-phone warning; live order board and tracking page; accuracy dashboard and return reasons; revenue report (first to cut).

**Out, deliberately.** Storefront, cart, search and customer accounts; Facebook/Instagram/Zalo APIs (staff paste chats in and links back); carrier integration (tracking code and COD reconciliation by hand); discounts, codes and bargaining; customers editing items; automatic refunds and a second gateway; chatbot; native app; keeping screenshots (deleted after approval, quotes remain).

## 4. Plan and ownership

**Owners:** A (LLM) Nguyễn Ngọc Thiên Ân; B (orders & payment) Nguyễn Phú Dinh; C (shops & realtime) Hồ Hữu Hoàng Hải. Checkpoints are class Thursdays.

| CP (date) | A — Thiên Ân | B — Phú Dinh | C — Hoàng Hải |
|---|---|---|---|
| 1 (15/10) | 30 labelled chats; chat-format check; baseline on two models; stub extractor | Order states + schema agreed with A, C; VNPay sandbox payment via tunnel | Repo + CI; JWT login; shop sign-up, staff invite; talk to 2 sellers |
| 2 (29/10) | Core-feature spec; extractor v1 on text (quotes, red flags) | Catalogue, stock, shipping fee; review screen; link with stock hold (transaction) | Permissions; shop-isolation tests; live order board |
| 3 (12/11) | Screenshots (deleted after approval); 60 chats | Confirmation page; idempotent VNPay callback; COD | Tracking page, masked details; duplicate-phone warning |
| 4 (26/11) | Accuracy dashboard; prompt changes measured | 24 h release, VNPay-in-progress rule, "needs attention"; COD collected | Return reasons; tracking codes; public deploy |
| 5 (10/12) | Final model + prompt, measured accuracy and cost | Late/duplicate callback and release-race tests | Revenue report (cut first) |
| 6 (24/12) | Demo: a missed change of mind caught | End-to-end tests of the order flow | Two demo shops; deployment check |

## 5. Risks

**1 — The model misreads chats too often to save time.** If staff fix most drafts, the product has no reason to exist. *This week:* write 30 labelled chats, run them on gemini-3.8-flash and gemini-3.1-flash-lite, count fully-correct drafts and missed changes of mind. If the baseline is poor, A spends CP2 on the extractor alone while B and C build on the stub.

**2 — Pasted chats lose who said what.** Copied text may drop sender names, so the model cannot tell the shop's suggestion from the customer's choice — where changes of mind hide. *This week:* each member copies one own chat from Messenger, Instagram and Zalo (deleted after) and notes what survives. If speakers are lost, screenshots (sides left and right) become the primary input.

## 6. Technology choices

| Choice | Why, for this project |
|---|---|
| React + Vite | One SPA for owner and staff; customer pages are private links — no SEO, no server rendering. |
| Node.js + Express | Course stack; VNPay callback, LLM call and Socket.IO in one server. |
| PostgreSQL | Two staff, one last item: the stock hold needs a transaction; shop keys separate shops; integer VND. |
| Socket.IO | Board updates when a colleague sends a link or a VNPay callback lands; one room per shop. |
| JWT (Passport) + private links | Owner and staff log in; customers never sign up — one unguessable, expiring link per order. |
| VNPay sandbox | Self-service sandbox with browser test cards; real customers pay from any bank app. |
| Gemini API | Reads Vietnamese text and screenshots; schema-checked JSON. Free tier now, **synthetic data only** (its terms forbid personal data). Real shops: paid gemini-3.8-flash, USD 0.75 in / 3.75 out per 1M tokens (doubles 01/01/2027) ≈ 300đ per draft at ≈6,000 tokens in, 1,800 out, 26,000đ/USD; gemini-3.1-flash-lite ≈ 110đ. The test set picks one at CP1. |
| GitHub Actions | Lint and tests on every pull request, so three slices don't break one order schema. |
