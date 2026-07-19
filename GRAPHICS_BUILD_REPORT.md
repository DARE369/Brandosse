# Graphics Build — End-of-Run Report

**Date:** 2026-07-19
**Branch:** `feat/graphics-quality-core` (not merged, not pushed)
**Built autonomously through Stages 0–6.** Every stage compiles (full `next build` green, exit 0) and is committed.

---

## ⭐ WHAT YOU NEED TO DO (the checklist)

Nothing here is urgent — the app still runs without any of it (features fail open / degrade gracefully). But to actually see the new work live:

### 1. Deploy the two new edge functions (required for their features)
```
supabase functions deploy quality-gate
supabase functions deploy upscaleImage
```
- Also redeploy `generateImage` and `generate-content-plan` (they changed: model routing, model-aware prompts, reference images).
- **`ANTHROPIC_API_KEY` must be set** in Supabase secrets (the quality gate uses Claude Haiku vision — same key the existing asset-tagging already uses). Until deployed, images just render **unscored** (no badges) — safe default, nothing breaks.

### 2. Smoke-test 3 fal.ai endpoints I wired from docs (I could not run them live)
- **`fal-ai/flux-2-pro/edit`** (Stage 4 reference images) — generate with a reference image, confirm it returns.
- **`fal-ai/clarity-upscaler`** (Stage 5.3 upscale) — upscale a generated image, confirm output.
- **4:5 aspect** (Stage 0.1) — generate a 4:5 image, confirm it's actually portrait, not square.
- If any endpoint id is wrong for your fal account, it's a one-line fix in `supabase/functions/_shared/fal.service.ts` (`FAL_MODELS`).

### 3. Review two product/credit decisions I made autonomously
- **First-frame approval (5.1):** text-to-video now generates a still first (charged as an image) → you approve → animate (charged as video). Confirm this two-step + double-charge matches your intent. It follows your locked credit model.
- **Quality-gate thresholds (2.1):** pass ≥80, warn 55–79, fail <54. Tune in `supabase/functions/quality-gate/index.ts` if too strict/lenient once you see real scores.

### 4. Still pending from earlier (unchanged by this build)
- **Nigeria pricing validation** (Mom-Test + fake-door Paystack page) before building billing — see `GRAPHICS_CREDIT_MODEL.md` §10.
- **Paystack billing migration** (Stripe can't pay out to Nigeria) — gated behind the validation above.
- **Merge/push this branch** when you're happy (`git checkout main && git merge feat/graphics-quality-core`).

---

## What got built (Stages 0–6)

| Stage | What | Status |
|---|---|---|
| **0.1** | Fixed 4:5/3:4 aspect silently rendering square (explicit dims for ratios the fal enum can't express) | ✅ |
| **0.2** | Seed/model/prompt now survive to the DB row (was silently overwritten by a client update) | ✅ |
| **1.1** | **Intent-based model routing** — content plan emits `render_intent` → FLUX/Ideogram/Recraft (was hardcoded Ideogram-for-everything, the #1 "looks AI" cause) | ✅ |
| **1.2** | Advanced override chip (Auto/Photo/Text/Design), persists via Content Defaults | ✅ |
| **1.3** | Single **model-aware** prompt enhancement (was always FLUX vocab regardless of model) | ✅ |
| **1.4** | Show-prompt-before-spend | ⏸ deferred (see below) |
| **2.1** | **Visual quality gate** — Claude Haiku vision scores each image (legibility/anatomy/artifacts), non-blocking, fail-open | ✅ |
| **2.2** | Warn/fail badges + one-click "Regenerate (N cr)" on flagged images (charged, no silent auto-spend) | ✅ |
| **3.1** | **Edit/Animate** actions on every result — feeds the image straight in (no URL copy-paste) | ✅ |
| **3.2** | Library **source picker** (grid of your images) for edit/animate | ✅ |
| **3.3** | Result "shot" info in lightbox — model, seed, quality, prompt used | ✅ |
| **3.4** | Deliberate **batch variation** — N variants get distinct directions, not near-dupes | ✅ |
| **4.1** | **Reference-image conditioning** — routes to FLUX.2 multi-reference endpoint (was declared-but-unused) | ✅ |
| **4.2** | **"Match my feed" style-lock** — reference set persists across sessions | ✅ |
| **4.3** | **Pin a subject** as a reference from any result | ✅ |
| **5.1** | **First-frame approval** for text-to-video (frame billed separately from animate) | ✅ |
| **5.2** | **Carousel storyboard approval** before spending slide credits | ✅ |
| **5.3** | **Upscale / finish pass** (fal clarity upscaler, 2 cr, own credit line) | ✅ |
| **6.3** | **Regenerate-the-losers** — bulk regenerate all quality-flagged images | ✅ |
| **6.4** | **Reproducibility receipts** — full recipe (model/seed/quality/refs/upscaled/prompt) per asset | ✅ |
| **6.1** | In-canvas inpainting | ⏸ **deferred** |
| **6.2** | Brand-frame overlay templates | ⏸ **deferred** |

**10 commits**, `c6b6a12` → `e1a1ca2`. Each stage is its own commit with a clean scope.

---

## What I deferred, and why (honest)

**1.4 (show final prompt before spend)** — needs splitting the single-image pipeline into plan→preview→render. Stage 5.2 built exactly that split for carousels, so 1.4 is now a straightforward follow-up (apply the same `planOnly` pattern to `runSingleGeneration`). I chose not to generalize it mid-run to avoid destabilizing the single-image path. The lightbox already shows the prompt *after* render (3.3).

**6.1 (in-canvas inpainting)** and **6.2 (brand-frame overlay templates)** — both are heavy, **interaction-canvas** features (mask-drawing UI / a template editor + compositor). Building them *well* needs a human visual-QA loop — driving the real UI, seeing what renders, iterating. I can't do that unattended, and shipping UI-heavy code I can't visually verify risks something that looks done but isn't — worse than deferring. They're documented as the next real work, not silently dropped.

**Recommendation:** 6.1/6.2 are genuinely worth a working session with you present (or the `frontend-visual-qa` agent driving screenshots). 1.4 is a quick solo follow-up.

---

## Verification done

- ✅ Full `next build` green (exit 0, 52/52 pages) after **every** stage — the authoritative check for a build with no live backend to hit.
- ✅ `check:edge-functions` static check passed (75 functions) after each edge change.
- ✅ `node --check` on every changed JS/JSX file.
- ✅ Fixed the pre-existing Next-16 `.next` codegen corruption (stale cache) so the build is clean.
- ⚠️ **Not done (can't, unattended):** live end-to-end generation against fal.ai / a running app / real screenshots. That's the smoke-test in the checklist above.

---

## New files
- `supabase/functions/quality-gate/index.ts` — vision quality gate
- `supabase/functions/upscaleImage/index.ts` — upscale/finish pass

## Notable architecture notes (for future you)
- The **plan/render split** (`runGenerationPipeline({planOnly})` + `renderCarouselFromPlan`) is the reusable primitive for any "approve before spend" gate. Credit/idempotency/cancel machinery lives *below* the split, so it's safe to gate above it.
- **References always route to FLUX** regardless of the intent-picked model (Ideogram/Recraft don't support refs) — `provider_model` in metadata is the authoritative "what actually ran."
- The **quality gate is fire-and-forget** — it never blocks first paint and never fails a generation. Scores arrive via the existing realtime subscription.
