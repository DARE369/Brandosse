# Admin Dashboard Database Relationship Audit

Date: 2026-03-23

Audit basis:
- Repo migrations
- Active admin frontend code
- Active admin edge functions

This is a relationship audit, not a schema diff against an external production dump.

## Source-of-Truth Matrix

| Concern | Current schema sources | Current code actually reads | Risk | Recommended direction |
| --- | --- | --- | --- | --- |
| Admin role | `auth.users.*metadata`, `profiles.role`, `admin_roles.role` | `src/services/authService.js`, `src/admin/utils/adminClient.js` | High | Make `admin_roles.role` canonical for admin access |
| Admin org scope | `profiles.organization_id`, `admin_roles.organization_id`, `organization_members.organization_id` | Mostly `profiles.organization_id`, sometimes `admin_roles.organization_id` | High | Separate "membership" from "current admin scope" |
| User org membership | `organization_members`, `profiles.organization_id` | Active admin UI uses `profiles.organization_id`; does not query `organization_members` | High | Pick one canonical membership model |
| Moderation lineage | `generations -> posts -> content_quality_reviews -> content_versions` | `AdminModerationWorkspace`, `admin-list-posts`, `adminClient` | Medium | Preserve immutable history for published rows |
| Complaint linkage | `organization_id`, `submitted_by_user_id`, `created_by_admin_id`, `assigned_admin_id`, `linked_post_id`, `linked_generation_id` | UI mostly uses `organization_id` and `submitted_by_user_id` | Medium | Use linked content fields in detail and user views |
| Notes and notifications | `admin_notes`, `user_notifications`, `admin_notifications` | Notes active, user notifications active, admin notifications mostly read-only | High | Remove duplicate policies and document producer paths |
| Audit logging | `audit_logs` plus `write_audit_log()` and triggers | Active frontend and functions both write logs | Medium | Keep one documented event contract and enforce it consistently |

## Relationship Findings

### 1. Organization membership is modeled three different ways

Schema evidence:
- `organization_members` is introduced in `supabase/migrations/20260312153000_admin_foundation.sql`
- `profiles.organization_id` is also used as a direct org pointer
- `admin_roles.organization_id` stores scoped admin org context
- `20260321113000_admin_moderation_schema_alignment.sql` backfills `profiles.organization_id` from both `organization_members` and `admin_roles`

Code evidence:
- Active admin pages use `profiles.organization_id`
- `AdminOrgDetailPage.jsx` reads org members from `profiles`
- No active admin page or function reads `organization_members`

Why this matters:
- `organization_members` can represent membership records with role and status.
- `profiles.organization_id` can only represent one flattened org assignment.
- The current UI treats the flattened profile field as the live truth.

Practical result:
- Membership role/status in `organization_members` is ignored by the admin UI.
- Historical or multi-org membership becomes invisible.
- Backfills mask inconsistency instead of removing it.

### 2. Admin role resolution is also duplicated across three layers

Schema and code evidence:
- `src/services/authService.js`
- `src/admin/utils/adminClient.js`
- `src/utils/authRouting.js`

Current behavior:
- Redirect and route logic can accept admin state from auth metadata.
- Profile role is also treated as a fallback.
- `admin_roles.role` is treated as a stronger source when available.

Why this matters:
- Admin access and post-auth routing should be deterministic.
- Fallback-based role resolution is useful during migration but weak as a permanent model.

Recommended end state:
- Use `admin_roles.role` as the only admin authority.
- Keep metadata only as a convenience mirror if needed.
- Keep `profiles.role` user-facing or compatibility-only.

### 3. Moderation content lineage is mostly coherent, but post reuse rules are too loose

Healthy parts:
- `posts.generation_id` is used consistently
- `content_quality_reviews` can point to both `generation_id` and `post_id`
- `posts.quality_review_id` exists as a convenience link
- `content_versions` exists for revision history

Weak part:
- `forceModerationAction()` can reuse an existing post based on account match before confirming the reusable row is still a draft

Why this matters:
- Published rows should usually be immutable history
- If a published row is overwritten in place, analytics, library, and audit interpretation get weaker

Recommended end state:
- Reuse draft rows only
- Create a new post or version row for terminal states

### 4. Complaint relationships are richer than the current UI uses

Schema supports:
- org linkage
- submitting user linkage
- admin creator linkage
- assigned admin linkage
- linked post linkage
- linked generation linkage

Current UI use:
- complaints list is mostly org/status/priority driven
- user detail tab only loads complaints where `submitted_by_user_id = userId`

Result:
- Complaints linked to a user's post or generation but not submitted by that user are not surfaced in that user's detail page
- complaint assignment is underused in the UI

Recommended end state:
- Treat complaint linkage as a multi-axis relationship, not just submitter ownership

### 5. The notes and notification tables have relationship-level permission drift

Observed pattern:
- Older migrations create broad admin policies
- Newer migrations create scoped policies
- The older policy names are not removed by the later migration

Why this matters:
- This is not only a permission problem
- It also means the relationship between "admin" and "target user" is inconsistently enforced across tables

Recommended end state:
- Drop superseded policy names explicitly
- Keep the target-user scope rule identical across `admin_notes`, `user_notifications`, and any future admin-to-user communication tables

### 6. `admin_notifications` is structurally present but operationally incomplete

What exists:
- table
- RLS
- navbar reader
- mark-as-read flow

What is missing in repo:
- a clear insert path
- a documented producer

Why this matters:
- The admin bell implies a relationship between system events and admin recipients
- That relationship is not implemented end to end in the repo

## Recommended Canonical Ownership

| Concern | Canonical owner |
| --- | --- |
| Admin role | `admin_roles.role` |
| Admin org scope | `admin_roles.organization_id` |
| User org membership | `organization_members` |
| Current display org on profile | derived from membership or cached mirror, but not independent truth |
| Post lifecycle state | `posts.status` |
| Draft creation artifact | `generations` |
| Latest quality review pointer | `posts.quality_review_id` for post views, `content_quality_reviews` for history |
| Complaint targeting | `complaints` plus linked user/post/generation fields, not submitter alone |

## Practical Cleanup Order

1. Decide whether `organization_members` or `profiles.organization_id` is the real membership model.
2. Decide whether `admin_roles` or auth metadata is the real admin authority.
3. Add a cleanup migration for superseded RLS policies.
4. Make every org-scoped admin query derive from the same canonical scope.
5. Tighten moderation so terminal post rows are not overwritten in place.

## What To Diff Against the User's SQL Schema Next

When the canonical SQL dump is provided, verify:

- all actual policy names on `user_notifications` and `admin_notes`
- whether live tables still contain both broad and scoped policies
- whether `organization_members` is intended to be many-to-many or only a provisioning artifact
- whether `profiles.organization_id` is meant to stay as a cached pointer
- whether `admin_roles.organization_id` is mandatory for `org_admin`
