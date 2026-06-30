# Workflow: Brand Project Scope Control

## Current Implemented Flow
1. Member scope is encoded in `organization_members.brand_project_ids` (`null`/empty means broad access).
2. Org context picks active brand project and persists it in `context_last_used`.
3. RLS helpers (`org_current_user_has_brand_access`) gate reads/writes by organization + brand project scope.
4. Admin membership edits can narrow or broaden member project access.
5. Agency mode exposes brand-project selector in org top navbar.

## Expected Target Flow
- Brand-project scope should consistently control query results, navigation options, and mutation permissions across all org-admin and org-member surfaces.

## Breakpoints and Gaps Between Current and Target
- Some admin pages rely on broad org reads and apply project context only at service-query layer.
- No centralized UX indicator when a user’s scope prevents seeing a config/object that exists in the org.
- No explicit “scope diagnostics” page for troubleshooting project-access issues.

## Required Integration Points to Close the Gap
- Add shared scope diagnostics helper for page-level preflight checks.
- Add explicit fallback states when active project is out of scope for current member.
- Add admin tooling to inspect effective project scope per member.

## Suggested Order of Implementation
1. Add shared “effective project scope” utility and diagnostics API.
2. Integrate preflight checks in admin/member pages.
3. Add scope inspector to members management drawer.
4. Add tests for project-restricted members across key routes.

