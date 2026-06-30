# Communication Contract Gap Audit

## Purpose
Identify broken or weak contracts between pages, services, edge functions, and schema that cause runtime instability or unclear integration ownership.

The gaps below follow the required five-part format:
1. Current state
2. Intended relationship
3. Exact missing connection point
4. Likely implementation path
5. Constraints and risks

## Gap 1: Org calendar service references helpers that are not imported
### Current state
- `orgCalendarService` calls `fetchOrgScheduleContext` and `toEdgeFunctionError`.
- Those helpers are defined in `orgScheduleService`.

### Intended relationship
- Calendar scheduling/publishing should delegate schedule-context retrieval and edge error normalization through explicit imports.

### Exact missing connection point
- `src/org/services/orgCalendarService.js:807`, `:829`, `:838` call helper symbols with no imports present.
- Helper definitions exist in `src/org/services/orgScheduleService.js:11` and `:100`.

### Likely implementation path
1. Import both helpers into `orgCalendarService`.
2. Add service tests for schedule, publish-now, and unavailable destination handling.
3. Add lint/check rule for unresolved runtime identifiers in service modules.

### Constraints and risks
- Current state can throw runtime errors in org scheduling and publish workflows.
- Failures cascade into workspace, calendar, and library handoffs.

## Gap 2: Client review link generation exists in service but is not UI-wired
### Current state
- `generateClientReviewLink` is exported in `src/org/services/pipelineService.js:530`.
- No routed callsites use this helper in page components.

### Intended relationship
- Pipeline-stage actors should generate and share client review links directly from review-capable stage UI.

### Exact missing connection point
- Member-facing pipeline surfaces have no explicit action bound to `generateClientReviewLink`.

### Likely implementation path
1. Add "Generate Client Review Link" action in pipeline detail panel.
2. Gate by stage capability (`generates_client_review_link`) and permission checks.
3. Add copy/share UX and token-expiration display.

### Constraints and risks
- Without visible UI wiring, client-review flow is technically available but operationally hidden.
- Teams may bypass intended governance using ad hoc tooling.

## Gap 3: Deep-link payload contracts are inconsistent across workspace handoffs
### Current state
- Some page transitions pass contextual IDs in route state.
- Many transitions route to page root without preserving entity focus.

### Intended relationship
- Cross-page handoffs should always preserve actionable context for fast triage.

### Exact missing connection point
- No shared deep-link payload schema consumed by all destination pages.

### Likely implementation path
1. Define one payload contract for `postId`, `pipelineItemId`, `taskId`, `assetId`, `returnTo`.
2. Build a shared resolver utility for destination pages.
3. Add integration tests covering round-trip navigation.

### Constraints and risks
- Context loss increases cycle time and causes wrong-entity edits.

## Gap 4: Notification contract normalization is still compatibility-heavy
### Current state
- Stage 2 docs show compatibility mapping for mixed notification fields (`type` vs `notification_type`, `read` vs `is_read`).

### Intended relationship
- One canonical notification schema should be used across UI and backend.

### Exact missing connection point
- No full migration completion plan from dual-shape to canonical-shape contract.

### Likely implementation path
1. Keep dual-write for one transition release.
2. Switch reads to canonical fields with fallback.
3. Remove fallback after data/backfill verification.

### Constraints and risks
- Premature removal breaks existing records and mixed-version clients.

## Gap 5: Route authority and RBAC use different role contracts
### Current state
- `authRouting.isAdminRole` allows only `super_admin`.
- Admin RBAC utilities treat `org_admin` as admin-capable.

### Intended relationship
- Route access and in-app admin privileges should use one role authority source.

### Exact missing connection point
- No shared role-authority contract module is consumed everywhere.

### Likely implementation path
1. Centralize role normalization/authority in one shared module.
2. Replace duplicate role helpers in routing and admin utilities.
3. Add end-to-end tests for admin entry + scoped page behavior.

### Constraints and risks
- Role drift causes lockouts or accidental overexposure.

## Gap 6: Legacy and canonical generation services coexist without hard boundary
### Current state
- Deprecated generate state modules remain in source tree.
- Canonical flow has shifted to `src/services/generationPipeline.js`.

### Intended relationship
- Only one generation orchestration path should be active.

### Exact missing connection point
- No enforced contract that blocks reintroduction of deprecated modules into active UI.

### Likely implementation path
1. Move deprecated files to `legacy/` namespace.
2. Add lint rule preventing imports from legacy generation state.
3. Add canonical generation contract tests.

### Constraints and risks
- Parallel orchestration paths create subtle regressions in prompt, scheduling, and post lifecycle behavior.

