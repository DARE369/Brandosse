# Graphics Generation — Credit Cost Model

**Date:** 2026-07-19
**Companion to:** [GRAPHICS_GENERATION_PLAN.md](GRAPHICS_GENERATION_PLAN.md) · [GRAPHICS_GENERATION_AUDIT.md](GRAPHICS_GENERATION_AUDIT.md)
**Principle (locked with founder):** **Everything is charged. Nothing is free.** Credits are the only thing users buy, so every AI operation — image, video, *and every LLM call* — must draw credits down. "Free tier" is a later decision, not part of this model.

---

## 0. Locked decisions (founder + finance-ops, 2026-07-19)

These are settled. The rest of this doc is the reasoning behind them.

| # | Decision | Rationale |
|---|---|---|
| **Market** | **Nigeria for now.** | Determines everything below — payment rail, currency, price ceilings. |
| **Payment rail** | **Paystack, NOT Stripe.** Migrate the billing code off Stripe. | Stripe cannot pay out to a Nigerian business in 2026 (Nigeria is off Stripe's supported list). Current code uses Stripe checkout → **the money literally cannot reach the founder as written.** Launch-blocking, but *planned now, built later* — graphics Stage 0/1 proceed first (they don't touch billing). |
| **Currency** | **Naira, fixed prices.** | Buyers see stable ₦. Costs are USD, so prices are set off a **conservative FX peg (e.g. ₦1,700/$ when spot is ~₦1,600/$)** to buffer margin; re-price only if the Naira breaks the peg. |
| **Payment methods** | **All local at launch:** card + bank transfer + USSD + mobile money. | Many Nigerians don't pay by card; Paystack supports all natively. Card-only would leave real buyers unable to pay. |
| **Markup** | **Images/edits 2.5× (land 70–80% via ceil); video 3× / ~66%.** | Split by media class — video is where cost surprises are 8–16× more expensive. |
| **Video prices** | **Std 15 · Premium 5s 11 · Premium 10s 21** (was 5 / 15-flat). | Old std-5 was *underwater*; old flat-15 billed 10s at the 5s price (a second live leak). |
| **LLM plan+enhance** | **Bundled into the image/video price, never surcharged.** Standalone caption/SEO regen = 1 credit. Enforce with an explicit `billing_context: "bundled"\|"standalone"` flag defaulting to `standalone`. | Per-call LLM cost ($0.001–0.004) is noise; a separate line would be a predatory-looking nuisance fee. |
| **Auto-retry** | **Charged from credits** (2 cr, as a normal image). | Founder decision — no free retries. |
| **Free signup credits** | **Keep ~25–30 — do NOT cut. Gate hard instead** (verified email/OAuth + phone/device caps, steer away from free video). | **Founder call, siding with biz-cofounder over finance-ops.** Cutting the trial + raising entry price simultaneously = two demand-suppressing bets before a single paying customer. Starving the trial kills the "oh, this is actually good" moment that converts a skeptical Nigerian buyer. Abuse is controllable with gating; a lost first impression is not. Accepted residual: ~$0.50–1.00 fal exposure per gated signup — a known, bounded cost. |
| **Naira pack denominations** | **Reprice per biz-cofounder (see §10).** Add a **₦5,000 micro-pack** as the hero; drop Starter ₦25,500 → **₦15,000**. | ₦25,500 was **4.6× a month of Canva Pro (₦5,500)** — a renewal price at the front door. Entry must sit in the ₦2–5k Nigerian first-purchase comfort band. |
| **Validate before billing** | **No-code WTP test (Mom-Test + fake-door Paystack Payment Links) BEFORE writing billing code.** See §10. | Riskiest assumption isn't the exact number — it's whether Nigerian creators pay upfront for AI content *at all*. Build billing around the price the market clears at. |
| **Rounding** | **Always `ceil()`** (in our favor). | True image markup is therefore ~3.3×, not 2.5× — more headroom than the raw target implies. |
| **Margin floor** | Recompute all margins at **~$0.098/credit** (post-Paystack-fee Pro-tier floor), not $0.10. | Paystack's fee **cap** makes large purchases cheaper to process than Stripe would — floor is slightly *better* than the Stripe estimate. |

**Still open (need a `biz-cofounder` / `growth-marketer` pass, not finance):** whether the USD-equivalent Naira prices (~₦24,000 for the $15 Starter) match Nigerian willingness-to-pay. The margins are healthy; the question is whether the *absolute* price is right for the market.

---

## 1. The two anchors this model is built on

### Anchor A — what a credit is worth in dollars (from `credit-packages.ts`)

| Package | Credits | Price | $ / credit |
|---|---|---|---|
| Starter | 100 | $15 | **$0.150** |
| Creator | 300 | $35 | $0.117 |
| Pro | 1000 | $99 | **$0.099** |

**We price operations against the Pro floor of ~$0.10/credit** (the cheapest a credit is ever sold for). If margin holds at $0.10/credit, it holds at every tier above it. So: **1 credit ≈ $0.10 of sellable value.**

### Anchor B — what each operation actually costs us (from `FAL_COST_USD` in `fal.service.ts`)

| Operation | Provider | Raw cost (USD) |
|---|---|---|
| Image — Ideogram v3 (BALANCED) | fal.ai | $0.060 |
| Image — Recraft v3 | fal.ai | $0.040 |
| Image — FLUX.2 Pro (per MP) | fal.ai | $0.030 |
| Image edit — FLUX Kontext | fal.ai | $0.040 |
| Video std — Hailuo 2.3 (per clip) | fal.ai | $0.500 |
| Video pro — Kling 2.5 (per sec) | fal.ai | $0.070/s → $0.35 (5s) / $0.70 (10s) |
| **LLM call** (content plan / enhance / caption / SEO / vision gate) | Claude/Groq | **~$0.001–0.004 each** |

> **The leak, confirmed in code:** none of `generate-content-plan`, `enhance-prompt`, `generate-caption`, `generate-post-metadata`, `optimize-seo` call `reserveCredits`. **Every text-AI operation currently runs free.** A single "Generate" today fires *at least* 3 free LLM calls (plan → enhance → quality/caption). This model closes that.

---

## 2. The costing formula

For every operation:

```
credits = ceil( (raw_provider_cost × MARKUP) / $0.10_per_credit )
```

- **MARKUP = 2.5×** on media (fal image/video) → ~60% gross margin, defensible for early-stage AI SaaS (industry norm 50–70%).
- LLM calls are so cheap individually ($0.001–0.004) that per-call credit pricing rounds to 0. So LLM cost is **bundled** into the operation that triggers it (see §4), never billed as its own line — but it *is* counted, because the parent operation's price now includes it.

---

## 3. Per-operation credit prices (the table that matters)

Rounded to whole credits, floor-priced at $0.10/credit, MARKUP 2.5×.

| # | Operation | Raw cost | ×2.5 | Credits (charged) | Notes |
|---|---|---:|---:|:---:|---|
| **IMAGE — single** | | | | | |
| 1 | Image (FLUX / Recraft / Ideogram, auto-routed) | $0.03–0.06 | $0.08–0.15 | **2** | flat across models; hides which model ran. Was 1. |
| 2 | Image edit (Kontext) | $0.04 | $0.10 | **2** | was 3 — actually *cheaper* now, and honest |
| 3 | Batch of N (deliberate variation) | N × above | | **2 × N** | 4 variants = 8 credits |
| **VIDEO** | | | | | |
| 4 | Video — standard (Hailuo, 5s) | $0.50 | $1.25 | **13** | was 5 — 5 was **underwater** (lost money) |
| 5 | Video — premium (Kling, 5s) | $0.35 | $0.88 | **9** | was 15 |
| 6 | Video — premium (Kling, 10s) | $0.70 | $1.75 | **18** | was 15 — 15 underpriced 10s |
| **NEW — quality layer** | | | | | |
| 7 | Visual quality gate (per image) | ~$0.003 | | **bundled into #1** | runs on every image; folded into the 2-credit image price |
| 8 | Auto-retry on hard fail | = a new image | | **charged as #1 (2 cr)** | **founder decision: retry is charged from credits** |
| **NEW — brand / finishing** | | | | | |
| 9 | Reference-conditioned image | $0.03–0.06 | | **2** | same as #1 (fal doesn't charge extra for `image_urls`) |
| 10 | Upscale / finish pass | ~$0.02–0.05 (upscaler) | | **2** | its own line, on "Use this" or explicit click |
| 11 | First-frame still (for text-to-video) | = an image | | **2** (charged as #1) | **billed separately from the animate step** |
| 12 | Inpainting / object edit | $0.04 (Kontext) | | **2** | same as edit |
| **LLM-only (was free — now bundled)** | | | | | |
| 13 | Content plan + enhance | ~$0.004 total | | **included in #1/#3** | the image price now covers the plan+enhance that precede it |
| 14 | Caption / metadata / SEO regen (standalone) | ~$0.002 | | **1** | when triggered *on its own* (Regenerate caption button), charge 1 |

> **Why images went 1 → 2:** at 1 credit ($0.10 sell) against a $0.06 Ideogram cost, margin was ~40% *before* counting the 3 free LLM calls that precede every image. Once those are counted, 1 credit was **underwater**. 2 credits restores ~60% margin with the LLM cost included.

> **Why standard video went 5 → 13:** Hailuo costs **$0.50/clip**. At 5 credits ($0.50 sell) we were selling it **at cost, then losing money** on the LLM enhance call too. This was the single worst leak.

---

## 4. Bundled vs. separate — the two questions you asked, resolved

### Q1: Vision quality gate — bundled (per-image) or sampled?
**Decision: per-image, bundled into the image price (#7).**
- You said everything is charged, and the gate is part of what "generate an image" *means* in this product — not a separate purchasable thing.
- It costs ~$0.003 (a rounding error against the 2-credit / $0.20 image price), so it lives *inside* that price. No separate line, but fully counted.
- **Sampling (checking only 1 in N images) is rejected** — it would let bad images through ungated, defeating the "looks human" goal. We only sample if cost ever forces it, and at these numbers it never does.

### Q2: First-frame gen — separate charge or bundled into the video price?
**Decision: separate (#11 charged as an image, then the animate step #5/#6 charged on its own).**
- The whole point of first-frame approval is cheap iteration: let the user regenerate the *still* (2 credits each) until it's right, then spend the big animate credits **once** on the approved frame.
- **Bundled would break this:** either frame-regenerations are free (a leak you explicitly want closed) or they're uncounted. Separate keeps every render counted *and* makes getting it right cheaper for the user.
- Net to the user for one good video: e.g. 2 (frame) + 9 (animate 5s) = **11 credits**, vs. blindly animating for 9 and often re-rolling the whole $0.35 video. Cheaper *and* higher control *and* fully billed.

**The general rule this establishes:** *bundle* a cost when it's an inseparable part of one action (the vision gate is part of "generate an image"). *Separate* a cost when the user benefits from iterating on it independently (the first frame, the upscale). Everything is charged either way.

---

## 5. What a real "Generate" costs the user now (worked examples)

| User action | Credits | vs. today |
|---|---|---|
| 1 image (auto-routed, quality-gated, plan+enhance included) | **2** | was 1 (underwater) |
| 4 varied image variants | **8** | was 4 |
| 6-slide carousel | **12** | was 6 |
| Image edit | **2** | was 3 |
| Standard video (5s) | **13** | was 5 (lost money) |
| Premium video (10s) | **18** | was 15 |
| Text-to-video *with* first-frame approval (2 frame re-rolls + 5s animate) | 2+2+2 + 9 = **15** | new capability |
| Upscale a chosen image | **2** | new |
| Regenerate caption only | **1** | was free |

Starter ($15 / 100 cr) = **50 images**, or ~7 standard videos, or ~11 premium 5s videos. Reads sensibly on a pricing page.

---

## 6. Implementation — how to enforce "everything is charged"

The mechanism already exists (`reserveCredits` / `refund_credits` / `deduct_credits` RPC + `credit_transactions.category`). The work is **applying it everywhere it's currently missing** and **updating the numbers**.

| Task | File(s) | Change |
|---|---|---|
| Bump image price 1→2 | `generateImage/index.ts` (`CREDITS_PER_IMAGE`), `mediaGenerationOptions.js` | constant + UI estimate |
| Reprice edit 3→2 | `editImage/index.ts`, `mediaGenerationOptions.js` | constant |
| Reprice video 5/15 → 13/9/18 | `generateVideo/index.ts` (`CREDITS_STD_VIDEO`/`CREDITS_PRO_VIDEO`), add 10s tier | constants + duration-aware |
| **Charge LLM ops** (close the leak) | `enhance-prompt`, `generate-caption`, `generate-post-metadata`, `optimize-seo` | add `reserveCredits(…, 1, "text-ai", …)` **only when called standalone**; bundled when part of a generate flow (don't double-charge) |
| Charge visual gate | fold into image price (no separate deduct) | — |
| Charge auto-retry | `generationPipeline.js` retry path | run retry through the same `generateImages` (it self-charges 2) |
| Charge first-frame separately | `generateVideo` first-frame path | frame = image charge; animate = video charge |
| Charge upscale | new upscale edge fn | `reserveCredits(…, 2, "upscale", …)` |
| Update cost estimator | `estimateGenerationCost()` in `mediaGenerationOptions.js` | mirror all new numbers |

**Critical: avoid double-charging.** The plan+enhance LLM calls are *bundled* into the image/video price. Only charge an LLM op as its own credit when the user triggers it standalone (e.g. the "Regenerate caption" button on an existing post), never when it's an internal step of a generate that already charged.

---

## 7. finance-ops verdict (resolved 2026-07-19)

All items from the earlier "open" list are now decided — see §0. The substantive findings:

1. **Markup split by class, not blended.** Images/edits already land at **70–80%** (ceil() makes the effective image markup ~3.3×, not 2.5×). **Video → 3× / 66%.** Final: std **15**, premium 5s **11**, premium 10s **21**. (Earlier draft's 13/9/18 were the *floors*; we took the cushion.)
2. **Std-video loss confirmed.** At the floor, 5 cr × ~$0.098 = $0.49 sell vs. **$0.50** Hailuo cost = a loss *before* LLM/fees/storage. Repriced.
3. **Second live leak found:** `CREDITS_PRO_VIDEO = 15` is flat; `generateVideo` accepts `duration` but never multiplies by it, so **10s output is billed at the 5s price today.** The 11/21 split fixes it — the credit calc must actually read `body.duration`.
4. **Bundle LLM plan+enhance, no surcharge** — enforce with an explicit `billing_context` flag (default `standalone`), not by inference.
5. **Free credits 30 → 10–15, gated.** ~$1.00 hard fal cost per any-account signup was the biggest abuse vector.
6. **ceil() kept.** True margins are *better* than the target implies.

## 8. Nigeria / Paystack economics (the market this actually ships into)

**Payment rail = Paystack** (Stripe can't pay out to a Nigerian business in 2026 — this is not optional). This *improves* the model vs. the Stripe estimate:

| | Stripe (can't use) | **Paystack (NG local card)** |
|---|---|---|
| Fee | 2.9% + $0.30 | **1.5% + ₦100, capped at ₦2,000**, + 7.5% VAT on the fee |
| Micro-txn | full fee | **waived entirely if ≤ ₦2,500** |

Effective **$/credit after fees** (at a conservative ₦1,700/$ peg):

| Package | ~₦ price | Paystack fee (est.) | Net $/credit |
|---|---|---|---|
| Starter ($15) | ~₦25,500 | ~₦490 | **~$0.147** |
| Creator ($35) | ~₦59,500 | ~₦1,000 | **~$0.116** |
| Pro ($99) | ~₦168,300 | **capped ₦2,000** +VAT ≈ ₦2,150 | **~$0.098** ← model floor |

Paystack's fee **cap** means big purchases cost *less* to process than Stripe's uncapped %. **Floor = ~$0.098/credit**, slightly better than the Stripe-revised $0.096. All §3 margins hold.

**Currency = fixed Naira, pegged conservatively.** Costs are USD; a falling Naira erodes margin. Setting ₦ prices off a buffered peg (₦1,700/$ vs ~₦1,600 spot) absorbs normal FX drift so we re-price only on a real move, not monthly.

**The non-finance open question:** is ~₦25,500 for the Starter pack *affordable* for the Nigerian market? Margins are healthy; absolute price-point fit is a **`biz-cofounder` / `growth-marketer`** call before launch — not a margin problem, a demand one.

## 9. Costs the credit charge does NOT cover (carry costs — for the runway model, not per-transaction)

The one-time credit pays for generation; these are *recurring* and must be budgeted separately:
- **Supabase storage** — every asset is kept forever unless expired. Add a **retention policy** (auto-expire un-published generations after N days; the 48h signed-URL plumbing already exists).
- **Egress** — re-viewed Library assets re-issue signed URLs and re-pay egress; a popular asset can out-cost its one-time credit. Put a **CDN/cache** in front of thumbnails; budget ~$0.005–0.02/asset/month.
- **Provider-succeeded-but-refunded tail** — if fal renders and we refund (lost webhook past the poller window), fal still billed us. Rare post the 2026-07-12 URL fix; a permanent small tail, don't price it in.
- **Rate/concurrency caps are video-only today** (`MAX_CONCURRENT_JOBS_PER_USER = 2`). **Confirm the image + newly-metered LLM paths have their own caps** before launch, or the free-credit balance can be script-drained.
- **Not legal/tax advice:** metered digital-goods sales in Nigeria carry **7.5% VAT** obligations; ToS/refund policy for prepaid credits should get a professional's eyes before launch.

## 10. Nigerian market repricing + validation (biz-cofounder, 2026-07-19)

**Verdict: RED on the original entry price, YELLOW on the model.** Margins are fine; the *absolute Naira number* was wrong for the market. The per-operation credit costs (§3) are unchanged — only pack denominations and the go-to-market change.

**The anchor that drives everything:** Canva Pro is **₦5,500/mo** in Nigeria (2026) and already includes AI image gen + templates + brand kit. Our original ₦25,500 Starter = **4.6× a month of Canva**, upfront, from an unknown brand. Nigerian SaaS first-purchase comfort band = **₦1,000–5,000**; ceiling ~₦5,000.

### Repriced packs (per-op credit costs from §3 unchanged)

| Pack | Original ₦ | **Recommended ₦** | Role |
|---|---|---|---|
| **Micro (NEW)** | — | **₦5,000 / ~$3** (~18–20 cr) | **Hero / default first buy.** Sits in the comfort band. Slightly worse ₦/credit is fine (data-bundle logic). |
| Starter | ₦25,500 | **₦15,000** | The value pick, not the entry. No longer 4.6× Canva. |
| Creator | ₦59,500 | **₦35,000–45,000** | "Most popular" must be genuinely reachable. |
| Pro | ₦168,300 | **~₦150–168k** (keep) | Convinced agency/power user; fat margin fine. |
| **Low monthly (NEW, test it)** | — | **~₦4,900/mo** for X credits | Nigerians convert on small recurring commitments (Canva weekly/monthly, GOtv, data bundles). Prepaid-only strands the "just let me try it monthly" buyer. |

**Value framing fix:** anchor to **what they pay a designer today** (a Lagos flyer = ₦2,000–5,000), NOT to fal API cost or raw credit counts. *"₦5,000 = ~9 flyers that'd cost you ₦20,000+ from a designer"* is a story an SMB owner feels. "100 credits" is not.

### Validate BEFORE building Paystack billing (no-code, ≤1 week, <₦20k)

The riskiest assumption is not the exact price — it's **whether Nigerian creators/SMBs pay upfront for AI social content at all, at a price the unit economics survive.** Test it with real money before writing billing code:

1. **8–10 Mom-Test calls** — ask about the *last* flyer they made, who made it, what the designer cost (their price anchor, from their mouth). Only at the end: "I'll make 5 posts for ₦5,000, delivered tomorrow — want in?" Cash/transfer sent = the only real yes.
2. **Fake-door pricing page + live Paystack Payment Links** (dashboard-generated, **zero billing code**) showing the four repriced tiers + example generated graphics. Drive 300–500 cold Nigerian visitors; measure tier-click distribution and *actual completed payments*. Fulfil manually (concierge) — you generate + DM their content.
3. **Find one distribution partner** — a large Naija-vendor / SME WhatsApp group or page — before anything. Answer "how do the first 100 find out?" first.

**Gate: do not migrate billing to Paystack until test #2 shows people paying.** Build billing around the price the market clears at. *(This is why the Paystack migration is "plan now, build later" in §0 — the validation gates it.)*
The graphics Stage 0/1 build is independent of all this and also produces the example output the fake-door page needs.

### Still open (not a finance/demand question, a founder/GTM one)
Pack-vs-subscription (test both on the same fake-door page); exact micro-pack credit count; which distribution partner.

---

## Sources (2026 pricing benchmarks)
- [Canva hikes Pro subscription price ~100% in Nigeria (Technext, Feb 2026)](https://technext24.com/2026/02/03/canva-hikes-pro-subscription-cost-by-100/)
- [Pricing models that work for Nigerian startups (Launchpad.ng)](https://launchpad.ng/resources/pricing-models-nigerian-startups)
- [Minimum wage in Nigeria 2026: ₦70,000 (Employsome)](https://employsome.com/blog/minimum-wage-nigeria/)
- [AI Image API Pricing: What You Pay in 2026 (Apiframe)](https://apiframe.ai/blog/ai-image-api-pricing-2026)
- [AI credit pricing models — tokens, credits, hybrid billing (Solvimon)](https://www.solvimon.com/blog/ai-credit-pricing-models-how-tokens-credits-hybrid-billing-work)
- [AI Credits: How They Work, Pricing Models, Implementation (SchematicHQ)](https://schematichq.com/blog/ai-credits)
- [How Much Does AI Image Generation Cost in 2026 (LTX)](https://ltx.io/blog/how-much-does-ai-image-generation-cost)
- [Compare Replicate & Fal.ai API Costs 2026 (Price Per Token)](https://pricepertoken.com/image)
