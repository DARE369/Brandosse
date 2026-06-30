# Groq Prompting Routes & Logic - Complete Reference

This document is the implementation reference for how prompts move through SocialAI today.
It reflects current code paths in:
- `src/services/generationPipeline.js`
- `src/services/groqClient.js`
- `src/stores/SessionStore.js`
- `src/services/suggestedPrompts.js`
- `src/components/BrandKit/BrandKitConversation.jsx`
- `src/services/brandKitConversation.js`
- `supabase/functions/extractBrandKit/index.ts`
- Freepik handoff functions in `src/services/freepik.service.js` and `supabase/functions/*`

## 1. All Groq call sites

### 1.1 ContentPlan generation
- Call site: `callGroqContentPlan(brief)` in `src/services/groqClient.js`
- Trigger: `runGenerationPipeline()` inside `SessionStore.startGeneration()`
- Input: generation brief from `buildGenerationBrief()`
- Expected output: full `ContentPlan` JSON object
- Output use: validated, quality-gated, stored in `content_plans`, then dispatched to single or carousel generation flow

### 1.2 Quality Gate revision
- Call site: `callGroqRevision(plan, violations, brandKit)` in `src/services/groqClient.js`
- Trigger: `runQualityGate()` detects guardrail violations
- Input: current ContentPlan JSON + violation list + brand context
- Expected output: corrected ContentPlan JSON
- Output use: replaces original plan for downstream generation

### 1.3 Generic JSON extractor/helper route
- Call site: `callGroqJSON(prompt, options)` in `src/services/groqClient.js`
- Trigger points:
1. Suggested prompts generation in `src/services/suggestedPrompts.js`
2. Conversational Brand Kit extraction in `src/components/BrandKit/BrandKitConversation.jsx`
3. Legacy hook `src/hooks/useGroqSuggestions.js`
- Input: plain prompt string + optional system/model/temperature settings
- Expected output: valid JSON object
- Output use: feature-specific parsing (suggestions arrays, extracted fields/confidence maps, etc.)

### 1.4 Prompt enhancement (Magic Enhance route)
- Call site: `enhancePromptWithBrand(rawPrompt, brandKit)` in `src/services/groqClient.js`
- Trigger: available utility route for brand-aware enhancement (separate from `ApiService.enhancePrompt`)
- Input: raw prompt + brand kit context
- Expected output: single enhanced prompt string
- Output use: replaces/augments user prompt before generation

### 1.5 Legacy direct Groq text route (non-`groqClient`)
- Call site: `generateTextWithGroq()` in `src/services/ApiService.js`
- Trigger points:
1. `enhancePrompt()`
2. `generateCaption()`
3. `optimizeForSEO()`
- Input: freeform prompt + system prompt
- Expected output: text response (or JSON string for caption/SEO helpers)
- Output use: post-production copy workflows (caption/SEO), prompt enhancement fallback flow

## 2. ContentPlan pipeline (IntentExtractor -> BrandKitLoader -> BriefBuilder -> GroqContentPlanCall -> ContentPlanValidator -> QualityGate -> ContentPlanStore)

## 2.1 Step sequence and contracts

### 2.1.1 IntentExtractor
- File: `src/services/intentExtractor.js`
- Entrypoint: `checkIntentAmbiguity(prompt, brandKit)`
- Input: raw user prompt + brand-kit configured state
- Output: `{ ambiguous: boolean, questions: string[] }`
- Failure handling: local heuristic only; no network failure mode
- Re-call logic: none; if ambiguous, user is asked clarification questions

### 2.1.2 BrandKitLoader
- File: `src/services/brandKitLoader.js`
- Entrypoint: `loadBrandKit(userId)`
- Input: authenticated user ID
- Output: condensed object:
```json
{
  "configured": true,
  "raw": {},
  "summary": "string",
  "asset_context": "string"
}
```
- Failure handling: missing rows produce neutral defaults (`configured: false`)
- Re-call logic: none in this stage

### 2.1.3 BriefBuilder
- File: `src/services/briefBuilder.js`
- Entrypoint: `buildGenerationBrief(...)`
- Input:
1. user input
2. clarifications
3. brand kit summary/raw
4. history summary
5. generation settings (`contentType`, `aspectRatio`, `slideCount`, etc.)
- Output:
```json
{
  "raw_input": "string",
  "intent_hints": {},
  "brand_summary": "string",
  "asset_context": "string",
  "history_summary": "string",
  "platform_targets": ["instagram"],
  "content_type": "single|carousel",
  "media_type": "image|video|edit",
  "aspect_ratio": "1:1|4:5|9:16|16:9",
  "requested_slide_count": "auto|number|null"
}
```

### 2.1.4 GroqContentPlanCall
- File: `src/services/groqClient.js`
- Entrypoint: `callGroqContentPlan(brief)`
- Input: brief above
- Output: full ContentPlan JSON
- Failure handling:
1. HTTP/API error bubbles up
2. invalid JSON parse throws
- User-visible behavior: store sets `error`, canvas toast shows failure

### 2.1.5 ContentPlanValidator
- File: `src/services/contentPlanValidator.js`
- Entrypoint: `validateAndRepairPlan(raw)`
- Input: raw Groq plan
- Output: `{ plan, repairLog }`
- Repairs:
1. missing fields and arrays
2. SEO defaults
3. fallback carousel scaffolding
4. guardrail defaults
- Failure handling: defensive repair, not fail-fast

### 2.1.6 QualityGate
- File: `src/services/qualityGate.js`
- Entrypoint: `runQualityGate(plan, brandKit)`
- Input: validated plan + loaded brand kit
- Output: `{ passed, revisedPlan, notes }`
- Behavior:
1. if no configured brand kit, gate skipped
2. if violations exist, one Groq revision call is attempted
3. on revision failure, original plan is retained

### 2.1.7 ContentPlanStore
- File: `src/services/generationPipeline.js`
- Entrypoint: insert into `content_plans`
- Input: final plan + metadata (`raw_user_input`, `intent_summary`, gate results)
- Output: stored row with `id`
- Failure handling: throws and aborts generation path

## 2.2 Pipeline diagram
```text
User Prompt
  |
  v
IntentExtractor (local heuristic)
  | ambiguous? yes -> clarification UI -> resume
  v
BrandKitLoader + HistoryLoader
  |
  v
BriefBuilder
  |
  v
GroqContentPlanCall (Groq JSON)
  |
  v
ContentPlanValidator (repair)
  |
  v
QualityGate
  | pass ----------------------------\
  | fail -> GroqRevision (1 call max) -> revised or fallback original
  v
ContentPlanStore (DB content_plans)
  |
  v
Single/Carousel image orchestration -> Freepik
```

## 3. Carousel plan route (`generateCarouselPlan`)

## 3.1 Frontend trigger
- `GenerationPromptBar` sends `outputStructure` + `slideCount`
- `GenerationCanvas` calls `SessionStore.startCarouselGeneration(prompt, slideCount)` when structure is `carousel`

## 3.2 Route implementation
- Edge function: `supabase/functions/generateCarouselPlan/index.ts`
- Request body:
```json
{
  "prompt": "string",
  "slideCount": "auto|number",
  "brandKit": {}
}
```
- Groq system prompt enforces:
1. JSON-only output
2. slide objects with `slide_index`, `slide_purpose`, `headline`, `image_prompt`
3. auto mode max 8 slides
4. manual mode exact slide count

## 3.3 Required return shape
```json
{
  "slides": [
    {
      "slide_index": 1,
      "slide_purpose": "hook",
      "headline": "string",
      "image_prompt": "string"
    }
  ]
}
```

## 3.4 Auto vs user-specified slide count
- `slideCount: "auto"`:
1. Groq may choose complexity-based count
2. sanitized to max 8
- `slideCount: number`:
1. Groq instructed to return exact number
2. sanitizer pads fallback slides if short

## 3.5 Handoff to Freepik
- For each `slide.image_prompt`, `startCarouselGeneration()` invokes `generateImage` edge function sequentially
- Placeholder DB rows are inserted first (`status: processing`, `carousel_slide_index`, `carousel_slide_total`)
- Each slide updates independently to `completed` or `failed`

## 3.6 Carousel route diagram
```text
Prompt + Carousel + slideCount
  |
  v
startCarouselGeneration()
  |
  v
generateCarouselPlan (Groq JSON slides)
  |
  v
Insert placeholder generations (N rows)
  |
  v
Loop slides 1..N (sequential)
  |--> generateImage edge function (Freepik)
  |--> update row completed/failed
  |--> refresh grid
  v
Done
```

## 4. Suggested Prompts route

## 4.1 Entry path
- Service: `src/services/suggestedPrompts.js`
- Used in `GenerationCanvas` empty state

## 4.2 Cache behavior
- Key: `socialai_suggestions_${userId}`
- Value:
```json
{
  "prompts": ["..."],
  "generatedAt": "ISO timestamp",
  "brandKitHash": "string"
}
```
- TTL: 10 minutes
- Invalidation:
1. TTL expiry
2. brand kit hash mismatch (`computeBrandKitHash`)

## 4.3 Brand-aware prompt template
```text
You are a social media content strategist.
Generate 4 distinct image generation prompt suggestions for a brand.
...
Return format:
{ "suggestions": ["prompt 1", "prompt 2", "prompt 3", "prompt 4"] }
```

## 4.4 Generic prompt template
```text
You are a creative director.
Generate 4 distinct social media image generation prompts.
Use styles like {seed1} and {seed2} as inspiration.
...
Return ONLY valid JSON:
{ "suggestions": ["prompt 1", "prompt 2", "prompt 3", "prompt 4"] }
```

## 4.5 Failure behavior
- Malformed/failed Groq response -> deterministic static fallback prompt pool

## 5. Brand Kit extraction route (document extraction)

## 5.1 Current implementation state
- Edge function: `supabase/functions/extractBrandKit/index.ts`
- Contains extraction system prompt (`EXTRACTION_SYSTEM_PROMPT`) but currently returns deterministic fallback data
- Actual Groq extraction call is not implemented in this function yet

## 5.2 Current output shape
```json
{
  "brandKit": {},
  "confidenceMap": {},
  "missingTier1Fields": ["brand_name", "brand_voice", "target_audience", "forbidden_phrases", "content_restrictions"],
  "extractionPromptVersion": "extractBrandKit.v1",
  "systemPrompt": "..."
}
```

## 5.3 Confidence and missing-tier logic
- Confidence map values: `high|low|inferred`
- Tier1 field list is hard-coded in edge function
- `missingTier1Fields` is derived by checking empty scalar/array values on fallback object

## 5.4 Route diagram
```text
Upload doc -> storage path
  |
  v
extractBrandKit edge function
  |
  +-- signed URL retrieval
  +-- (current) deterministic fallback builder
  +-- confidenceMap + missingTier1Fields
  v
frontend receives draft -> review/conversation fallback
```

## 6. Conversational Brand Kit route

## 6.1 Section model
- Source: `src/services/brandKitConversation.js`
- Sections:
1. basics
2. voice
3. guardrails
4. visual
5. platforms

Each section defines:
1. `question`
2. `extractFields`
3. `followUpTrigger(mergedData)`

## 6.2 Extraction prompt (per section)
```text
You are extracting brand kit fields from a user's conversational answer.
SECTION: ...
FIELDS TO EXTRACT: ...
USER ANSWER: "..."
EXISTING BRAND KIT DATA: {...}
...
Return:
{
  "extracted": { ... },
  "confidence": { "field_name": "high|low|inferred" }
}
```

## 6.3 Runtime flow
- Component: `BrandKitConversation.jsx`
- On user reply:
1. build section prompt
2. call `callGroqJSON(..., { system: 'Extract structured brand kit fields and return JSON only.' })`
3. merge `extracted` into local state
4. merge confidence map
5. run `followUpTrigger`
6. advance to next section or complete

## 6.4 Route diagram
```text
Section Question
  |
  v
User Answer
  |
  v
buildSectionExtractionPrompt
  |
  v
callGroqJSON
  |
  v
Merge extracted fields + confidence
  |
  +-- followUpTrigger hit -> ask follow-up, stay section
  \-- else -> next section
```

## 7. Quality Gate re-call

## 7.1 Trigger
- `runQualityGate()` executes guardrail checks against brand kit rules:
1. forbidden phrases
2. caption length bounds
3. hashtag count max
4. content restrictions keyword checks

## 7.2 Revision prompt
```text
You are a content compliance editor. You will receive a ContentPlan JSON and a list of guardrail violations.
Fix ONLY the violations. Do not change unrelated fields.
Return the corrected ContentPlan as valid JSON only. No preamble.
```

## 7.3 One re-call maximum
- Exactly one revision attempt is made (`callGroqRevision`)
- If revision fails:
1. pipeline continues
2. original plan remains in use
3. notes include revision failure context

## 8. Freepik handoff mapping

## 8.1 Single image (ContentPlan pipeline)
- Groq field used: `plan.visual_prompt.slides[0].full_prompt` (fallback to `global_style`)
- Frontend service: `generateImages()` in `src/services/freepik.service.js`
- Edge function: `generateImage`
- Parameters passed:
1. `prompt`
2. `brandKit`
3. `aspectRatio`
- Expected response:
```json
{
  "publicUrl": "string",
  "storagePath": "string",
  "taskId": "string",
  "status": "completed",
  "provider": "freepik",
  "prompt": "string"
}
```

## 8.2 Carousel slides (new planner route)
- Groq field used: `slides[i].image_prompt` from `generateCarouselPlan`
- Edge function per slide: `generateImage`
- Same parameters as single image route
- DB updates per row: `status`, `storage_path`, `progress`, `metadata.error` on failures

## 8.3 Edit image route
- User input source: edit instruction text (not Groq-generated)
- Service: `editImage()` -> edge function `editImage`
- Parameters:
1. `prompt`
2. `sourceImageUrl`
3. `brandKit`
4. `aspectRatio`
- Expected response includes `publicUrl`, `taskId`, `provider`

## 8.4 Video route
- User input source: text prompt (not Groq-generated)
- Service: `createVideoJob()` -> edge function `generateVideo`
- Status polling: `checkVideoJobStatus()` -> edge function `videoStatus`
- Expected status response:
```json
{
  "status": "processing|completed|failed",
  "progress": 0,
  "videoUrl": "string|null",
  "jobId": "string"
}
```

## 9. Error handling matrix

## 9.1 Groq malformed JSON
- `callGroqJSON`: throws `Groq returned invalid JSON`
- Suggested prompts route: falls back to static prompt set
- BrandKit conversation: AI bubble shows retry/failure message
- ContentPlan route (`callGroqContentPlan`): throws, generation fails, store `error` set, toast shown

## 9.2 Groq timeout/API failure
- Propagates from Groq client call to caller
- ContentPlan path: generation aborts, no downstream Freepik call
- QualityGate revision path: original plan retained (no hard fail)
- Suggested prompts: fallback prompts

## 9.3 Validation failures
- `validateAndRepairPlan` repairs structurally-invalid fields and logs repair actions
- Hard abort only occurs if downstream DB writes fail (`content_plans` insert, generation row insert)

## 9.4 Carousel partial failures
- Each slide failure updates row to `failed`
- Loop continues for remaining slides
- User sees partial completion instead of total abort

## 9.5 User-visible failures by route
- Generate canvas/store errors: toast via `GenerationCanvas` error effect
- Brand kit extraction loader: explicit failed state with fallback-to-conversational CTA
- Conversational brand kit: inline AI error bubble

## 10. ASCII flow diagrams (major routes)

## 10.1 ContentPlan image route
```text
Prompt -> Intent check -> Clarification (optional)
  -> runGenerationPipeline
  -> loadBrandKit + loadHistory
  -> buildBrief
  -> Groq ContentPlan
  -> validate/repair
  -> quality gate (optional 1 revision)
  -> store content_plans row
  -> generateImage (Freepik)
  -> generations row completed
```

## 10.2 Carousel planner route
```text
Prompt + carousel mode + slideCount
  -> generateCarouselPlan (Groq)
  -> insert N processing rows
  -> for slide 1..N:
       generateImage (Freepik)
       update row completed/failed
  -> final refresh
```

## 10.3 Suggested prompts route
```text
Canvas mount
  -> read localStorage cache (userId + brandKitHash)
  -> cache hit and fresh -> render chips immediately
  -> cache miss/stale -> Groq suggestions call
  -> success: cache + render
  -> failure: static fallback prompts
```

## 10.4 Document extraction route
```text
Upload doc -> invoke extractBrandKit
  -> signed URL lookup
  -> fallback result builder (current implementation)
  -> confidence map + missingTier1Fields
  -> review UI or conversational fallback
```

## 10.5 Conversational extraction route
```text
Section question -> user response
  -> section extraction prompt
  -> Groq JSON extraction
  -> merge fields + confidence
  -> follow-up check
  -> next section / complete
```
