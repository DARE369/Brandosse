# Graphics Generation — System Audit & Refinement Report

**Date:** 2026-07-18
**Scope:** The end-to-end graphics workflow — image, carousel, image edit, text-to-video, and frames-to-video — across UI, orchestration, AI/prompt layer, provider layer, and results presentation.
**Goal:** Make what we generate genuinely *usable in the real world* and *indistinguishable from human-made* work, not just "renders without erroring."

---

## 0. How the pipeline actually works today (verified in code)

I traced every hop so the recommendations below are grounded, not guessed.

```
User types prompt in StudioPage (brief panel)
   │  mode chips: image / carousel / video / edit / frames-to-video
   │  aspect ratio, batch size, slide count, duration, quality, "Match brand kit" toggle
   ▼
[Optional] "Enhance prompt" button → enhance-prompt edge fn (LLM, brand-aware, returns variants)
   ▼
startGeneration() → SessionStore → runGenerationPipeline()  (generationPipeline.js)
   │  1. load brand kit          (loadBrandKit)
   │  2. load last 10 generations (history)
   │  3. buildGenerationBrief    (briefBuilder.js)
   │  4. callGroqContentPlan     → generate-content-plan edge fn (Groq→Claude failover)
   │        produces a big ContentPlan JSON incl. visual_prompt.slides[].full_prompt
   │  5. validate + auto-repair plan
   │  6. runQualityGate          (caption/hashtag guardrails only — NOT visual)
   │  7. store content_plans row
   │  8. dispatch:
   ▼
runSingleGeneration / runCarouselOrchestration
   │  prompt = plan.visual_prompt.slides[0].full_prompt
   │  insert generations row (status=processing)
   ▼
generateImages()  (media.service.js) → generateImage edge fn
   │  imageModel = settings.imageModel || 'ideogram'   ◄── ALWAYS 'ideogram' (no UI)
   │  ENHANCE AGAIN: Claude Haiku rewrites the prompt a 2nd time
   │  generateImageByModel() → fal.ai (Ideogram v3 / Recraft v3 / FLUX.2 Pro)
   │  fetch result → optional logo composite → upload to Supabase Storage
   │  completeGeneration() writes COMPLETED onto the row
   ▼
Results grid in StudioPage → "Continue to post production" → PostProductionPanel
```

Video is the same idea but **submit-and-return**: `generateVideo` reserves credits, creates a `background_jobs` row, submits to fal.ai's async queue with a webhook, and returns a job id in seconds. Completion is observed later by `job-webhook` (preferred) or the `process-jobs` pg_cron poller (fallback). This part is architecturally solid.

**The bones are good.** Idempotency (request_id/slot), credit reserve-then-refund, honest cancel, async video with webhook+poller fallback, and the sync-then-queue image fallback are all real and well-reasoned. The system is *locked down* on correctness and billing. What it is **not** yet is *tuned for output quality and creative control* — and that is exactly the gap between "it works" and "it looks like a human made it."

---

## 1. Gaps & Lapses Identified

Ranked by impact on perceived output quality.

### 🔴 G1 — One image model for everything (the biggest single quality lapse)
The backend routes to **three** models with genuinely different strengths (`fal.service.ts`):

| Model | Real-world strength | Weakness |
|---|---|---|
| **Ideogram v3** (current hardcoded default) | Legible **text-in-image** — flyers, quote cards, captions baked into the graphic (90–95% text accuracy) | Photorealism of people/products is weaker than FLUX/Imagen |
| **FLUX.2 Pro** | **Photorealism** — skin, product shots, lifestyle scenes | Text in image is unreliable |
| **Recraft v3** | **Design language** — vector, logos, typographic layouts, explicit brand-color steering | Not for photoreal scenes |

Right now `settings.imageModel` is `'ideogram'` in `SessionStore.js` and **there is no control in `StudioPage.jsx` to change it.** So a user asking for a photorealistic product shot gets Ideogram (text engine) rendering a photo — the single most common reason AI output "looks AI." We built a 3-lane road and drive everything in one lane.

### 🔴 G2 — Double, blind prompt enhancement
The prompt gets rewritten **twice**, by two different models, with no visibility:
1. `generate-content-plan` (Groq/Claude) writes `visual_prompt.full_prompt`.
2. `generateImage` then runs **Claude Haiku again** ("You are an expert FLUX.2 Pro prompt engineer") on top of that.

Problems: (a) the 2nd enhancer's system prompt is hardcoded to **FLUX.2 Pro** even when we're actually sending to **Ideogram** — wrong technical vocabulary for the wrong model; (b) two rewrites compound drift away from the user's literal intent; (c) the user never sees the prompt that was actually rendered until *after* spending credits. This is latency and credits spent to make the output *less* faithful.

### 🟠 G3 — No visual quality gate
`runQualityGate()` only checks **caption/hashtag** rules (forbidden phrases, length, hashtag count). Nothing ever looks at the **generated image**. There is no check for: garbled text, extra fingers/limbs, watermarks, wrong aspect ratio, off-brand colors, or "this is clearly AI." A human art director rejects ~30–50% of first drafts; we ship 100%. We even have `callGroqVisionJSON()` (a vision model) already wired and unused for this.

### 🟠 G4 — "Frames to video" can't actually take a frame from the app
`image-to-video` / `edit` require a **source image URL typed into a text box** (`StudioPage.jsx` line ~648: *"Source image URL (from Library or a generated asset)"*). There is no "animate this" button on a generated image, no picker from Library, no upload. The user has to hand-copy a URL. The feature technically exists but the real-world path to use it is broken UX. Same for image-edit.

### 🟠 G5 — No reference-image / brand-consistency conditioning
`FalImageInput` already declares `image_urls` for reference images, but **nothing populates it.** Brand kit is injected as *text* only ("Visual style: minimal, warm"). There's no way to say "make it look like *these* three of my posts" or keep a recurring character/product/mascot consistent across generations. In 2026 this (reference images, style locking, ControlNet-style conditioning) is the single biggest lever for on-brand, repeatable output — and it's the #1 thing that separates a toy from a tool a real brand can rely on.

### 🟡 G6 — Batch = same prompt N times (no variation)
"Generate 4 variants" sends the **identical** prompt 4× with no seed spread and no prompt variation. fal.ai will vary somewhat by random seed, but we're not *deliberately* exploring angle/lighting/composition. Users expect 4 *different* takes, not 4 near-dupes.

### 🟡 G7 — Results presentation is thin
The results grid shows the image and a "Use this" / regenerate / maximize hover. What it does **not** show, and a pro tool must: the **actual prompt used**, the **model + seed** (for reproducibility), a way to **tweak-and-rerun from this exact image** (vary this / more like this / edit this), or any **quality signal**. Metadata exists in the DB (`seed`, `provider_model`, `cost_usd`) — it just never surfaces.

### 🟡 G8 — No upscale / finishing step
fal.ai returns web-res images. There's no upscale-to-print/retina, no face/detail enhancement, no background cleanup — all standard "make it look finished" steps a human would do. The `2048px` dimensions in `media.service.js` are just *labels* we attach; we don't actually control or upscale output resolution.

### 🟡 G9 — Video is fire-and-forget with zero preview or first-frame control
Text-to-video and frames-to-video submit a prompt and hope. No storyboard, no first/last-frame preview, no "here's the frame we'll animate — approve it first." At $5–15 credits/clip this is the highest-cost, lowest-control surface in the app.

### 🟢 G10 — Aspect ratio silently downgrades
`4:5` (Instagram portrait — a top-4 social format, offered in the UI) is **not** in `aspectToFalImageSize()`, so it silently falls through to `square_hd` (1:1). The user asks for portrait and gets a square. Small bug, very visible result.

---

## 2. Significant Improvements to Make

Grouped so they can ship in sensible waves. Each maps to gaps above.

### Wave 1 — Highest quality-per-effort (do first)

**I1. Auto-route the image model by intent (fixes G1).**
Don't make the user learn 3 models. Infer it: let the content-plan LLM emit a `render_intent` field (`photo` | `text_graphic` | `vector_design`) and map it → FLUX.2 Pro / Ideogram / Recraft in `generateImageByModel`. Add an optional advanced override chip ("Photo · Text · Design · Auto") for power users. This one change probably does more for perceived quality than everything else combined.

**I2. Collapse to a single, model-aware prompt enhancement (fixes G2).**
Kill the second blind rewrite. Either (a) have the content-plan produce the final render prompt and pass `enhance_prompt: false` to `generateImage`, or (b) keep one enhancer but make its system prompt **model-specific** (Ideogram wants "exact text: '...'", FLUX wants photographic lens/lighting, Recraft wants style tokens). Show the user the final prompt *before* render with an inline "edit prompt" affordance. Faster, cheaper, more faithful, transparent.

**I3. Fix the 4:5 (and add 3:4) aspect mapping (fixes G10).** One-line map addition. fal supports `portrait_4_3`; pick the nearest and/or pass explicit width/height.

**I4. Wire "Animate" and "Edit" buttons onto every generated image + a Library picker (fixes G4).**
Replace the URL text box with: a button on each result card → sends that generation's `storage_path` straight into frames-to-video / edit as the source. Add a Library "use this asset" picker. The plumbing already accepts a URL — we just need to hand it the URL the user already made.

### Wave 2 — The "looks human" layer

**I5. Add a visual quality gate (fixes G3).** After render, run `callGroqVisionJSON` (already wired) on the image with a rubric: *legible text? correct subject count? no watermark/artifacts? matches requested aspect? on-brand palette?* Return a 0–100 confidence + flags. Auto-retry once (new seed) if it fails hard; otherwise surface a subtle "⚠ text may be garbled — regenerate?" hint. This is the difference between shipping 100% of drafts and shipping the good ones.

**I6. Reference-image & brand conditioning (fixes G5).** Populate `image_urls` from (a) brand kit reference images and (b) a user-picked "match these" set. Let a brand save a **style anchor** (2–4 hero images) that silently rides along on every generation. For recurring subjects, a lightweight "pin this product/character" that re-feeds its best prior render. This is the 2026 table-stakes feature for brand-consistent output.

**I7. Real batch variation (fixes G6).** For N variants, spread seeds *and* have the enhancer emit N deliberately different directions (angle/lighting/crop/mood) rather than one prompt ×N.

**I8. Upscale / finish pass (fixes G8).** Optional one-click (or automatic on "Use this") upscale + detail enhance via a fal upscaler model before it lands in Library/publish. Gate behind a small credit cost.

### Wave 3 — Presentation & video control

**I9. Rebuild the result card as a real "shot" object (fixes G7).** Surface prompt-used, model, seed; add **"Vary this" / "More like this" / "Edit" / "Upscale" / "Animate"** actions per card; add a quality badge from I5. Reproducibility (same seed) + iteration (vary) is what makes it feel like a studio.

**I10. First-frame approval for video (fixes G9).** For text-to-video, generate a **still first frame** first (cheap image gen), let the user approve/regenerate it, *then* animate the approved frame via image-to-video. Turns the most expensive, blindest surface into the most controllable one, and reuses image infra we already have.

---

## 3. New Capabilities We Hadn't Considered

Things that aren't fixes to existing gaps — genuinely new surface that would move us from "generator" to "creative tool."

- **N1. "Match my feed" style-lock.** One toggle that conditions every render on the brand's own best-performing past posts (reference images + learned palette), so output looks like *this brand*, not generic AI. Directly attacks the "all AI content looks the same" problem.
- **N2. Prompt-to-storyboard for carousels & video.** Before spending credits, show the *plan* (slide-by-slide thumbnails-as-text, or cheap draft stills) and let the user approve/reorder/edit. Approve-then-render instead of render-then-regret.
- **N3. In-canvas inpainting / object edit.** "Remove this", "change the shirt to red", "swap the background" via a brush + `editImage` (Kontext already supports prompt-driven edit) — the finishing move humans always do and AI tools are judged on.
- **N4. Deterministic brand-frame overlay templates.** Beyond the existing logo composite: saved templates (safe-zones, headline slots, brand frames) applied *after* generation so text/layout is pixel-perfect and legally safe, not left to the model to render correctly.
- **N5. Quality-scored history & "regenerate the losers."** Persist the I5 quality score on every generation; let the user filter Library by it and bulk-regenerate low-scorers.
- **N6. Model/seed reproducibility receipts.** Store and expose the full recipe (model, seed, final prompt, references) per asset so a good result is *repeatable* — foundational for brands that need consistency and for our own debugging.

---

## 4. What NOT to touch

To be clear about what's already right, so effort goes where it counts:

- ✅ Idempotency (request_id/slot, cached replay) — correct and battle-tested in code comments.
- ✅ Credit reserve-before-work + auto-refund-on-failure — solid, don't refactor.
- ✅ Async video via webhook + pg_cron poller fallback, with fal's *own* status/response/cancel URLs (the 2026-07-12 405 bug fix) — leave it.
- ✅ Honest cancel semantics — good.
- ✅ Generation-row ownership split (client owns PROCESSING/FAILED, edge fn owns COMPLETED) — correct, don't merge.

---

## 5. Recommended sequencing

| Step | Items | Why first |
|---|---|---|
| **1** | I1 (model routing), I2 (single enhance), I3 (4:5 fix) | Biggest quality jump, mostly backend, low risk, no new UI surface |
| **2** | I4 (animate/edit buttons + Library picker) | Unlocks two features that already exist but are unreachable |
| **3** | I5 (visual quality gate), I9 (result card) | The "looks human" gate + surfacing what we already store |
| **4** | I6/N1 (reference & style-lock), I7 (batch variation) | The 2026 brand-consistency differentiator |
| **5** | I10/N2 (first-frame approval, storyboard), I8 (upscale) | Control over the expensive video surface + finishing |
| **6** | N3 (inpainting), N4 (templates), N5/N6 (quality history, receipts) | Studio-grade polish |

**My recommendation: start with Step 1 (I1 + I2 + I3).** It's the highest quality-per-line-of-code change, it's almost entirely inside `fal.service.ts` / `generateImage` / the content-plan schema, and it directly attacks the "looks AI" problem without needing new UI. I3 is a literal one-line bug fix that should go in regardless.

---

## Sources (2026 model landscape, used to benchmark our routing)
- [Best AI Image Models 2026 — FLUX, GPT Image 2, Seedream, Ideogram, Imagen 4, Recraft Compared (Melies)](https://melies.co/compare/ai-image-models)
- [Best AI Image Generation Models in 2026 (Atlas Cloud)](https://www.atlascloud.ai/blog/guides/best-ai-image-generation-models-2026)
- [Best AI Image Generators for Character Consistency 2026 (MagicHour)](https://magichour.ai/blog/best-ai-image-generators-for-character-consistency)
- [Maintaining Brand Consistency in AI Images & Video (Leonardo.Ai)](https://leonardo.ai/news/maintaining-brand-consistency-in-ai-images-and-videos)
- [AI Image Generators That Support Image Reference 2026 (Neolemon)](https://www.neolemon.com/blog/ai-image-generators-that-support-image-reference/)
