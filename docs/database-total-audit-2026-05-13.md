# Database Total Audit - 2026-05-13

## Scope

Reviewed the schema supplied in chat, Supabase migrations, app/client Supabase calls, Edge Functions, org workflows, admin workflows, mock publishing, and video-engine data paths.

Primary repair migration added:

- `supabase/migrations/20260513160000_database_integrity_security_cleanup.sql`

## Executive Summary

The biggest signup issue was a schema/code mismatch: the auth trigger inserts `profiles.role = 'user'`, while the supplied schema still showed a `profiles.role` check for the old tutoring roles only. That can let `auth.users` signup succeed while the `profiles` row silently fails because the trigger catches the exception.

The new migration fixes that profile role domain, reinforces `profiles.id -> auth.users.id`, backfills missing profile/settings/credit rows where possible, hardens profile self-updates so users cannot edit protected role/credit/status fields, redacts token fields from connected-account health views, and adds missing upsert uniqueness when the live data is clean.

Some cleanup remains intentionally non-destructive: duplicate rows, dormant legacy tables, and real OAuth token storage need deliberate migration decisions instead of automatic deletion.

## Fixed In This Pass

| Area | Problem | Fix |
| --- | --- | --- |
| Signup profile provisioning | `handle_new_user_profile()` writes role `user`, but supplied `profiles.role` check excluded `user`. | Replaced profile role check with social-app-compatible values and default `user`. |
| Missing profile rows | Auth users can exist without profiles after the trigger failure. | Backfilled `profiles` from `auth.users`. |
| Profile relationship | Supplied schema did not show `profiles.id -> auth.users.id`. | Added/validated `profiles_id_fkey` when no orphan profiles exist. |
| Settings/credits provisioning | New auth users were not guaranteed to receive `user_settings` and `user_credits`. | Profile trigger now inserts those rows if the tables exist. |
| User privilege escalation | Existing `Users update own profile` policy allowed users to update all profile columns. | Added `profile_self_update_guard()` so self-updates cannot change email, role, `is_admin`, credits, org, status, or suspension/deletion fields. |
| Unsafe profile insert | A user with no profile could insert privileged profile values. | Insert policy now only allows basic self-profile defaults. |
| View token exposure | `connected_accounts_health_summary` exposed `mock_token`. | Recreated the view without token fields. |
| View tenant isolation | Account health summary views were definer-style aggregate views. | Recreated account health views with `security_invoker = true`. |
| Direct token reads | Client code and table grants could expose token columns from `connected_accounts`. | App selects now request safe columns only; migration revokes table-wide `SELECT` for `PUBLIC`/`anon`/`authenticated` and grants only non-token columns to authenticated users. |
| Upsert conflict keys | Several code paths use composite `onConflict` keys that may not exist in older DBs. | Migration creates unique indexes only when no duplicate groups exist. |
| Mock publish idempotency | Prior migration added a normal index, not a unique key, for publish request dedupe. | Added conditional unique index on `(publish_request_id, post_id, connected_account_id)`. |
| Local Supabase project mismatch | `.env.local` pointed at a different Supabase project than `.env`, causing schema-cache errors for missing social-media tables. | Synced `.env.local` Supabase URL/key variables to the schema-compatible project from `.env`. |

## Broken Or Missing Items Identified

| Severity | Item | Evidence | Current Status |
| --- | --- | --- | --- |
| Critical | `profiles.role` domain blocked standard signup profile rows. | `AuthContext` and invite functions upsert `role: "user"`; supplied schema allowed only `parent/admin/advisor/tutor`. | Fixed in migration. |
| High | Self-profile RLS allowed protected field edits. | `Users update own profile` policy only checked `auth.uid() = id`. | Fixed in migration. |
| High | Direct table reads could expose `connected_accounts.access_token`, `refresh_token`, and `mock_token`. | Client code used broad selects and the base table contains token columns. | Browser read exposure fixed by safe selects plus column-level grants. Full real-OAuth server-side token storage still remains. |
| High | Composite upsert keys may be missing in DBs where tables predated migrations. | Code uses `onConflict` for `organization_members`, `org_role_templates`, `org_task_statuses`, etc. | Migration adds unique keys when clean; duplicate rows require manual resolution. |
| Medium | `trending_topics` upsert has no conflict key. | `OptimalTimesService` and `daily-analysis` call `upsert(records)` without `onConflict`. | Not changed; add canonical uniqueness or switch to append-only history. |
| Medium | `platform_analytics` is read but ingestion is incomplete. | Optimal-time services read it, but no robust platform analytics writer exists. | Needs real provider sync or derived metrics contract. |
| Medium | Array relationship fields are not FK-enforced. | `member_ids`, `brand_project_ids`, `granted_member_ids`, and tags arrays store ids/values without relational constraints. | Acceptable for MVP, but cleanup should normalize where permissions/security depend on them. |
| Medium | Several tables are legacy/dormant but still present. | Existing deprecation docs and code scan identify old generation/scheduling/admin tables. | Keep read-only/deprecated until removal migration. |
| Runtime Config | Local dev was using a Supabase project with an incompatible schema. | Browser logs showed old/tutoring schema hints and missing social-media tables. | Fixed locally by syncing `.env.local` to the project where the app schema exists. |

## Correct Active Model

| Domain | Tables | What They Do |
| --- | --- | --- |
| Identity | `auth.users`, `profiles`, `user_settings`, `context_last_used` | Auth identity, app profile, personal preferences, and last selected workspace. |
| Personal creation | `sessions`, `content_plans`, `generations`, `posts` | Main content generation lifecycle from prompt/session to generated asset to schedulable/publishable post. |
| Personal brand | `brand_kit`, `brand_assets` | Per-user brand voice, visual rules, and uploaded brand references. |
| Calendar/library | `calendar_settings`, `content_pillars`, `ghost_slots`, `optimal_posting_times`, `media_assets`, `content_templates`, `content_library_items` | Personal planning, topic pillars, suggested slots, upload/template library, and posting-time recommendations. |
| Connected accounts | `platform_registry`, `connected_accounts`, `connection_events`, `mock_publish_logs`, `account_severity_alerts`, `admin_account_actions` | Platform catalog, mock/live account records, connection telemetry, mock publish attempts, health alerts, and admin maintenance actions. |
| Organizations | `organizations`, `organization_plans`, `organization_members`, `brand_projects`, `org_role_templates`, `org_invitations` | Org ownership, plans, membership/RBAC, brand projects, role templates, and invite onboarding. |
| Org workflow | `pipeline_configs`, `pipeline_items`, `org_tasks`, `org_task_statuses` | Review pipeline setup, submitted content, operational tasks, and task status board. |
| Org assets/brand | `org_asset_library`, `org_asset_folders`, `org_post_asset_links`, `org_brand_kits`, `org_brand_kit_editors` | Team asset vault, folders, post-to-asset references, org brand kits, and delegated editors. |
| Collaboration | `common_room_channels`, `common_room_messages`, `common_room_channel_reads`, `ai_session_logs` | Org chat/common-room channels, messages, read state, and AI chat session accounting. |
| Org credits | `credit_events`, `credit_requests` | Organization credit usage ledger and member credit request workflow. |
| Admin/moderation | `admin_roles`, `audit_logs`, `complaints`, `complaint_comments`, `complaint_status_history`, `admin_action_requests`, `admin_notifications`, `user_notifications`, `admin_notes`, `user_status_events`, `content_quality_reviews`, `content_versions`, `risk_event_counts` | Platform/admin RBAC, audit trail, complaint workflow, notifications, notes, user status events, quality review, content versioning, and risk counters. |
| Video engine | `video_jobs`, `video_clips`, `video_transcripts`, `user_credits`, `credit_transactions` | Video processing jobs, generated clips/transcripts, personal video credit balance, and credit ledger. |

## Mock Data And Mock Tables

| Table/Code | Current Mock Role | How It Works Now | Real Data Target |
| --- | --- | --- | --- |
| `platform_registry` | Mock platform connection copy and supported platform metadata. | Seeds 8 platform records with mock login headlines/descriptions. | Keep as real platform capability registry; remove mock-only copy or flag it. |
| `connected_accounts.is_mock`, `mock_token`, `platform_metadata.mock` | Stores mock OAuth accounts. | Client mock provider creates fake token/account metadata and writes to `connected_accounts`. | Real OAuth should be handled server-side; store encrypted tokens in Vault or provider-token table not readable by clients. |
| `connection_events.is_simulated_failure` | Marks simulated connection/publish failures. | Mock flows and failure detector write account events. | Keep table; simulated flag should be false for real provider events. |
| `mock_publish_logs` | Canonical mock publish attempt ledger. | `mock-publish` Edge Function writes pending/success/failure attempts and fake post URLs. | Replace or supplement with `publish_attempts`/provider publish logs carrying real API response ids. |
| `account_severity_alerts` | Health alerts from repeated mock/real failures. | Trigger creates alerts after consecutive failures. | Keep; source should become real provider failures and token-expiry checks. |
| `admin_account_actions` | Admin account maintenance including mock reconnect. | Admin functions can force mock reconnect/disconnect and log action. | Keep action log; real reconnect should initiate OAuth re-consent. |
| `trending_topics` | AI/mock trend suggestions. | Daily analysis may seed mock trends or Groq-derived trends. | Add source/provenance and uniqueness/history decision. |
| `optimal_posting_times` | Derived recommendations from limited/mock analytics. | Upserted from AI/fallback analysis. | Feed from real `platform_analytics` ingestion. |
| `src/services/platforms/mockOAuthProvider.js` | Mock OAuth provider. | Generates fake usernames, profile images, tokens, follower counts. | Replace with provider OAuth callbacks and token refresh handlers. |
| `src/services/platforms/mockPublishWorkflow.js` and `mockPublishService.js` | Mock publishing UX. | Calls Edge Function and surfaces simulated result modal. | Keep as demo mode behind a feature flag; route live accounts to real provider publish functions. |
| Admin mock utilities | Mock admin analytics/posts/users in legacy components. | Some admin components still include in-memory mock datasets. | Remove after all admin pages read canonical Supabase/Edge data. |
| Video engine mock modes | Paid services are mock-first. | Worker can mock Replicate/Anthropic/Stripe paths. | Keep explicit flags; only disable per environment after real provider keys and cost controls are ready. |

## Redundant Or Cleanup Candidates

| Redundant Surface | Canonical Surface | Cleanup Recommendation |
| --- | --- | --- |
| `generated_content`, `generation_assets`, `generation_metadata`, `generation_sessions` | `sessions`, `content_plans`, `generations`, `posts`, `media_assets` | Mark legacy read-only, migrate any needed rows, then drop. |
| `scheduled_generations` | `posts.scheduled_at` and `posts.status` | Deprecate; scheduling belongs on `posts`. |
| `platforms` | `platform_registry` plus text platform keys | Migrate any old references, then drop. |
| `admin_logs` | `audit_logs` | Keep `audit_logs` canonical. |
| `admin_keys` | `admin_roles` / secure admin provisioning flow | Remove unless one-time bootstrap keys are still used. |
| `analytics_summary` | `platform_analytics`, derived dashboard queries | Replace with materialized views only if needed. |
| `moderation_queue` | `posts.moderation_status`, `content_quality_reviews`, `admin_action_requests` | Deprecate old queue. |
| `profiles.credits`, `user_credits`, `credit_events` | Separate personal video credits and org credits explicitly | Stop using `profiles.credits` as a source of truth. |
| `profiles.role`, `profiles.is_admin`, `admin_roles` | `admin_roles` for admin authority; `profiles.role = user` for normal profiles | Treat profile admin fields as compatibility only. |
| `organizations.owner_user_id`, `organizations.owner_id` | Pick one owner column | Use one canonical owner column, backfill, then deprecate the other. |
| `connected_accounts.avatar_url/profile_picture_url`, `account_name/display_name`, `last_token_refresh/last_token_refresh_at` | One canonical display/avatar/refresh field set | Keep compatibility for now; normalize in one cleanup migration. |
| `admin_notifications.is_read/read`, `notification_type/type`, `recipient_admin_id/admin_id` | Canonical notification columns | Existing sync migrations help; next step is deprecating duplicates. |
| Tutoring tables/fields (`children`, `tutors`, tutoring fields on `sessions`, etc.) | Social media product tables | Move to a separate schema or remove after confirming no active product dependency. |

## Duplicate Detection Queries

Run these in Supabase SQL before/after applying the repair migration. Any rows returned explain why a unique index was skipped.

```sql
select 'organization_members' as table_name, organization_id::text || ':' || user_id::text as duplicate_key, count(*)
from public.organization_members
group by organization_id, user_id
having count(*) > 1
union all
select 'brand_projects', organization_id::text || ':' || slug, count(*)
from public.brand_projects
group by organization_id, slug
having count(*) > 1
union all
select 'org_role_templates', organization_id::text || ':' || role_key, count(*)
from public.org_role_templates
group by organization_id, role_key
having count(*) > 1
union all
select 'org_task_statuses', organization_id::text || ':' || key, count(*)
from public.org_task_statuses
group by organization_id, key
having count(*) > 1
union all
select 'common_room_channel_reads', channel_id::text || ':' || user_id::text, count(*)
from public.common_room_channel_reads
group by channel_id, user_id
having count(*) > 1
union all
select 'org_post_asset_links', post_id::text || ':' || asset_id::text, count(*)
from public.org_post_asset_links
group by post_id, asset_id
having count(*) > 1
union all
select 'optimal_posting_times', user_id::text || ':' || platform || ':' || day_of_week || ':' || hour_of_day, count(*)
from public.optimal_posting_times
group by user_id, platform, day_of_week, hour_of_day
having count(*) > 1;
```

## Orphan Checks

```sql
select 'profiles_without_auth_user' as issue, count(*)
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null;

select 'auth_users_without_profiles' as issue, count(*)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

select 'posts_without_accounts' as issue, count(*)
from public.posts p
left join public.connected_accounts ca on ca.id = p.account_id
where p.account_id is not null and ca.id is null;
```

## Security Notes

- Profile privilege escalation is now blocked at RLS policy level.
- Account health views now run with caller RLS and no mock token column.
- Authenticated browser clients no longer receive `connected_accounts` token columns through normal table grants.
- Real OAuth is still not production-secure while provider tokens live in `connected_accounts` and client code can insert/update mock token fields directly.
- Before enabling real OAuth, move provider tokens to server-only storage, expose redacted account views/RPCs to clients, and route refresh/publish through Edge Functions only.
- Keep invite tokens and client review tokens short-lived; the current client review link generator uses a 72-hour expiry.

## Recommended Cleanup Order

1. Apply `20260513160000_database_integrity_security_cleanup.sql`.
2. Run duplicate/orphan checks above and clean any returned duplicate groups.
3. Move real provider tokens out of `connected_accounts` before enabling live OAuth.
4. Add explicit `onConflict` and a uniqueness decision for `trending_topics`.
5. Deprecate old generation/scheduling/admin tables behind a formal migration.
6. Normalize duplicate columns after the app has stopped reading compatibility names.
7. Add a CI schema audit that checks code `onConflict` keys against DB unique indexes.
