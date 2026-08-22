# Unit Economics — Cost Per Active User
**source_agent: A13 (agent runs killed by session limits; completed directly by the orchestrator)**
2026-08-21 · All arithmetic shown · Provider prices cited in `audit/02-market-reality.md` §1.5

---

## 1. Inputs (verified)

### 1.1 What we charge

`src/lib/video-engine/credit-packages.ts:3` — **"1 credit = 1 minute of source video processing."**

| Package | Credits | Price | **$ per credit** |
|---|---|---|---|
| Starter | 100 | $15 | **$0.150** |
| Creator | 300 | $35 | **$0.117** |
| Pro | 1,000 | $99 | **$0.099** |

### 1.2 What we charge per action

| Action | Credits | Evidence |
|---|---|---|
| Clipping | 1 per minute of source | `credit-packages.ts:3` |
| Video generation — standard | **5** | `supabase/functions/generateVideo/index.ts:32` |
| Video generation — premium | **15** | `supabase/functions/generateVideo/index.ts:33` |
| Image generation | ~3 | `src/services/media.service.js:275` |
| Image upscale | 2 | `src/services/media.service.js:281` |

### 1.3 What it costs us

The codebase carries its own cost table at `supabase/functions/_shared/fal.service.ts:585-594`:

| Item | Internal estimate | Market rate (D2 §1.4/1.5) |
|---|---|---|
| Hailuo video, per 5–6s clip | **$0.500** | $0.28 (Hailuo 2.3 Standard, 6s) |
| Kling video, per second | **$0.070** | $0.224/s (Kling 3.0 Pro) |
| Flux image, first MP | $0.030 | — |
| Ideogram v3 balanced | $0.060 | — |
| Image upscale | $0.040 | — |

Plus, from external pricing:
- **Groq Whisper large-v3-turbo: $0.04 per hour of audio**
- **Claude Sonnet 4.6: $3 / $15 per MTok** — the model `video-worker/stages/analyze.py:249` actually uses, `max_tokens=4096`
- **Claude 3.5 Sonnet: $3 / $15 per MTok** — the app default (`_shared/llm.ts:51`)

---

## 2. Clipping economics (P5) — excellent

**Per 60-minute source video:**

| Component | Arithmetic | Cost |
|---|---|---|
| Transcription | 1 hr × $0.04/hr | $0.040 |
| Clip analysis — input | ~9,000 words ≈ 12,000 tok × $3/MTok | $0.036 |
| Clip analysis — output | 4,096 tok max × $15/MTok | $0.061 |
| Render compute (ffmpeg, Railway) | estimate — **UNVERIFIED** | $0.050–0.150 |
| Storage + egress | ~9 clips × ~10 MB = 90 MB | ~$0.008 |
| **Total cost** | | **≈ $0.20–0.30** |

**Revenue:** 60 credits × $0.099 (cheapest tier) = **$5.94**; at Starter, $9.00.

> ### Gross margin on clipping: **≈ 95–97%**
> Cost per credit: **$0.0033–0.0050**

**This is a genuinely good business.** Transcription being effectively free ($0.04/hour) is the reason. P5 economics are not a risk — they are the strongest financial asset in the product.

---

## 3. Video generation economics (P4) — loss-making at the standard tier

**Standard tier — 5 credits:**

| | Cheapest tier (Pro, $0.099/cr) | Starter ($0.150/cr) |
|---|---|---|
| Revenue | 5 × $0.099 = **$0.495** | 5 × $0.150 = **$0.750** |
| Cost (internal estimate, $0.500/clip) | $0.500 | $0.500 |
| **Margin** | **−$0.005 (LOSS)** | +$0.250 (33%) |
| Cost at market rate ($0.28/clip) | $0.280 | $0.280 |
| **Margin at market rate** | +$0.215 (43%) | +$0.470 (63%) |

**Premium tier — 15 credits, Kling at $0.070/s:**

| Duration | Revenue (Pro tier) | Cost | Margin |
|---|---|---|---|
| 5s | $1.485 | $0.350 | **76%** |
| 10s | $1.485 | $0.700 | **53%** |

### 3.1 Premium is more profitable than standard — the pricing is inverted

At the Pro credit tier, using the codebase's own cost estimate, **a standard video generation loses money**, while premium earns 53–76%. Cost per credit:

- Standard: $0.500 ÷ 5 credits = **$0.100 per credit**
- Premium (10s): $0.700 ÷ 15 credits = **$0.047 per credit**

The cheaper-sounding tier costs the business **more than twice as much per credit** as the premium one.

### 3.2 The tier-upgrade path partly rescues this — by overcharging users

`generateVideo/index.ts:102-104`:
```
tierUpgraded = requestedQuality === "standard" && !isI2V
quality = tierUpgraded ? "premium" : requestedQuality
creditsNeeded = quality === "premium" ? 15 : 5
```

A user who asks for **standard** text-to-video (no source image) is silently upgraded to premium and **charged 15 credits instead of 5 — 3× the expected price.** The label describes it as a tier upgrade, but from the user's perspective they requested the cheap option and were billed the expensive one.

This incidentally protects the margin, since the loss-making standard path is the one being routed away from. **The business is protected by a billing surprise.** That is not a durable position — it is a refund request and a chargeback risk.

---

## 4. The structural problem: one credit unit, two cost bases

| Activity | Cost to business per credit | Ratio |
|---|---|---|
| Clipping | **$0.0033–0.0050** | 1× |
| Video generation (standard) | **$0.100** | **~20–30×** |
| Video generation (premium 10s) | $0.047 | ~10–14× |
| Image generation (~3 cr @ $0.03–0.06) | $0.010–0.020 | ~3–4× |

**A credit spent on video generation costs the business roughly 20–30× what a credit spent on clipping costs.** They are sold at the same price.

The credit unit is defined as "1 minute of source video processing" — a clipping concept — and then reused to price a fundamentally different activity whose cost structure is nothing like it.

**A rational user maximises value by spending every credit on video generation**, which is precisely the loss-making activity. The pricing model contains a built-in arbitrage against the business, and the only thing currently blunting it is that video generation does not actually work (P4-002: 1 real asset in 32 attempts).

---

## 5. Cost per active user per month

Because publishing is effectively one account and analytics do not exist, the only meaningful cost drivers are generation. Three profiles:

### Light user — 4 posts/month, text + image only
| Item | Arithmetic | Cost |
|---|---|---|
| 4 content plans (Claude 3.5 Sonnet, ~2k in / 2k out) | 4 × (0.002×$3 + 0.002×$15) | $0.144 |
| 4 discovery scores (`seo.ts`, maxTokens 2000) | 4 × (0.001×$3 + 0.002×$15) | $0.132 |
| 4 images (~3 cr each @ $0.03–0.06) | 4 × $0.045 | $0.180 |
| Supabase share | — | ~$0.10 |
| **Total** | | **≈ $0.56/mo** |

### Typical user — 12 posts + 2 hours clipped/month
| Item | Cost |
|---|---|
| 12 plans + 12 scores | $0.828 |
| 12 images | $0.540 |
| 2 hours clipping (2 × $0.25) | $0.500 |
| Supabase + egress | ~$0.25 |
| **Total** | **≈ $2.12/mo** |
| **Revenue if on Creator ($35/mo)** | Margin **94%** |

### Heavy user — 30 posts + 10 hours clipped + 20 video generations
| Item | Cost |
|---|---|
| 30 plans + 30 scores | $2.07 |
| 30 images | $1.35 |
| 10 hours clipping | $2.50 |
| **20 video generations (standard, $0.50 each)** | **$10.00** |
| Supabase + egress (video-heavy) | ~$1.50 |
| **Total** | **≈ $17.42/mo** |

> **The heavy user's cost is 82% video generation.** Everything else in the product combined costs ~$3.
> At the Pro pack ($99 for 1,000 credits), that user has spent 30×3 + 600 + 20×15 = ~990 credits — so revenue ≈ $99 against $17.42 cost, **82% margin**.
> But if they spend their whole allocation on video generation instead: 1,000 credits ÷ 15 = 66 premium generations, or 200 standard generations at $0.50 = **$100 cost against $99 revenue. A loss.**

---

## 6. Does the credit model survive?

`GRAPHICS_CREDIT_MODEL.md` was treated as a claim to test, not evidence.

**Verdict: it survives for clipping, text and images. It fails for video generation.**

1. **Clipping is a strong business** — 95%+ margin, and the pricing unit was designed for it.
2. **Text and images are comfortably profitable** at all three tiers.
3. **Video generation breaks the model.** At the cheapest credit tier the standard path loses money on the codebase's own cost estimate, and a user who spends an entire Pro pack on video generation costs more than they paid.
4. **The blended margin looks healthy only because video generation does not work.** As P4 is fixed — which the founder has designated a launch requirement — this cost moves from theoretical to real. **Fixing P4 makes the unit economics worse, not better.** That is the single most important sentence in this document.

### Required before launch (economic, not technical)
- **Decouple video-generation pricing from the minute-based credit unit**, or price video generation per-second against actual provider cost.
- **Remove the silent 3× tier upgrade** (`generateVideo/index.ts:102-104`) and price the standard tier above its true cost.
- **Set a per-user video-generation ceiling**, since one heavy user can consume an entire package's revenue.
- Reconcile the internal cost table (`fal.service.ts:585`) against live provider rates — Hailuo is estimated at $0.500/clip internally versus $0.28 market, a 79% overestimate that distorts every downstream decision.

---

## 7. The live cost bug

Independent of the model: **Groq has failed 100% since ~2026-08-18 and Claude silently absorbs all content-plan traffic** (`content_plans.plan_provider` = anthropic for 16 consecutive rows; finding P3-001).

Groq's `llama-3.3-70b-versatile` is roughly $0.59/$0.79 per MTok versus Claude 3.5 Sonnet's $3/$15 — so text generation is currently running at **roughly 5× input and 19× output cost versus the intended path**, with no alert. At current volumes the absolute figure is small; at launch volume it is the difference between a 94% and a 70% margin on the typical user.

---

## Unverified inputs

- **Railway compute cost per render** — estimated at $0.05–0.15; needs the Railway dashboard.
- **Supabase egress at volume** — modelled at ~$0.09/GB; needs the actual plan and CDN configuration.
- **Real token counts per call** — modelled from prompt sizes, not measured. `messages.count_tokens` against the live prompts would tighten every figure in §5.
- **Whether production sets `ANTHROPIC_MODEL`** — if it points at a current model, §5 costs shift (Opus 5 would raise them ~1.7× on input, Haiku 4.5 would cut them ~3×).
