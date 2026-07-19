# Graphics Generation — Staged Implementation Plan

**Date:** 2026-07-19
**Companion to:** [GRAPHICS_GENERATION_AUDIT.md](GRAPHICS_GENERATION_AUDIT.md)
**Optimized for:** *Max quality, fast* — front-load the changes that make output stop looking like AI.
**Model-control decision:** Auto-route by intent **+** an advanced override chip (Photo · Text · Design · Auto).

---

## How to read this

Each stage is independently shippable and leaves the app in a working state. Within a stage, tasks are ordered by dependency. Every task lists: **what**, **files**, **acceptance criteria (AC)**, and **risk**.

Legend: 🟢 low risk · 🟡 medium · 🔴 higher risk (touches billing/idempotency or user-facing flow).
Effort: **S** ≤ half day · **M** ~1–2 days · **L** ~3–5 days.

---

## STAGE 0 — Quick wins & safety net (do immediately)

Small, isolated, high-visibility. No dependencies. Ship as one PR.

### 0.1 — Fix 4:5 / 3:4 aspect ratio downgrade 🟢 S
- **What:** `4:5` is offered in the UI but missing from `aspectToFalImageSize()`, so it silently renders as square. Add `4:5`→`portrait_4_3` (or pass explicit width/height), and confirm `3:4`/`4:3` map correctly.
- **Files:** `supabase/functions/_shared/fal.service.ts` (`aspectToFalImageSize`), cross-check `ASPECT_RATIOS` in `src/config/mediaGenerationOptions.js` and `ASPECT_DIMENSIONS` in `src/services/media.service.js`.
- **AC:** Requesting 4:5 produces a portrait image, not a square. All four UI ratios round-trip correctly end to end.
- **Risk:** 🟢 One-line map; the only trap is that the fal enum is coarse (4:3 not 4:5) — verify the delivered pixels, don't trust the label.

### 0.2 — Persist and surface seed + model + final prompt on every generation 🟢 S
- **What:** These are already written to `generations.metadata` (`seed`, `image_model`, `provider_model`, `enhanced_prompt`) — just not read back anywhere. This is a prerequisite for Stage 3 (result card) and Stage 4 (reproducibility). No new columns; confirm the write path is complete and consistent across image/edit/video.
- **Files:** `generateImage/index.ts`, `editImage/index.ts`, `generateVideo/index.ts`, `generationPipeline.js` (metadata merge).
- **AC:** For any completed generation, `metadata` reliably contains `seed`, `image_model`, `provider_model`, and the final rendered prompt.
- **Risk:** 🟢 Read-audit + fill gaps only.

---

## STAGE 1 — The quality core (backend-heavy, biggest win)

**This is the priority stage.** Mostly `fal.service.ts` + `generateImage` + the content-plan schema. Attacks "looks AI" directly with almost no new UI.

### 1.1 — Intent-based image-model routing 🟡 M
- **What:** Content-plan LLM emits a `render_intent` field: `photo` | `text_graphic` | `vector_design`. Map it → FLUX.2 Pro / Ideogram / Recraft in `generateImageByModel`. This replaces the hardcoded `'ideogram'` default with an *intent-aware* default.
- **Files:**
  - `src/services/groqClient.js` — add `render_intent` to `CONTENT_PLAN_SCHEMA_SKELETON` + system prompt rule.
  - `supabase/functions/generate-content-plan/index.ts` — ensure the field is passed through / validated.
  - `src/services/contentPlanValidator.js` — default `render_intent` to `photo` if missing.
  - `generateImage/index.ts` + `fal.service.ts` — accept an explicit `image_model` OR derive from `render_intent` when none passed.
  - `SessionStore.js` — stop hardcoding `'ideogram'`; pass through the resolved model.
- **AC:** A "photorealistic product shot" prompt routes to FLUX; a "quote card / flyer with text" routes to Ideogram; a "logo / vector badge" routes to Recraft — verified by `provider_model` in metadata. Existing generations unaffected.
- **Risk:** 🟡 Cross-layer change (LLM schema → validator → edge fn → store). Keep a hard fallback to a safe default (FLUX 2 Pro is the safest generalist) if intent is unknown.

### 1.2 — Advanced model override chip 🟢 S
- **What:** Per the model-control decision: a compact, secondary control in the brief panel — `Auto · Photo · Text · Design`. `Auto` (default) uses 1.1's routing; the others force the model. Reads/writes `settings.imageModel` (already exists in the store).
- **Files:** `src/pages/Studio/StudioPage.jsx` (brief panel, near Format card), `StudioPage.module.css`, `SessionStore.js` (already has `imageModel`).
- **AC:** Default is Auto and invisible-cost; choosing Photo/Text/Design forces that model and is reflected in the result's `provider_model`. Persists via Content Defaults like aspect ratio does.
- **Risk:** 🟢 Additive UI; the routing already exists from 1.1.

### 1.3 — Collapse to a single, model-aware prompt enhancement 🟡 M
- **What:** Remove the second blind Claude-Haiku rewrite inside `generateImage` that always assumes FLUX. Instead:
  - Have the content-plan produce the near-final render prompt, **and**
  - Make the (single, kept) enhancer **model-specific**: Ideogram → explicit `text: "..."` blocks; FLUX → photographic lens/lighting/composition; Recraft → style tokens + brand colors.
  - Pass `enhance_prompt: false` from the pipeline once the content-plan prompt is trusted, OR route through the model-aware enhancer — pick one, not both.
- **Files:** `generateImage/index.ts` (the `callPromptEngine` block), `generationPipeline.js` (whether it passes `enhance_prompt`), possibly a small `_shared/promptTemplates.ts`.
- **AC:** A prompt is rewritten **once**, with vocabulary matching the model it's sent to. The final rendered prompt is stored (0.2) and identical to what fal received. Latency drops (one fewer LLM call).
- **Risk:** 🟡 Touches the creative core — A/B a few prompts before/after to confirm output improves, not just changes.

### 1.4 — Show the final prompt before spend (inline edit) 🟢 S–M
- **What:** After the content plan resolves but before (or alongside) render, surface the prompt that will actually be sent, with an "edit prompt" affordance. Removes the "spend credits, then discover the prompt drifted" problem.
- **Files:** `StudioPage.jsx` (generating/brief stage), store wiring to expose the resolved prompt.
- **AC:** User can see and optionally edit the exact render prompt; edits are respected on render.
- **Risk:** 🟢 Additive. Keep it non-blocking (a peek/edit, not a mandatory gate) so the fast path stays fast.

**Stage 1 exit criteria:** the same prompt that used to always hit Ideogram-via-FLUX-vocabulary now hits the *right* model with the *right* vocabulary, rewritten once, visibly. This is the single largest quality delta in the whole plan.

---

## STAGE 2 — The "looks human" gate

Catch and fix bad drafts instead of shipping 100% of them.

### 2.1 — Visual quality gate (vision model) 🟡 M
- **What:** After render, run `callGroqVisionJSON` (already wired, currently unused for this) on the image against a rubric: legible text? correct subject/hand/limb count? no watermark/artifacts? matches requested aspect? on-brand palette? Returns `quality_score` (0–100) + `flags[]`.
- **Files:** new `src/services/visualQualityGate.js`, called from `generationPipeline.js` after `completeGeneration`; persist score/flags into `generations.metadata`.
- **AC:** Every completed image carries a quality score + flags. A garbled-text or extra-limb image is flagged.
- **Risk:** 🟡 Adds latency + a vision call cost per image — make it async/non-blocking (score arrives shortly after the image) so it never delays first paint. Budget the cost in credit math.

### 2.2 — Auto-retry-once on hard fail + soft warning UI 🟡 S–M
- **What:** If 2.1 returns a hard failure (e.g. garbled text on a text_graphic), auto-regenerate **once** with a new seed before showing the user. Softer flags show a subtle inline hint ("⚠ text may be garbled — regenerate?").
- **Files:** `generationPipeline.js` (retry logic — reuse the existing seed/idempotency plumbing carefully), `StudioPage.jsx` (result card hint).
- **AC:** A hard-fail image is silently re-rolled once; a soft-flag image ships with a dismissible hint. Retry respects credit rules (the auto-retry is on us or clearly accounted — decide policy explicitly).
- **Risk:** 🔴 Touches credit/idempotency. The retry must NOT double-bill silently — define whether auto-retry is free (absorbed) or charged, and enforce it.

---

## STAGE 3 — Unlock stuck features + real result card

Everything here already half-exists in the backend; this makes it reachable and iterative.

### 3.1 — "Animate" and "Edit" actions on every result 🟡 M
- **What:** Replace the "type a source image URL" text box with buttons on each generated image → feed that generation's `storage_path` directly into frames-to-video / edit as the source. No hand-copying URLs.
- **Files:** `StudioPage.jsx` (result card actions), `SessionStore.js` (`startEditGeneration` / `startVideoGeneration` accept a source directly), the URL box stays only as a manual fallback.
- **AC:** From any completed image, one click starts an edit or an animate flow with that image pre-loaded as source.
- **Risk:** 🟡 Flow wiring; the edge fns already accept a URL.

### 3.2 — Library "use this asset" picker for source images 🟡 S–M
- **What:** For edit / frames-to-video, a picker that pulls from the user's Library / prior generations instead of a raw URL field.
- **Files:** `StudioPage.jsx`, reuse `assetLibraryService.js` / Library components.
- **AC:** User can pick a source image from Library without leaving Studio.
- **Risk:** 🟡 Mostly UI reuse.

### 3.3 — Rebuild the result card as a "shot" object 🟡 M
- **What:** Surface prompt-used / model / seed (from 0.2); add per-card actions: **Vary this** (same prompt, new seed), **More like this** (re-enhance from this prompt), **Edit**, **Upscale** (Stage 5), **Animate** (3.1), plus the quality badge from 2.1.
- **Files:** `StudioPage.jsx` result grid + lightbox, `StudioPage.module.css`.
- **AC:** A result feels reproducible (seed visible, "vary" works) and iterable (more-like-this / edit inline).
- **Risk:** 🟡 UI-heavy; logic mostly already exists (`regenerateVariant`).

### 3.4 — Deliberate batch variation 🟢 S–M
- **What:** "Generate 4 variants" spreads seeds **and** asks the enhancer for N distinct directions (angle/lighting/crop/mood) instead of one prompt ×N.
- **Files:** `generationPipeline.js` (batch loop), enhancer prompt.
- **AC:** 4 variants are visibly different takes, not near-dupes.
- **Risk:** 🟢 Contained to the batch loop.

---

## STAGE 4 — Brand consistency (the 2026 differentiator)

Moves output from "generic AI" to "looks like *this* brand."

### 4.1 — Reference-image conditioning 🟡 M
- **What:** Populate the already-declared `FalImageInput.image_urls` from (a) brand-kit reference images and (b) a user-picked "match these" set, so generations are conditioned on real images, not just text descriptors.
- **Files:** `fal.service.ts` (pass `image_urls` through for models that support it), `generateImage/index.ts`, brand-kit loader, StudioPage (a "match these" affordance).
- **AC:** Providing reference images visibly shifts output toward them. Gracefully no-ops on models that don't support references.
- **Risk:** 🟡 Model-dependent support; verify per model which accept `image_urls`.

### 4.2 — "Match my feed" style-lock 🟡 L
- **What:** A brand saves 2–4 hero/anchor images; a single toggle silently rides those along as references on every generation (built on 4.1). Optionally learn a palette.
- **Files:** brand kit schema + UI, `generationPipeline.js` (inject anchors when toggle on), StudioPage toggle.
- **AC:** With style-lock on, a run's output consistently resembles the anchor set across sessions.
- **Risk:** 🟡 Depends on 4.1; scope the "learn a palette" part separately if it balloons.

### 4.3 — Pin a recurring subject (product/character) 🟡 M
- **What:** Lightweight "pin this" that re-feeds a subject's best prior render as a reference for consistency across generations (no LoRA training — reference-image approach).
- **Files:** builds on 4.1; a small pinned-subject store + UI.
- **AC:** A pinned product/mascot stays recognizably consistent across separate generations.
- **Risk:** 🟡 Consistency via references is approximate — set expectations in copy.

---

## STAGE 5 — Video control + finishing

Bring control to the most expensive, blindest surface, and add the finishing steps humans always do.

### 5.1 — First-frame approval for text-to-video 🔴 M
- **What:** For text-to-video, first generate a **still first frame** (cheap image gen), let the user approve/regenerate it, then animate the *approved* frame via image-to-video. Reuses image infra.
- **Files:** `StudioPage.jsx` video flow, `SessionStore.startVideoGeneration`, `generateVideo` path.
- **AC:** No text-to-video render starts until a first frame is approved; the animated result derives from that frame.
- **Risk:** 🔴 Changes the video flow + credit timing (frame gen is a separate small spend). Define the credit model up front.

### 5.2 — Prompt-to-storyboard for carousels 🟡 M
- **What:** Before spending full credits, show the slide-by-slide plan (draft stills or text) and let the user approve/reorder/edit. Approve-then-render.
- **Files:** `generationPipeline.js` carousel path (already sequential), StudioPage carousel UI.
- **AC:** User approves/edits the storyboard before the full carousel is rendered.
- **Risk:** 🟡 The carousel path is already sequential, which helps.

### 5.3 — Upscale / finish pass 🟡 M
- **What:** Optional one-click (or auto on "Use this") upscale + detail enhance via a fal upscaler before the asset lands in Library/publish. Small credit cost.
- **Files:** new upscale action in `fal.service.ts` + edge fn, StudioPage/result-card wiring, credit config.
- **AC:** "Use this" can deliver a genuinely higher-res, cleaner asset; cost is transparent.
- **Risk:** 🟡 New provider model + a new credit line item.

---

## STAGE 6 — Studio-grade polish

### 6.1 — In-canvas inpainting / object edit 🔴 L
Brush + `editImage` (Kontext already supports prompt-driven edit): "remove this", "change the shirt to red", "swap the background." Files: new masking UI + `editImage` mask support. Risk 🔴 (new interaction surface).

### 6.2 — Brand-frame overlay templates 🟡 M
Saved templates (safe-zones, headline slots, brand frames) applied *after* generation for pixel-perfect, legally-safe text/layout. Extends the existing logo-composite path.

### 6.3 — Quality-scored history + "regenerate the losers" 🟢 S–M
Persist the 2.1 score on every asset; filter Library by it; bulk-regenerate low-scorers. Depends on 2.1.

### 6.4 — Reproducibility receipts 🟢 S
Expose the full recipe (model, seed, final prompt, references) per asset. Mostly surfacing 0.2 + 4.x data.

---

## Dependency map (what blocks what)

```
0.1  ─ standalone
0.2  ─ prerequisite for → 3.3, 6.4
1.1  ─ prerequisite for → 1.2, 1.3
1.3  ─ prerequisite for → 3.4 (variation reuses the enhancer)
2.1  ─ prerequisite for → 2.2, 3.3 (badge), 6.3
3.1  ─ prerequisite for → (uses result card) 3.3
4.1  ─ prerequisite for → 4.2, 4.3
5.1  ─ reuses image infra from Stage 1
```

## Recommended first PR
**Stage 0 (0.1 + 0.2) + Stage 1 (1.1 + 1.2 + 1.3).** That is the entire quality core plus the two quick wins — the highest quality-per-effort work in the plan, mostly backend, low UI risk. 1.4 can follow immediately after as a small additive UI change.

## Open decisions to lock before building
1. **Auto-retry credit policy (2.2):** is the single auto-retry free (absorbed) or charged? — affects `finance-ops` math.
2. **Visual-gate cost (2.1):** vision call per image — budget it into credit pricing or run it sampled?
3. **First-frame spend model (5.1):** is the approval-frame gen a separate charged step or bundled into the video credit?
4. **Upscale pricing (5.3):** free on "Use this", or its own credit line?

These four are the only places this plan touches money/flow — worth a `finance-ops` pass before Stage 2 and Stage 5.
