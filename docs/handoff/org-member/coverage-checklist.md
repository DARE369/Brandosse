# Stage 4 Coverage Checklist (Org Member)

## Route Coverage
| Route | Page Doc | Status |
| --- | --- | --- |
| `/app/org/:orgId/workspace` | `pages/workspace.md` | Covered |
| `/app/org/:orgId/office` | `pages/office.md` | Covered |
| `/app/org/:orgId/pipeline` | `pages/pipeline.md` | Covered |
| `/app/org/:orgId/calendar` | `pages/calendar.md` | Covered |
| `/app/org/:orgId/library` | `pages/library.md` | Covered |
| `/app/org/:orgId/common-room` | `pages/common-room.md` | Covered |
| `/app/org/:orgId/common-room/:channelId` | `pages/common-room.md` | Covered |
| `/app/org/:orgId/team-activity` | `pages/team-activity.md` | Covered |
| `/join` | `pages/join.md` | Covered |
| `/review/:clientReviewToken` | `pages/client-review.md` | Covered |

## Workflow Coverage
| Workflow | Doc | Status |
| --- | --- | --- |
| Invite acceptance | `workflows/invite-acceptance.md` | Covered |
| Workspace initialization | `workflows/workspace-initialization.md` | Covered |
| Draft to pipeline submission | `workflows/draft-to-pipeline-submission.md` | Covered |
| Review/revision/approval | `workflows/review-revision-approval.md` | Covered |
| Org scheduling/publishing | `workflows/org-scheduling-publishing.md` | Covered |
| Asset selection/linking | `workflows/asset-selection-linking.md` | Covered |
| Common-room collaboration | `workflows/common-room-collaboration.md` | Covered |
| Client review | `workflows/client-review.md` | Covered |

## Required Page Doc Sections Check
All Stage 4 page docs include:
- Purpose in plain language
- Route and access rules
- Component composition
- State/store/hooks/services used
- Tables/views/RPCs/edge/realtime touched
- Inbound dependencies
- Outbound dependencies
- Current working relationships
- Missing or partial relationships
- "No relation exists yet"
- Recommended wiring contract
- Risks if wired incorrectly

## Missing-Link Inventory Check
- Dedicated report present: `wiring-gaps.md`
- Includes:
  - missing handoffs from admin-configured rules
  - incomplete task/pipeline/calendar/library links
  - partial channel/message/asset/pipeline references
  - client-review and invite-flow weak-link points

## Confidence and Uncertainty Note
### High confidence
- Stage 4 route ownership and guard behavior validated against `src/router/router.jsx` and `src/utils/protectedRoute.jsx`.
- Org-member page behavior validated against `src/org/pages/*`, `src/pages/InvitationAccept/InvitationAcceptPage.jsx`, and `src/pages/ClientReview/ClientReviewPage.jsx`.
- Service and hook contract claims validated against `src/org/hooks/*` and `src/org/services/*`.
- Edge-function behavior validated against current function source in `supabase/functions/*`.
- SQL contract claims validated against active migration files listed in Stage 4 dependencies doc.

### Medium confidence
- Runtime behavior depends on deployed edge functions and environment variables (`APP_URL`, LLM provider keys, storage and auth settings).
- Active development churn may alter implementation details after this snapshot.

### Known uncertainty boundaries
- Existing dirty working tree means behavior may change quickly without migration/version pinning.
- Some permission outcomes depend on live org data quality (member status, role-template integrity, brand access scoping, granted member ids for shared accounts).
