# Stage 4 - SEO Scoring Integration

## Summary
Stage 4 implemented the SEO scoring gate between metadata generation and publishing:

1. New `seo-score` edge function for platform-aware SEO scoring.
2. Post-production SEO gate UI with score bars, suggestions, optimize, and proceed.
3. Office edit modal SEO section below metadata fields with the same score + optimize loop.
4. Persistent SEO state writes to `posts.seo_state` + workflow lifecycle writes to `posts.workflow_state`.

## Edge Function

- Path: `supabase/functions/seo-score/index.ts`
- Input:
  - `content_id` (or `post_id`)
  - `title`
  - `caption`
  - `hashtags`
  - `platform`
- Output:
  - `overall` (0-100)
  - `breakdown.title` / `breakdown.caption` / `breakdown.hashtags` (0-100)
  - `suggestions[]`
  - `provider`, `model`, `provider_warning`

## UI Integration

### Post Production (`Generate`)
- File: `src/components/Generate/PostProductionPanel.jsx`
- SEO step now includes:
  - `Run SEO Score`
  - `Optimize with AI`
  - `Proceed` (enabled after scoring)
  - 3 progress bars (Title/Caption/Hashtags)
  - Suggestions list

### Office Draft Edit Modal
- File: `src/org/components/OrgDraftWorkflowModal.jsx`
- Added SEO card under metadata fields:
  - score actions (`Run SEO Score`, `Optimize with AI`, `Proceed`)
  - per-dimension bars
  - suggestion list
  - persisted SEO state

## State Management

### Session Store SEO fields
- File: `src/stores/SessionStore.js`
- Added to `postProduction`:
  - `seoScore`
  - `seoCategory`
  - `seoBreakdown`
  - `seoSuggestions`
  - `seoStatus`
  - `seoProvider`

### New store actions
- `scoreSeo()`
- `optimizeSeo()`

## Database Tables Used

1. `public.posts`
2. `public.generations`
3. `public.connected_accounts`

## Data Persistence Contract

### `posts.seo_state`
Stored keys:
- `seo_score`
- `score_category`
- `score_breakdown`
- `suggestions`
- `provider`
- `model`
- `provider_warning`
- `updated_at`

### `posts.workflow_state`
Stored lifecycle keys:
- `seo_status`
- `seo_updated_at`
- `seo_optimized_at`

## Verification Steps

1. Generate content and open Post Production.
2. Go to SEO step and click `Run SEO Score`.
- Expected: overall score + three bars + suggestions appear.
3. Click `Optimize with AI`.
- Expected: title/caption/hashtags update and score refreshes.
4. Click `Proceed`.
- Expected: Publish step unlocks.
5. Open My Office > Edit draft.
6. Use SEO card to score and optimize.
- Expected: score state persists after close/reopen.

## Detailed SEO Scoring + Real-Life Optimization Explanation

### 1) How scoring works in practice
The scorer evaluates three conversion-critical units:
- Title: search discoverability + clarity.
- Caption: hook + keyword context + action cue.
- Hashtags: relevance + distribution quality + platform-fit count.

Each unit gets a 0-100 score, then a weighted overall score is computed and normalized to 0-100. This ensures users see both:
- macro quality (`overall`)
- micro diagnostics (`title/caption/hashtags`)

### 2) Why this solves real-world posting problems

Common production problems and the Stage 4 fix:

1. Low impressions from weak discoverability.
- Cause: missing keywords in title/caption lead-in.
- Fix: score penalizes weak keyword relevance and suggestions recommend specific placement.

2. Low CTR from weak hooks.
- Cause: caption opens with generic filler.
- Fix: caption score penalizes weak first-line framing; optimization rewrites first line for stronger hooks.

3. Poor hashtag reach.
- Cause: too many broad tags or irrelevant tags.
- Fix: hashtag score penalizes low relevance/poor count; optimizer rebalances tags toward platform norms.

4. Platform mismatch.
- Cause: content style not adapted for platform expectations.
- Fix: scorer is platform-aware; optimization prompt includes platform constraints.

5. Team inconsistency during fast publishing.
- Cause: manual edits vary by contributor skill.
- Fix: scoring gives objective QA before publish and standardizes acceptance criteria.

### 3) Optimization loop design

The optimization loop is intentionally two-phase:

1. Score phase (`seo-score`)
- Finds weaknesses and gives constrained recommendations.

2. Rewrite phase (`optimize-seo`)
- Rewrites title/caption/hashtags to improve score while preserving voice.
- Immediately re-scored to verify impact and prevent blind rewrites.

This prevents "optimization by guesswork" and gives measurable before/after quality.

### 4) Quality guardrails

- User override preserved: users can proceed after scoring without forced optimization.
- Provider fallback warning surfaced (`provider_warning`) for observability.
- SEO state persisted to DB so pipeline reviewers can audit what was scored/optimized.
