# Settings Feature Planning README

## Purpose
This document defines a practical settings roadmap for SocialAI so product and engineering can align on:

1. what settings are already live,
2. what settings are still missing,
3. how settings should be structured (personal vs organization),
4. how to implement safely in production phases.

---

## Current State (As Implemented)

### Personal workspace (`/app/settings`)
Currently available:

1. Connected Accounts
2. Organization Accounts (read-only visibility for org members)

Current limitation:

- Personal settings are mostly integration-focused and do not yet provide a full account/control center experience.

### Organization admin (`/app/org/:orgId/admin/settings`)
Currently available:

1. Basic org summary (name, plan, default pipeline)
2. Connected accounts admin surface
3. Task status manager

Current limitation:

- Org settings are functional but still narrow relative to full operations/policy needs.

---

## Settings Structure Proposal

## A) Personal Settings

### 1) Profile & Identity
- Full name
- Avatar
- Timezone
- Preferred locale/date format

### 2) Workspace Preferences
- Default landing page (Dashboard/Generate/Calendar/Library)
- UI density preference (compact/default/comfortable)
- Default context behavior (remember last org/workspace)

### 3) Notifications
- In-app notification categories (content updates, approvals, tasks, system)
- Email notification opt-in by category (future-ready)
- Quiet hours / digest frequency

### 4) Generation Defaults
- Default media type (image/video)
- Default aspect ratio
- Default caption style profile
- Default hashtags behavior (strict/creative/platform-aware)

### 5) Calendar Defaults
- Default calendar view (month/week/timeline)
- Week start day
- Scheduling timezone lock

### 6) Security
- Active sessions list
- Session revoke controls
- Password reset shortcut
- 2FA readiness toggle (future if auth supports)

### 7) Data & Privacy
- Export personal activity data (future)
- Delete account request flow (governed workflow)

---

## B) Organization Settings (Admin)

### 1) Organization Profile
- Organization name
- Slug/domain metadata
- Plan and billing references (read-only if owned elsewhere)

### 2) Team Governance Defaults
- Default role template for new invites
- Invite expiry defaults
- Workspace access policy for pending invites

### 3) Approval & Publishing Policy
- Default approval workflow selection
- Direct publish policy (role-based guardrails)
- Mandatory rejection comment settings

### 4) Connected Accounts Governance
- Organization-owned channels
- Access scope by role
- Account health fallback rules

### 5) Credits & Usage Controls
- Default monthly credit allocation by role template
- Alert thresholds (80/90/100%)
- Auto-escalation policy for exhausted credits

### 6) Asset Library Controls
- Upload/approval policy
- Required metadata policy
- Archival retention defaults

### 7) Common Room Controls
- Channel creation policy
- Message retention baseline
- AI usage policy for ideation/chat

### 8) AI Policy & Safety
- Default model/provider policy by workspace
- Content safety thresholds
- Prompt logging policy and retention

### 9) Audit & Compliance
- Exportable org audit summary
- Admin action log filters
- Alert routing preferences

---

## Data Model Plan

## Recommended canonical model

### Existing tables to keep using
1. `public.profiles`
2. `public.organizations`
3. `public.organization_members`
4. `public.connected_accounts`
5. `public.calendar_settings`
6. `public.pipeline_configs`
7. `public.user_notifications`

### Proposed additions
1. `public.user_settings`
   - `user_id` (PK/FK)
   - `default_workspace_route`
   - `timezone`
   - `notification_preferences` (jsonb)
   - `generation_defaults` (jsonb)
   - `calendar_defaults` (jsonb)
   - `privacy_preferences` (jsonb)
   - `updated_at`

2. `public.organization_settings_v2` (optional if moving away from `organizations.settings` blob)
   - `organization_id` (PK/FK)
   - `governance_policy` (jsonb)
   - `approval_policy` (jsonb)
   - `ai_policy` (jsonb)
   - `credit_policy` (jsonb)
   - `library_policy` (jsonb)
   - `notification_policy` (jsonb)
   - `updated_by`
   - `updated_at`

If new tables are deferred, use `organizations.settings` and `profiles` safely with explicit schema contracts in code.

---

## API / Edge Function Plan

## Personal settings APIs
1. `get-user-settings`
2. `upsert-user-settings`
3. `list-user-active-sessions` (optional if supported by auth provider)
4. `revoke-user-session` (optional)

## Organization settings APIs
1. `get-org-settings`
2. `update-org-settings`
3. `preview-org-policy-impact` (optional guardrail endpoint)

## Validation rules
1. Strict JSON schema validation at edge function boundary.
2. Role checks:
   - personal settings: authenticated owner only
   - org settings: `org_owner` / `org_admin` only
3. Audit writes for org-level changes.

---

## UI Information Architecture Plan

## Personal Settings Tabs
1. Profile
2. Preferences
3. Notifications
4. Generation Defaults
5. Calendar Defaults
6. Security
7. Connected Accounts

## Organization Settings Tabs
1. General
2. Team Policy
3. Approval & Publishing
4. Connected Accounts
5. Credits Policy
6. Library Policy
7. AI Policy
8. Audit

---

## Rollout Phases

### Phase 1 (Foundation)
1. Add user settings schema + read/write APIs.
2. Deliver personal tabs for Profile, Preferences, Notifications.
3. Keep current Connected Accounts intact.

### Phase 2 (Org Governance)
1. Expand org settings tabs for approval, credits, and policy controls.
2. Add org settings validation + audit logs.

### Phase 3 (Advanced Controls)
1. Security/session controls.
2. AI policy and retention controls.
3. Export/audit reporting tools.

---

## Acceptance Criteria (Team Signoff)

1. Personal settings persist per user and survive relogin.
2. Org settings are role-gated and auditable.
3. No cross-tenant leakage in settings reads/writes.
4. Settings changes propagate to workflow behavior (approval, defaults, notifications).
5. All settings surfaces have clear fallback states and validation errors.

---

## Risks To Watch

1. Overusing JSON blobs without typed contracts can create long-term drift.
2. Weak role checks in org settings can become a high-severity security bug.
3. Non-audited policy changes reduce governance trust.
4. Settings UX can become noisy if too many controls ship without progressive disclosure.

---

## Recommendation

Start with **typed personal settings + audited org policy updates**, then expand advanced controls only after behavior wiring is verified in staging.
