# Stage 4 Implementation Report

## Metadata

| Field | Value |
| --- | --- |
| Stage | Stage 4 - SEO Scoring + Optimization |
| Date | April 5, 2026 |
| Fix Pack ID | `ST4-FIXPACK-20260405` |
| Status | Implemented + Build Verified |
| Build Check | `npm run build` passed |

## Stage 4 Scope Confirmed

Stage 4 implementation covered:

1. Dedicated SEO scoring edge function (`seo-score`)
2. Post-production SEO gate (score -> optimize -> proceed)
3. SEO scoring + optimization in Office edit modal
4. SEO state persistence to database (`seo_state`, `workflow_state`)
5. Standardized score breakdown (title/caption/hashtags)

## Fix Register

| Fix ID | Fix Name | Status | Primary Area |
| --- | --- | --- | --- |
| `FIX-ST4-001` | SEO Scoring Edge Function (`seo-score`) | Done | Backend scoring |
| `FIX-ST4-002` | Post-Production SEO Gate UX | Done | Generate flow |
| `FIX-ST4-003` | SEO Store State + Persistence Contract | Done | State/data consistency |
| `FIX-ST4-004` | Office Edit Modal SEO Integration | Done | My Office workflow |
| `FIX-ST4-005` | Org Draft SEO Service Extension | Done | Org workflow service |

## Files Added

1. `supabase/functions/seo-score/index.ts`
2. `docs/STAGE_4_README.md`
3. `docs/STAGE_4_IMPLEMENTATION_REPORT_2026-04-05.md`

## Files Updated

1. `src/stores/SessionStore.js`
2. `src/components/Generate/PostProductionPanel.jsx`
3. `src/styles/GenerateV2.css`
4. `src/org/components/OrgDraftWorkflowModal.jsx`
5. `src/org/styles/OrgDraftWorkflowModal.css`
6. `src/org/services/orgDraftWorkflowService.js`

## Database Tables This Stage Works With

1. `public.posts`
2. `public.generations`
3. `public.connected_accounts`

## What Changed and How to Verify

### `FIX-ST4-001` SEO Scoring Edge Function (`seo-score`)

What changed:
- Added `seo-score` edge function to score SEO quality without rewriting content.
- Input supports post/content id + title/caption/hashtags/platform.
- Output returns:
  - `overall` score
  - `breakdown` (`title`, `caption`, `hashtags`)
  - `suggestions`
  - provider metadata

How to verify:
1. Open post-production SEO step.
2. Click `Run SEO Score`.
3. Confirm response includes score + bars + suggestions.

Pay attention to:
- Caption is required for scoring.
- Provider fallback may occur if Grok is unavailable.

### `FIX-ST4-002` Post-Production SEO Gate UX

What changed:
- Replaced old passive SEO step with active gate actions:
  - `Run SEO Score`
  - `Optimize with AI`
  - `Proceed`
- Added visual progress bars for title/caption/hashtags.
- Proceed is enabled only after scoring.

How to verify:
1. Generate content -> Post Production.
2. Move to SEO step.
3. Run score, then optimize, then proceed.
4. Confirm publish step is reachable only after scoring.

Pay attention to:
- Editing title/caption/hashtags resets SEO status to avoid stale scores.

### `FIX-ST4-003` SEO Store State + Persistence Contract

What changed:
- Added SEO state fields in `postProduction` store:
  - score/category/breakdown/suggestions/status/provider
- Added actions:
  - `scoreSeo()`
  - `optimizeSeo()`
- Added hydration of SEO state from `posts.seo_state`.
- Persisted results to:
  - `posts.seo_state`
  - `posts.workflow_state`

How to verify:
1. Score a draft.
2. Refresh and reopen the same generation.
3. Confirm score and suggestion state is restored.

Pay attention to:
- Legacy rows without `seo_state` start at `Not scored`.

### `FIX-ST4-004` Office Edit Modal SEO Integration

What changed:
- Added SEO card below metadata fields in edit slide-over modal.
- Added score + optimize + proceed actions in modal.
- Added bars/suggestions visualization in modal context.

How to verify:
1. Go to My Office -> Edit draft.
2. Run SEO score in modal.
3. Run optimize in modal.
4. Reopen modal and confirm persisted SEO state.

Pay attention to:
- Proceed in modal marks acceptance and prepares for next workflow stage handoff.

### `FIX-ST4-005` Org Draft SEO Service Extension

What changed:
- Added `scoreOrgDraftSeo(...)` in `orgDraftWorkflowService`.
- Preserves/updates `seo_state` + `workflow_state` for org drafts.
- Existing optimization path now re-scores after applying SEO suggestions to keep displayed bars current.

How to verify:
1. Edit org draft in My Office modal.
2. Optimize SEO.
3. Confirm score reflects post-optimization content (not pre-optimization stale values).

Pay attention to:
- Organization-specific RLS must permit updating the draft row being edited.

## Detailed SEO Scoring and Optimization Explanation (Real-Life Problem Focus)

### A) End-to-end runtime flow

1. Metadata completed (title/caption/hashtags ready).
2. User enters SEO step.
3. `Run SEO Score` calls `seo-score`.
4. UI displays:
  - overall score
  - title/caption/hashtags bar scores
  - actionable suggestions
5. User either:
  - optimizes with AI (`optimize-seo`)
  - proceeds with current content
6. On optimization:
  - optimized text is applied
  - content is rescored
  - updated score + suggestions are persisted

### B) Why this solves actual production pain

1. **Problem: Low discovery despite good creative**
- Typical cause: weak keyword anchoring in title/opening line.
- Detection: low title/caption component score.
- Fix: suggestions and optimization target keyword placement and clarity.

2. **Problem: High views, low engagement**
- Typical cause: weak CTA and low intent framing.
- Detection: lower caption score.
- Fix: optimization introduces stronger hook/CTA structure.

3. **Problem: Hashtag spam or low relevance**
- Typical cause: too many generic tags or poor platform fit.
- Detection: lower hashtag score.
- Fix: platform-fit hashtag suggestions and rewritten set quality.

4. **Problem: Team publishing quality inconsistency**
- Typical cause: variable editor skill and speed pressure.
- Detection: objective score variability across drafts.
- Fix: scoring gate standardizes quality checks before publish.

5. **Problem: Optimization changes voice too much**
- Typical cause: unconstrained rewrite prompts.
- Fix: optimization path keeps original content context + brand constraints and allows user override.

### C) Optimization strategy details

The implementation intentionally separates:

1. **Scoring** (`seo-score`)
- Diagnostic-only.
- No content mutation.
- Helps user understand issues first.

2. **Optimization** (`optimize-seo`)
- Controlled rewrite with platform context.
- Updates title/caption/hashtags.
- Immediately rescored to verify impact.

This avoids blind rewriting and makes improvement measurable.

### D) Data model and observability

We store score state in `posts.seo_state` for auditability:
- score, breakdown, suggestions, provider/model info, timestamps

We store lifecycle markers in `posts.workflow_state`:
- `seo_status`
- `seo_updated_at`
- `seo_optimized_at`

This gives both product UX continuity and reviewer/debug traceability.

## Potential Issues Introduced by Stage 4

1. SEO scoring adds an extra model call before publish; this can increase perceived latency if provider is slow.
2. If provider fallback is active, scoring behavior may differ slightly from Grok baseline.
3. Users can still proceed with low score by design; teams may later require policy-based score thresholds.
4. Frequent manual metadata edits can invalidate score often; this is expected and intentional to prevent stale quality signals.

## QA Focus Checklist

1. SEO score panel appears in Post Production step 2.
2. `Run SEO Score` returns overall + bars + suggestions.
3. `Optimize with AI` rewrites metadata and updates score.
4. `Proceed` works only after scoring.
5. Office edit modal shows same SEO score panel below metadata.
6. SEO state persists after reload/reopen.
7. Build remains green.

## Stage 4 Execution Outcome

Stage 4 is implementation-complete and documented, including the requested detailed real-life SEO scoring and optimization explanation.
