# Workflow: Workspace Initialization

## Current Implemented Flow
1. User enters `/app/org/:orgId/*`.
2. `OrgContextProvider` loads organization, membership, role, permissions, brand projects, and active brand project.
3. `OrgMemberRoute` validates active membership.
4. `OrgWorkspaceShell` renders top nav and sidebar.
5. Org home redirect resolves:
   - admin roles -> `/overview`
   - member roles -> `/workspace`
6. Member workspace page (`/workspace`) loads calendar snapshot plus member dashboard state (`org_member_dashboard_state`).

## Expected Target Flow
- Initialization should also expose readiness diagnostics, unresolved permission conflicts, and quick-recovery actions when context data is inconsistent.

## Breakpoints and Gaps Between Current and Target
- Permission and context failures are mostly surfaced as redirects/toasts without diagnostic detail.
- No preflight readiness panel for member-visible dependencies (default brand, pipeline availability, account access).

## Required Integration Points to Close the Gap
- Add context preflight object with explicit readiness flags.
- Add shell-level diagnostics component for actionable misconfiguration warnings.
- Add fallback guidance when role/template/override contracts are inconsistent.

## Suggested Order of Implementation
1. Add backend/frontend readiness contract and expose it in org context.
2. Add shell diagnostics with non-blocking warnings and links.
3. Add policy parity checks for key permissions used in member pages.

