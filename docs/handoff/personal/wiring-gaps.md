# Personal Workspace Wiring Gap Report (Stage 1)

## Purpose
This report tracks missing or partial relationships in personal workspace flows. Each gap is documented as:
1. Current state
2. Intended relationship
3. Exact missing connection point
4. Likely implementation path
5. Constraints/risks

## Gap 1: Library media "Use in Post" has no media handoff
### Current state
- In `LibraryPageV2`, media item action `Use in Post` navigates to `/app/generate` with no state payload.

### Intended relationship
- Selected media should prefill generate flow as edit/reference input.

### Missing connection point
- Route state for media selection is not passed.
- `GeneratePageV2` has no branch for media-only handoff.

### Likely implementation path
- Add route state contract:
  - `{ useMediaAssetId, source: "library" }`
- In generate entry, load `media_assets` row and:
  - prefill prompt context
  - optionally open edit mode with source image URL
- Persist source linkage in `generations.metadata` and/or `posts`.

### Constraints and risks
- Must validate user ownership of media asset.
- Avoid creating broken source URLs for private storage objects.
- Keep behavior deterministic when both template and media state are present.

## Gap 2: Brand extraction is UI-complete but backend extraction is placeholder
### Current state
- `extractBrandKit` function signs URL and returns fallback inferred payload.

### Intended relationship
- Uploading brand docs should extract structured fields from real document content.

### Missing connection point
- No OCR/text extraction and no model-based field extraction in edge function.

### Likely implementation path
- Implement extraction pipeline in edge function:
  - retrieve file
  - extract text
  - run structured extraction model
  - return `brandKit`, `confidenceMap`, `missingTier1Fields`
- Keep exact response shape stable for current frontend.

### Constraints and risks
- Must maintain existing contract keys and field naming.
- Large file and timeout handling required.
- Sensitive brand data logging must be minimized.

## Gap 3: Generation stack has parallel active/legacy service layers
### Current state
- Active path: `SessionStore` + Freepik edge functions.
- Legacy/parallel path: `ApiService` and generator abstraction patterns remain.

### Intended relationship
- Single canonical generation orchestration path with explicit fallback policy.

### Missing connection point
- No strict boundary saying which modules are authoritative and which are deprecated.

### Likely implementation path
- Document canonical orchestration module.
- Move legacy calls behind feature flags or remove from primary flows.
- Add integration tests on canonical path only.

### Constraints and risks
- Removing legacy code without migration can break secondary UI actions (enhance/caption/SEO fallback).
- Feature-flag rollout needed to avoid runtime regressions.

## Gap 4: Calendar ghost-slot UX implies generation source not present in personal flow
### Current state
- Users can enable/tune ghost slots and accept suggested entries.
- Stage 1 code reads and accepts ghost slots but does not generate them.

### Intended relationship
- Toggle/settings should drive suggestion creation cadence.

### Missing connection point
- No visible generator worker/function integration in personal page/store paths.

### Likely implementation path
- Add scheduler/worker or edge function that writes `ghost_slots` from:
  - `calendar_settings`
  - `content_pillars`
  - historical posting/analytics
- Expose refresh action and "last generated at" in UI.

### Constraints and risks
- Avoid duplicate slot floods.
- Respect timezone and posting frequency settings.
- Ensure slots do not conflict with existing scheduled posts.

## Gap 5: Help flow has partial lineage between complaint and admin handling
### Current state
- Complaint submission invokes `notify-admin-event`.
- Fallback inserts directly into `admin_notifications` on failure.
- Complaint comments/status history schema exists but personal UI does not expose conversation timeline.

### Intended relationship
- Ticket lifecycle should be traceable from user report to admin actions/resolution updates.

### Missing connection point
- No personal UI for complaint comment thread and status history.
- No explicit linkage from publish errors to prefilled complaint creation.

### Likely implementation path
- Add support timeline panel sourcing:
  - `complaint_status_history`
  - user-visible `complaint_comments`
- Add "Report this failure" CTA from publish error modal with contextual payload.

### Constraints and risks
- Must separate internal admin comments from user-visible comments.
- Ensure sensitive metadata is not exposed to users.

## Gap 6: Immediate publish flow is multi-write without explicit idempotency contract
### Current state
- Publish path may insert/update multiple `posts`, then call mock publish attempts.

### Intended relationship
- Exactly-once publish intent per post/account selection set.

### Missing connection point
- No explicit idempotency key carried across DB writes and publish attempts.

### Likely implementation path
- Add publish request id in `posts` or companion table.
- Deduplicate repeated publish triggers by request id and target account.

### Constraints and risks
- Retrying without idempotency can create duplicate posts and duplicated events.
- Needs compatibility with existing UI success/failure feedback.

## Gap 7: Personal settings has org account visibility but no actionable handoff contract
### Current state
- Org accounts are read-only in personal settings.
- UI points user to org workspace.

### Intended relationship
- Users should understand exactly where and why they can manage access.

### Missing connection point
- No direct deep-link context handoff describing target account and required role.

### Likely implementation path
- Pass route state:
  - target org id
  - target account id
  - requested action
- Org settings page should consume and highlight target entity.

### Constraints and risks
- Avoid exposing org account IDs to unauthorized members.
- Role checks must run server-side, not only UI.

## Gap 8: Data exists without complete personal UI
### Current state
- Schema includes richer complaint/admin/publish telemetry and quality models than personal pages currently expose.

### Intended relationship
- Personal UI should surface enough telemetry for user trust and self-service.

### Missing connection point
- No personal page showing:
  - publish attempt timeline (`mock_publish_logs`)
  - account severity alerts (`account_severity_alerts`)
  - quality review outcomes (`content_quality_reviews`)

### Likely implementation path
- Add read-only diagnostic panels in Help or Settings.
- Use existing views and scoped policies.

### Constraints and risks
- Must avoid leaking org/admin-private signals.
- Keep UX non-technical while preserving actionable details.

## Summary by Required Buckets
### Missing page-to-page links
- Library media -> Generate prefill
- Publish failure -> Help prefilled complaint
- Personal settings org account -> focused org admin destination

### Incomplete service-to-schema contracts
- Brand extraction contract not fully implemented
- Publish idempotency contract missing
- Mixed generation service ownership

### Unfinished publish/account/library/help flows
- Ghost slot production pipeline unclear
- Support lifecycle incomplete in user UI
- Account management split without deep context transfer

### Data exists without UI wiring
- `mock_publish_logs`
- `account_severity_alerts`
- complaint comments/history timelines
- quality review surfaces

### UI exists without backend completion
- Brand doc extraction path (placeholder extraction backend)
- Ghost slot settings implying autonomous suggestion generation
