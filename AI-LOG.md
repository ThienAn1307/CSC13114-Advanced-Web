# AI-LOG.md

Project: Chốt Đơn (PA#1)\
Team: Nguyễn Ngọc Thiên Ân (23120018), Nguyễn Phú Dinh (23120031), Hồ Hữu Hoàng Hải (23120040)

## LLM feature: what data leaves our system
The draft-order feature sends one customer's conversation (text or screenshots) and the shop's catalogue to the Gemini API. That conversation contains the customer's name, phone number and address. This semester we only send synthetic chats we write ourselves, on Gemini's free tier: Google may use free-tier data to improve its products, and its terms say not to send personal information there. A real shop would use the paid tier, where Google does not use prompts or responses to improve its products. Screenshots are deleted once staff approve the draft, prices never go through the model, and no API key or real customer data goes into a prompt.

## 2026-10-06 — topic ideas (PA#1)
Tool: Claude Code.
Asked for: project topics that are new but practical, and big enough to become the class project.
Kept: "chốt đơn từ tin nhắn" for small clothing shops, from the fourth batch of ideas.
Rejected: the first batch (fund reconciliation, group lunch orders, rental contracts, prescriptions) as too small for a class project; the second (shared fund, motorbike repair shop, boarding house), where I asked for other directions; the third (bus parcels, print shop, student moving, wedding gifts, pet hotel, escrow) as novel but unrealistic, because each needed a third party to change how it works or forced the LLM in.
By hand: judged each batch, chose "practical before novel", and picked the topic.

## 2026-10-07 — proposal decisions (PA#1)
Tool: Claude Code.
Asked for: an interview, one decision at a time, to settle the user, the LLM feature, scope, plan, risks and stack before writing.
Kept: most of the options it recommended (staff review plus a customer confirmation link, stock held when the link is sent, 24 h release, VNPay or COD, several shops per system, React + Vite, PostgreSQL, choosing the model at CP1 by measuring); the GHTK and Gemini prices and terms it looked up.
Changed: dropped discounts entirely (it had proposed staff-entered discounts) because social-media shops rarely use codes; chose Gemini for its free tier over the Claude models it priced, then kept the free tier to synthetic data after it showed Google's terms; dropped the auto-reply chatbot I had added once it pointed out the conflict with "no platform APIs".
Rejected: mentioning Pancake, an existing tool it found; its other risk candidates (customers afraid to tap links, VNPay callback, slices not fitting together).
By hand: the target user (clothing shops), every scope and stack choice, the second risk.

## 2026-10-07 — proposal.md (PA#1)
Tool: Claude Code.
Asked for: a two-page proposal.md from the decisions above, aimed at the top band of each rubric criterion; later, to fill the remaining placeholders and remove every middle-dot separator.
Kept: sections 1–6 as drafted; its layout fixes to keep the PDF at two pages (members on one line, merged plan columns); the slice owners (A Thiên Ân, B Phú Dinh, C Hoàng Hải), which I asked it to assign arbitrarily.
Changed: replaced the header placeholders with the member list and the repository link.
By hand: member names and IDs, the repository link.