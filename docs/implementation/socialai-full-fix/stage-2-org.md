# Stage 2: Org Workspace Log

## Objective

Complete org workspace tasks (`2A-1`, `2B-*`, `2C-1`, `2D-1`) including scheduling stability, pipeline flow, client review links, and credits governance actions.

## Change Log

### 2026-03-30

- Completed org pipeline route implementation by adding `src/org/pages/PipelineBoard.jsx` + `src/org/styles/PipelineBoard.css`.
- Added pipeline detail drawer actions: approve, request revision, reject, and schedule with role/stage gating logic.
- Added deep-link destination support on pipeline board using `extractDeepLinkParams()` and focused item selection.
- Completed deep-link propagation updates from office/workspace/calendar/common-room/content-queue/library callsites via `buildDeepLink()`.
- Completed client review link generation surfacing in org schedule modal, including copy UX and expiry display.
- Enforced 72-hour client review expiry in edge contracts:
  - `pipeline-generate-client-link`: sets `client_review_token_expires_at`.
  - `pipeline-client-action`: rejects expired tokens.
- Exposed client-review stage/link metadata in `org-get-schedule-context` and `orgScheduleService` model mapping.
- Implemented credits governance actions in `CreditManagementPage`:
  - approve / partial / deny controls
  - amount + note handling
  - reviewer/requester label resolution
  - row refresh after action.

## Verification Notes

- Source verification:
  - New pipeline board route resolves router import and compiles.
  - `pipelineItemId` deep-link payloads are read and acted on in pipeline destination.
  - `generateClientReviewLink` UI trigger present in org schedule modal + pipeline board.
  - `credit-request-action` invocation path wired from credits table action buttons.
- Build gate: `npm run build` passed.
