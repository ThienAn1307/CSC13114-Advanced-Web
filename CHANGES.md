# Changes since PA#1

`proposal.md` is kept exactly as submitted for PA#1. This file records what has changed since, and why.

## 2026-10-12 — new name: DM2Order

The product is renamed from "Chốt Đơn" to **DM2Order**: a customer's DMs become an order. The name says what the product does now that chats come in from Instagram and Messenger DMs, and reads the same to Vietnamese and English speakers.

## 2026-10-12 — messages come in through the platform APIs

**What changed**
- Staff no longer paste chats or screenshots. Each shop connects its Instagram professional account (Instagram API with Instagram Login) and its Facebook Page (Messenger Platform). Customer messages arrive by webhook into an inbox in the app; messages the shop sends arrive as echoes (`is_echo`), so every message is stored with its sender.
- "Create order" on a conversation gives the LLM the messages since the last confirmed order (or from a message staff pick), not a whole pasted thread.
- The confirmation link goes back into the same conversation through the Send API, inside the 24-hour reply window.
- Zalo is out of scope this semester. Shops sell through personal Zalo accounts, which have no official API, and a paste fallback would bring back the problems below.
- Staff screenshots of chats are dropped from scope. Images a customer sends inside a chat are shown to staff next to the draft; the product field stays empty and red until staff pick the item. The LLM does not match photos to the catalogue.

**Why**
- Pasted text can lose who said what (Risk 2 in the proposal), and that is exactly where the headline failure, a missed change of mind, hides. Webhook messages carry their sender.
- A regular customer's thread spans several orders; reading only since the last confirmed order keeps the LLM on the current one.
- Copying and pasting cost staff almost as much time as the retyping we wanted to remove.

**What it costs us**
- New work: connecting Instagram and Messenger accounts, a webhook endpoint and message store, and the Send API. The Graph API returns details for only the 20 most recent messages of a conversation, so messages must be stored as the webhooks arrive.
- This semester the app runs in development mode with accounts the team owns (Standard Access, no App Review): a test Instagram professional account and a test Page, with team members playing customers. Serving real shops needs Advanced Access through App Review, outside this semester.
- Shops on personal Instagram accounts would have to switch to a professional account (free).

**Effect on the proposal**
- Section 1: Linh keeps selling on Instagram and Zalo, but only her Instagram and Facebook Page chats come into the app; Zalo orders stay manual.
- Section 3: Instagram and Messenger APIs move from Out to In. Out instead: Zalo (no paste fallback either), personal Instagram accounts, App Review for shops we do not manage, matching product photos with the LLM.
- Section 5: Risk 2 becomes "Meta API access or webhook setup blocks the inbox". This week: create the test Instagram professional account, connect it in development mode, and confirm the webhook delivers both a customer message and an echo.
- Section 6: add Instagram API with Instagram Login and Messenger Platform (free; webhooks use the public URL we already need for VNPay). Gemini now reads chat text only, so the screenshot token cost no longer applies.
- Section 4: who builds the inbox and the platform connection is still to be agreed by the team.
