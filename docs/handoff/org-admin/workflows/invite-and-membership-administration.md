# Workflow: Invite and Membership Administration

## Current Implemented Flow
1. Admin opens `/admin/members` and launches `InviteMemberPanel`.
2. Invite is created through `org-invite-member` with role template and optional brand-project scope.
3. Onboarding link is copied/shared manually; invites can be regenerated, revoked, or deleted via dedicated edge functions.
4. Member access is updated from drawer:
   - `org_role_key`
   - per-member `permissions` overrides
   - `brand_project_ids` scope
5. Owner role remains UI-locked from member drawer edits.

## Expected Target Flow
- Membership lifecycle should cover invite, accept, activate, suspend/reactivate, and removal with complete audit lineage and clear handoffs to downstream permissions.

## Breakpoints and Gaps Between Current and Target
- Invite lifecycle is strong, but status lifecycle for existing members is not surfaced in org-admin UI.
- No bulk operations for common membership updates.
- No direct activity-driven triage path from member rows into operational views.

## Required Integration Points to Close the Gap
- Add explicit status mutation actions (`active/suspended/removed`) with audited writes.
- Add bulk member operations with scoped safeguards.
- Add member-centric drill-down links to workload/activity surfaces.
- Ensure status changes drive immediate auth/session and route-access behavior.

## Suggested Order of Implementation
1. Implement member status mutation API contract and audit coverage.
2. Add single-member status controls in `/admin/members`.
3. Add member activity deep links.
4. Add bulk operations with preview and confirmation.
5. Add automation tests for invite-to-active and suspend/reactivate paths.

