# Org Member Wiring Gap Report (Stage 4)

## Purpose
This report tracks missing or partial org-member relationships as first-class handoff content.

Each gap is documented as:
1. Current state
2. Intended relationship
3. Exact missing connection point
4. Likely implementation path
5. Constraints and risks

## Gap 1: Calendar schedule-context helpers are referenced but not wired in service module
### Current state
- `orgCalendarService` calls `fetchOrgScheduleContext` and `toEdgeFunctionError` in schedule/publish flows.
- Those helpers are defined in `orgScheduleService` and are not imported into `orgCalendarService`.

### Intended relationship
- Calendar service should have a stable internal dependency on schedule-context and edge error normalization helpers.

### Missing connection point
- Missing imports and contract binding in `src/org/services/orgCalendarService.js`.

### Likely implementation path
- Import helper functions from `src/org/services/orgScheduleService.js`.
- Add service-level tests for:
  - scheduling with account override
  - publish-now edge error normalization
  - unavailable destination rejection paths

### Constraints and risks
- Runtime failures in scheduling/publishing paths will cascade into calendar, workspace, and library actions.

## Gap 2: Client review link generation backend is present but member route surfaces do not expose it clearly
### Current state
- `pipeline-generate-client-link` edge function and `generateClientReviewLink` service method exist.
- Stage 4 route pages do not provide a clear action path for generating and copying the review link.

### Intended relationship
- Review-capable members should generate client links in-context from the active pipeline stage.

### Missing connection point
- No explicit Stage 4 UI control connected to `generateClientReviewLink`.

### Likely implementation path
- Add action control in pipeline detail or calendar schedule modal.
- Gate action by current stage capability (`generates_client_review_link`) and actor authorization.

### Constraints and risks
- Ad hoc link generation outside stage rules can bypass intended review governance.

## Gap 3: Cross-page deep-link contract is inconsistent
### Current state
- Some flows pass `pipelineItemId` via route state; others route only to page roots.
- Common-room references and several office/library links do not provide focused target state.

### Intended relationship
- Any handoff to pipeline/calendar/library should open the exact target entity when context exists.

### Missing connection point
- No canonical navigation payload schema and no shared resolver pattern.

### Likely implementation path
- Define shared deep-link schema:
  - `pipelineItemId`
  - `taskId`
  - `postId`
  - `assetId`
- Add destination-page resolvers and focus behavior for each supported key.

### Constraints and risks
- Weak deep links increase triage time and create context loss across teams.

## Gap 4: Team Activity is pipeline-only and misses core workspace signals
### Current state
- `/team-activity` reads only `pipeline_items`.
- No tasks, schedule/publish events, common-room activity, or notifications are included.

### Intended relationship
- Team activity should show cross-domain execution signals in one feed.

### Missing connection point
- No event aggregator service or consolidated activity contract for this route.

### Likely implementation path
- Introduce composite activity query/service combining:
  - pipeline transitions
  - task updates
  - publish/schedule events
  - common-room channel activity
- Add severity and actor metadata for quick operational triage.

### Constraints and risks
- Teams may rely on incomplete activity data and miss blockers.

## Gap 5: Admin-configured workflow rules are not fully visible to members at action time
### Current state
- Members are constrained by backend permissions and pipeline configuration.
- UI often does not explain why an action is unavailable (for example, scheduling/publish constraints).

### Intended relationship
- Member surfaces should expose actionable rule feedback based on admin configuration.

### Missing connection point
- Limited UI-level explainability for permission failures and stage capability restrictions.

### Likely implementation path
- Standardize denied-action reasons and surface them in modal/tooltips.
- Return explicit reason codes from key edge actions and map them to user-facing copy.

### Constraints and risks
- Hidden constraints cause repeated failed actions and support load.

## Gap 6: Asset lineage is enriched, but not end-to-end navigable
### Current state
- Asset origin includes linked post, pipeline, and task metadata.
- Navigation from library origin cards does not consistently open focused records.

### Intended relationship
- Users should traverse asset to post to pipeline to task without manual lookup.

### Missing connection point
- No full lineage navigation contract or dedicated lineage viewer.

### Likely implementation path
- Implement focused route-state links from library origin badges.
- Add inline lineage drawer showing upstream and downstream entities.

### Constraints and risks
- Weak lineage visibility can lead to duplicate assets and mistaken edits.

## Gap 7: Common-room references are partial and not strongly typed
### Current state
- Messages can embed `asset_reference` and `pipeline_reference`.
- Reference metadata is loosely structured and destination pages do not always consume detailed context.

### Intended relationship
- References should be typed, validated, and deeply navigable.

### Missing connection point
- No shared message-reference schema/version consumed by both sender and receiver surfaces.

### Likely implementation path
- Add typed metadata contract with required ids and optional display snapshots.
- Validate payload on send and enforce destination resolver compatibility.

### Constraints and risks
- Unstructured reference metadata can drift and break navigation silently.

## Gap 8: Invitation acceptance has robust backend logic but limited recovery UX
### Current state
- `/join` handles preview, mismatch, expired/revoked, password setup, and acceptance.
- Recovery actions are minimal and mostly redirect-driven.

### Intended relationship
- Failed invitation states should provide clear guided recovery paths.

### Missing connection point
- No direct remediation links for resend contact flow or support escalation from failure views.

### Likely implementation path
- Add structured remediation actions in each terminal state.
- Surface contextual identifiers to reduce support handling time.

### Constraints and risks
- Onboarding drop-off remains high when users hit ambiguous error states.

## Gap 9: Notifications drive navigation but lifecycle status is fragmented
### Current state
- Notification center merges `user_notifications` and common-room unread signals.
- Some interactions mark read, some acknowledge only local common-room state.

### Intended relationship
- Notification lifecycle should be consistent across sources.

### Missing connection point
- No unified persisted lifecycle model for mixed-source notifications.

### Likely implementation path
- Add explicit source-specific read/acknowledge contracts and consistency checks.
- Normalize read semantics in service layer.

### Constraints and risks
- Inconsistent unread counts reduce trust in notification triage.

## Gap 10: Task, pipeline, calendar, and library handoffs are not fully closed-loop
### Current state
- Task drawer can open pipeline/calendar.
- Library can open schedule when post/pipeline origin exists.
- Office and pipeline do not consistently provide reciprocal deep links and focused return paths.

### Intended relationship
- Member workflows should operate as a closed loop:
  - draft -> pipeline -> task -> calendar -> library -> back to originating context

### Missing connection point
- No explicit round-trip navigation and return-context model across these surfaces.

### Likely implementation path
- Add return-context payload and breadcrumb model in route state/query.
- Preserve and restore focused entity when navigating between pages.

### Constraints and risks
- Context loss during handoffs increases cycle time and rework risk.

## Required Stage-4 Gap Buckets Check
### Missing handoffs from admin-configured rules
- Covered by Gap 5.

### Incomplete task/pipeline/calendar/library links
- Covered by Gap 3, Gap 6, and Gap 10.

### Channel/message/asset/pipeline references that are partial
- Covered by Gap 7.

### Client-review or invite flows that are incomplete or weakly connected
- Covered by Gap 2 and Gap 8.
