# Schema Usage + Consistency Audit

Date: 2026-02-27  
Source reviewed:
- Full schema you pasted
- Frontend runtime code (`src/**`)
- Edge functions (`supabase/functions/**`)
- Current migrations (`supabase/migrations/**`)

## 1) Tables Actively Used by Current Product Code

These are directly queried from runtime app and/or edge functions:

- `profiles`
- `user_settings`
- `sessions`
- `generations`
- `posts`
- `connected_accounts`
- `content_plans`
- `brand_kit`
- `brand_assets`
- `calendar_settings`
- `ghost_slots`
- `content_pillars`
- `optimal_posting_times`
- `trending_topics`
- `media_assets`
- `content_library_items`
- `content_templates`

Also used indirectly through nested relation selects:

- `platform_analytics` (read from `posts` relation in:
  - `src/services/OptimalTimesService.js`
  - `supabase/functions/daily-analysis/index.ts`)

## 2) Tables Not Used by Current Product Code (Legacy/Redundant)

No direct runtime reads/writes found for:

- `admin_keys`
- `admin_logs`
- `analytics_summary`
- `generated_content`
- `generation_assets`
- `generation_metadata`
- `generation_sessions`
- `moderation_queue`
- `platforms`
- `scheduled_generations`

These appear to be older/parallel models and can be candidates for deprecation after confirming no external consumers.

## 3) Redundancies: Two Models for One Functionality

### 3.1 Content generation/result storage overlap
- `generations` (active canonical)
- `generated_content` (legacy)
- `generation_assets` (legacy)
- `generation_metadata` (legacy)

Status: Redundant modeling for generated outputs.

### 3.2 Session tracking overlap
- `sessions` (active canonical)
- `generation_sessions` (legacy)

Status: Duplicate session concepts.

### 3.3 Scheduling overlap
- `posts` (active canonical scheduling lifecycle)
- `scheduled_generations` (legacy parallel schedule table)

Status: Duplicate scheduling data path.

### 3.4 Platform modeling overlap
- `connected_accounts.platform` + `posts.platform` (active denormalized usage)
- `platforms` table (legacy registry, not used)

Status: Registry table not wired; platform is string-based in active flows.

### 3.5 Media persistence overlap
- `generations.storage_path` (active for generated outputs)
- `media_assets` (active for library uploads/asset catalog)

Status: Both hold media references; currently mixed responsibilities.

## 4) Storage Bucket Usage Audit

Buckets used in code:

- `generated_assets`
  - Generation/edit/video flows
  - Also used for library uploads in `LibraryStore`
- `brand_assets`
  - Brand Kit assets only

Observation:
- `generated_assets` currently serves both AI-generated assets and manual library uploads.
- This is functional, but merges two concerns (generated outputs + user upload vault).

## 5) Relationship/Constraint Consistency Findings

### 5.1 Confirmed-consistent core relationships
- `posts.user_id -> auth.users.id`
- `posts.generation_id -> generations.id`
- `posts.account_id -> connected_accounts.id`
- `posts.content_pillar_id -> content_pillars.id`
- `generations.session_id -> sessions.id`
- `content_plans.session_id -> sessions.id`
- `ghost_slots.user_id -> auth.users.id`
- `ghost_slots.content_pillar_id -> content_pillars.id`
- `media_assets.user_id -> auth.users.id`
- `content_templates.user_id -> auth.users.id`
- `content_library_items.user_id -> auth.users.id`

### 5.2 Inconsistencies identified

1. `profiles.id` had no FK to `auth.users.id` in pasted schema.
- Risk: orphan profiles.
- Fix added in migration as `profiles_id_fkey` (`NOT VALID` initially).

2. `content_library_items` FKs in pasted schema did not specify cascade delete.
- Risk: deleting a post/media/template can fail due dependent library row.
- Fix added in migration:
  - `content_library_items_post_id_fkey` -> `ON DELETE CASCADE`
  - `content_library_items_media_asset_id_fkey` -> `ON DELETE CASCADE`
  - `content_library_items_template_id_fkey` -> `ON DELETE CASCADE`

3. `platform_analytics.post_id` default FK behavior can block post deletion.
- Risk: post delete fails once analytics rows exist.
- Fix added in migration:
  - `platform_analytics_post_id_fkey` -> `ON DELETE SET NULL`

4. Status domain mismatch:
- DB `posts.status` allows `'archived'`.
- App constants/UI lifecycle currently use: `draft|scheduled|publishing|published|failed`.
- Risk: unexpected status handling gaps in UI/filters/business logic.

5. `platform_analytics` is read but no write pipeline in active app flow.
- Risk: optimal-time analytics logic has little/no real data.

6. `OptimalTimesService` and daily-analysis filter by `p.connected_accounts?.platform` but do not select `connected_accounts` relation.
- Effect: filtering depends mostly on `posts.platform` fallback.

## 6) What Was Updated to Improve Consistency

Migration updated:
- [20260227090000_calendar_library_alignment.sql](C:\Users\Dare\Desktop\social-media-agent - Copy\supabase\migrations\20260227090000_calendar_library_alignment.sql)

Added/normalized:
- `content_library_items` FK delete behavior
- `profiles` FK to `auth.users`
- `platform_analytics.post_id` delete behavior
- Existing lifecycle + library sync trigger protections remain

## 7) Recommended Canonical Data Model (Going Forward)

Keep as canonical:
- Identity/profile: `auth.users`, `profiles`, `user_settings`
- Creation: `sessions`, `generations`, `content_plans`
- Publishing lifecycle: `posts`, `connected_accounts`
- Planning: `calendar_settings`, `ghost_slots`, `optimal_posting_times`, `trending_topics`
- Library: `media_assets`, `content_library_items`, `content_templates`
- Brand: `brand_kit`, `brand_assets`
- Analytics detail: `platform_analytics` (once ingestion is implemented)

Mark for deprecation after validation:
- `generated_content`
- `generation_assets`
- `generation_metadata`
- `generation_sessions`
- `scheduled_generations`
- `platforms`
- `analytics_summary`
- `admin_keys`, `admin_logs`, `moderation_queue` (unless admin roadmap revives them)

## 8) Practical Next Steps

1. Apply migration:
- `supabase/migrations/20260227090000_calendar_library_alignment.sql`

2. Backfill/clean orphan data before validating `profiles_id_fkey`:
- Remove or repair `profiles` rows without matching `auth.users`.

3. Add `platform_analytics` writer pipeline (worker/webhook sync) so analytics reads are meaningful.

4. Decide on media canonicalization:
- Either keep split (`generations` for generated, `media_assets` for uploads)
- Or unify by creating `media_assets` rows for generated outputs too.

5. Plan formal deprecation migration for unused legacy tables once confirmed safe.
