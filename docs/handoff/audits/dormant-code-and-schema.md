# Dormant Code and Schema Audit

## Purpose
Identify code and SQL objects that are dormant, legacy, or weakly connected to the routed product so cleanup can happen without breaking live workflows.

## Method
- Read active migration comments and contracts in `supabase/migrations/**`.
- Scan runtime references in `src/**` and `supabase/functions/**`.
- Validate candidate dormancy with line-level evidence.

## Confirmed Legacy SQL Objects (High Confidence)
The migration `supabase/migrations/20260323103000_risk_cron_and_legacy_table_deprecation.sql` explicitly marks these tables as legacy/dormant:
- `admin_keys` (line 79)
- `admin_logs` (line 82)
- `analytics_summary` (line 85)
- `generated_content` (line 88)
- `generation_assets` (line 91)
- `generation_metadata` (line 94)
- `generation_sessions` (line 97)
- `moderation_queue` (line 100)
- `platforms` (line 103)
- `scheduled_generations` (line 106)

These are first-class deprecation signals and should not be used for new work.

## Dormant Runtime Code Candidates

### Candidate 1: Deprecated Generate state modules (High Confidence)
- `src/pages/GeneratePage/state/useGenerationService.js:2` has `@deprecated` marker.
- `src/pages/GeneratePage/state/generationMachine.js:2` has `@deprecated` marker.
- Cross-reference scan showed no importing callsites beyond self definitions.

Recommendation:
- Move both files to a `legacy/` area or remove after one release cycle with fallback verification.

### Candidate 2: `content_versions` table appears provisioned but unused (High Confidence)
- `content_versions` is created/indexed/policy-managed in migrations.
- Scan of `src/**` and `supabase/functions/**` found no runtime references.
- Reference hits appear migration-only (`20260312153000_admin_foundation.sql`, `20260321113000_admin_moderation_schema_alignment.sql`).

Recommendation:
- Confirm if this is intentionally future-facing.
- If not active, deprecate explicitly in migration comments (same pattern used for legacy tables).

### Candidate 3: Edge functions present but not frontend-invoked (Medium Confidence)
Detected function folders not directly invoked via `supabase.functions.invoke(...)` from `src/**`, including:
- `admin-account-action`
- `admin-list-posts`
- `admin-notify-user`
- `admin-seed-connected-account`
- `ai-brand-consistency-check`
- `ai-generate-brief`
- `credit-monthly-reset`
- `detect-account-failures`
- `healthCheck`
- `notify-admin-event`
- `org-asset-upload`
- `org-self-signup`
- `org-setup`
- `process-risk-alerts`
- `videoStatus`
- `webhook-handler`

Interpretation:
- Some are expected backend/cron/system integrations, not dormant.
- Others may be partially wired and need lifecycle ownership and invocation source documentation.

Recommendation:
- Add a function registry doc with owner, invocation source, auth mode, and SLA.

## Parallel/Duplicate Model Surfaces

### Generation and scheduling lineage
- Legacy lineage: `generated_content`, `generation_sessions`, `generation_assets`, `generation_metadata`, `scheduled_generations`, `platforms`.
- Active lineage: `sessions`, `generations`, `posts`, `platform_registry`, org pipeline tables.

### Moderation lineage
- Legacy marker: `moderation_queue` comment indicates dormant.
- Active lineage: `posts.moderation_status`, `admin_action_requests`, `content_quality_reviews`, `audit_logs`.

### Admin logs lineage
- Legacy marker: `admin_logs` comment points to `audit_logs` as canonical.

## Risk if Cleanup Is Delayed
- Engineers may write to dormant schema and fork business logic.
- Conflicting truth sources increase migration and incident response complexity.
- New developers cannot distinguish canonical paths from historical leftovers.

## Recommended Cleanup Sequence
1. Publish canonical model map (active vs legacy) in this handoff set.
2. Add explicit deprecation comments for any additional unused candidates (`content_versions` if confirmed).
3. Enforce lint or CI guard to block new runtime writes to legacy tables.
4. Move deprecated frontend modules under `src/legacy/` before eventual deletion.
5. Add periodic runtime reference audit script to prevent regression.

