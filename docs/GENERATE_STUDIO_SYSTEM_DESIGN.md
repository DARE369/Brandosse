# Generate Studio — System Design: how the controls produce results

**Purpose:** before building the redesigned UI, define *exactly* how every control, toggle, and mode wires together to produce a real, meaningful result. This is the engineering contract the UI must honor. Grounded in the current code (cited).

---

## 1. The core mental model (this is the whole thing)

There is **one `settings` object** and **one router**. Every control the user touches just writes a field on `settings`. When they press **Generate**, `startGeneration()` reads `settings.mediaType` + `settings.contentType` and dispatches to the correct pipeline.

- `settings` shape — [SessionStore.js:739](src/stores/SessionStore.js#L739): `mediaType`, `contentType`, `aspectRatio`, `batchSize`, `slideCount`, `model`, `resolution`, `duration`, `fps`, `generateAudio`, `referenceImageUrl` (+ `styleStrength`, `useSeed`/`seed`, and — to add — `negativePrompt`, `brandOn`, `templateId`).
- Router — [SessionStore.js:1007](src/stores/SessionStore.js#L1007): `mediaType` video/image-to-video → `startVideoGeneration`; `edit` → `startEditGeneration` (requires a source image); else image → `runGenerationPipeline` × `batchSize`. Carousel has its own entry `startCarouselGeneration` ([:1138](src/stores/SessionStore.js#L1138)).

**So "how do the buttons work together" = each control writes a field; the *mode* decides which fields matter and which pipeline consumes them.** The UI's job is to (a) show only the controls that affect the chosen mode, (b) write the right field, (c) make the mode→pipeline mapping obvious.

---

## 2. Modes = the master switch (one selector drives everything)

The Mode the user picks sets `mediaType`+`contentType`, which selects the model list, the relevant controls, and the backend path.

| Mode | sets mediaType / contentType | Model list | Pipeline → backend | Result |
|---|---|---|---|---|
| **Image** | image / single | `MAGNIFIC_IMAGE_MODELS` | `runGenerationPipeline` ×`batchSize` → `generateImage` | 1–4 still takes |
| **Carousel** | image / carousel | image models | plan slides → per-slide `generateImage` ×`slideCount` | ordered multi-slide set |
| **Video** (short) | video / single | `MAGNIFIC_VIDEO_MODELS` (LTX) | `startVideoGeneration` → `generateVideo` | one ≤10s clip |
| **Frames → Video** | image-to-video / single | `MAGNIFIC_IMAGE_TO_VIDEO_MODELS` (Kling) | `startVideoGeneration` (needs first-frame image) | animated clip |
| **Edit / Refine** | edit / single | `MAGNIFIC_EDIT_MODELS` (Seedream edit) | `startEditGeneration` (needs source image) | edited image |
| **Flyer** *(NEW — to build)* | flyer / single | image model for background only | template + AI background + **injected text/logo layers** → composite | exact-text flyer |
| **Long video** *(NEW — later)* | video / long | Kling chain | scene breakdown → chained clips → FFmpeg stitch (worker) | ≤2-min video |

Config lives in [magnificModels.js](src/config/magnificModels.js): `getMagnificModelsForMode()`, `getVideoDurationsForModel()`, `estimateMagnificCost()`.

---

## 3. Control matrix — what each control writes and when it matters

✅ = visible & active for that mode · — = hidden (irrelevant) · ⚠ = required for that mode

| Control | Writes to `settings` | Image | Carousel | Video | Frames→Video | Edit | Flyer | What it actually does |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| **Brief / prompt** | `userInput` (arg) | ⚠ | ⚠ | ⚠ | ✅ | ⚠ | ⚠ | the creative instruction; seeds enhance + the model call |
| **Structured intent** (subject·setting·mood·on-image text) | merged into prompt + `enhance-prompt` | ✅ | ✅ | ✅ | — | — | ✅ | scaffolds a strong prompt so users don't under/over-write |
| **Format / aspect ratio** | `aspectRatio` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | output dimensions; auto-defaults per target platform |
| **Model** | `model` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅(bg) | which fal model runs (list filtered by mode) |
| **Quality / resolution** | `resolution` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1K/2K/4K (image) or 1080/1440/2160 (video) — drives cost |
| **Brand on/off** | `brandOn` → `loadBrandKit` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | injects voice + palette into prompt; **composites real logo** |
| **References** (upload/library/URL) | `referenceImageUrl` | ✅(style) | ✅ | — | ⚠ | ⚠ | ✅ | conditioning / first-frame / edit source |
| **Avoid (negative)** | `negativePrompt` | ✅ | ✅ | ✅ | — | — | ✅ | exclusions passed to models that support them |
| **Variants** | `batchSize` (1–4) | ✅ | — | — | — | — | — | how many takes to produce in parallel |
| **Slides** | `slideCount` (2–10/auto) | — | ⚠ | — | — | — | — | number of carousel slides |
| **Duration / FPS / Audio** | `duration`/`fps`/`generateAudio` | — | — | ✅ | ✅ | — | — | clip length, smoothness, sound |
| **Seed** | `useSeed`/`seed` | ✅ | ✅ | — | — | — | ✅ | reproducible / locked composition |
| **Style strength** | `styleStrength` | ✅ | ✅ | — | — | — | ✅ | how hard brand/style is applied |
| **Template + text layers** | `templateId` + layer data | — | — | — | — | — | ⚠ | exact headline/CTA/logo placement (flyer only) |

The **control deck reconfigures when the mode changes** — that *is* the "how everything works together" experience. Picking Video swaps Variants/Style for Duration/FPS/Audio; picking Flyer reveals Template; picking Edit/Frames→Video makes References required.

---

## 4. End-to-end flow (the "get exactly what I want" path)

```
BRIEF                          DIRECT                       GENERATE
prompt + structured intent  →  control deck writes       →  Generate (router by mode)
  │  (optional) Enhance          settings fields              │
  │  enhance-prompt returns      (mode-filtered)              ├─ image → pipeline ×batch → generateImage
  ▼  3 alternatives → pick                                    ├─ carousel → plan slides → generateImage ×N
                                                              ├─ video → startVideoGeneration → generateVideo
                                                              ├─ edit → startEditGeneration (source req.)
                                                              └─ flyer → AI background + composite text/logo
                                                                 every path: brand context + (if logo) composite
   RESULTS                      DIRECT / REFINE              PUBLISH
   N takes, each carries     →  nudge (brighter, crop,    →  Use → post-production
   prompt+settings+cost+seed    on-brand, "more like #1")     per-platform captions (generate-post-metadata,
   inspect to learn             re-runs KEEPING context       brand voice, char limits) → multi-platform publish (mocked, labeled)
```

Supporting backends already in place: `enhance-prompt` ([SessionStore.js:1695](src/stores/SessionStore.js#L1695)), `generate-post-metadata` brand-voice captions ([:384](src/stores/SessionStore.js#L384), [:1882](src/stores/SessionStore.js#L1882)), `seo-score`/`optimize-seo` ([:1966](src/stores/SessionStore.js#L1966), [:2062](src/stores/SessionStore.js#L2062)).

---

## 5. Engineering gaps to close (so results are actually meaningful)

These are the real work items — without them the controls exist but don't change the output:

1. **Mode-aware control visibility** is not enforced — the UI must show only relevant controls per mode and write the correct field (Section 3). *(UI)*
2. **Flyer mode doesn't exist** — no `flyer` content type, no template set, no text/logo layer compositor. Needs: template registry, editable layer model, AI-background call, composite step. *(plan #7)*
3. **"Avoid" (negative) + References are not threaded** from UI → pipeline for image/carousel (edge supports negative after task #2; UI field + settings plumbing missing). *(UI + store)*
4. **Structured intent is collected then discarded** — must merge into the prompt + `enhance-prompt`, not seed once. *(store + edge)*
5. **Enhance overwrites the prompt** instead of surfacing the 3 alternatives the backend already returns. *(UI)*
6. **Credits are mocked** (`MOCK_STUDIO_CREDIT_FLOOR`) — unify on `user_credits`, deduct on success, show pre-gen cost from `estimateMagnificCost`. *(plan #8)*
7. **Long-video (2-min)** orchestration absent — scene breakdown + clip chaining + FFmpeg stitch in the worker. *(plan #11)*

---

## 6. Build order (foundation-first, each step independently visible)

1. **Mode-aware control deck** (Section 3 matrix) — the spine of "everything works together." Pure UI + settings plumbing; instantly demonstrable.
2. **Thread Avoid + References + structured intent + brand toggle** into `settings` → pipeline (close gaps 3–4).
3. **Enhance → alternatives** (gap 5).
4. **Real credits + pre-gen cost** (gap 6).
5. **Flyer mode** (gap 2).
6. **Long video** (gap 7).

Steps 1–4 make the *existing* image/carousel/video modes produce genuinely controllable results; 5–6 add the new capabilities.
