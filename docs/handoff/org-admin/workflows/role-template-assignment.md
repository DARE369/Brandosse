# Workflow: Role Template Assignment

## Current Implemented Flow
1. Admin manages reusable templates in `/admin/roles`.
2. Templates are created/edited/deleted in `org_role_templates`.
3. Member assignment happens in `/admin/members` by writing `organization_members.org_role_key`.
4. Member-level overrides are optionally layered on top of template defaults.

## Expected Target Flow
- Role templates should be safely versioned and assignment-aware so changes remain predictable for live members and operational flows.

## Breakpoints and Gaps Between Current and Target
- Deletion safety is mostly UI-based; race conditions can occur between read and delete.
- No first-class versioning or migration assistant for template changes.
- No built-in impact analysis before role permission changes.

## Required Integration Points to Close the Gap
- Server-enforced role deletion guards when active assignments exist.
- Role change impact preview in members and roles surfaces.
- Audit/event stream for template lifecycle operations.

## Suggested Order of Implementation
1. Add backend delete guard and assignment count checks.
2. Add pre-save impact preview in `/admin/roles`.
3. Add optional “reassign members before delete” flow.
4. Add role lifecycle audit events and reporting.

