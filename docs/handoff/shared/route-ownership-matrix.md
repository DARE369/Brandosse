# Route Ownership Matrix

## Purpose
This matrix enforces route ownership by stage so each route is documented once in the canonical handoff program.

## Rule
Each route must be owned by exactly one stage or shared foundation.

## Matrix
| Route | Owner | Stage | Canonical Doc |
| --- | --- | --- | --- |
| `/` | Shared foundation | Shared | `shared/master-foundations.md` |
| `/login` | Personal workspace | Stage 1 | `personal/pages/login.md` |
| `/register` | Personal workspace | Stage 1 | `personal/pages/register.md` |
| `/auth/callback` | Personal workspace | Stage 1 | `personal/pages/auth-callback.md` |
| `/complete-signup` | Personal workspace | Stage 1 | `personal/pages/complete-signup.md` |
| `/select-context` | Personal workspace | Stage 1 | `personal/pages/select-context.md` |
| `/generate` | Shared redirect entry | Shared | `shared/master-foundations.md` |
| `/app` | Shared protected shell | Shared | `shared/master-foundations.md` |
| `/app/dashboard` | Personal workspace | Stage 1 | `personal/pages/dashboard.md` |
| `/app/generate` | Personal workspace | Stage 1 | `personal/pages/generate.md` |
| `/app/generate/:sessionId` | Personal workspace | Stage 1 | `personal/pages/generate.md` |
| `/app/calendar` | Personal workspace | Stage 1 | `personal/pages/calendar.md` |
| `/app/library` | Personal workspace | Stage 1 | `personal/pages/library.md` |
| `/app/help` | Personal workspace | Stage 1 | `personal/pages/help.md` |
| `/app/settings` | Personal workspace | Stage 1 | `personal/pages/settings.md` |
| `/app/settings/brand-kit` | Personal workspace | Stage 1 | `personal/pages/settings-brand-kit.md` |
| `/app/analytics` | Personal alias route | Stage 1 | `personal/pages/calendar.md` |
| `/app/profile` | Personal alias route | Stage 1 | `personal/pages/settings.md` |
| `/app/admin` | Platform admin | Stage 2 | `platform-admin/pages/overview.md` |
| `/app/admin/users` | Platform admin | Stage 2 | `platform-admin/pages/users.md` |
| `/app/admin/users/:userId` | Platform admin | Stage 2 | `platform-admin/pages/user-detail.md` |
| `/app/admin/accounts` | Platform admin | Stage 2 | `platform-admin/pages/accounts.md` |
| `/app/admin/organizations` | Platform admin | Stage 2 | `platform-admin/pages/organizations.md` |
| `/app/admin/organizations/:orgId` | Platform admin | Stage 2 | `platform-admin/pages/organization-detail.md` |
| `/app/admin/moderation` | Platform admin | Stage 2 | `platform-admin/pages/moderation.md` |
| `/app/admin/complaints` | Platform admin | Stage 2 | `platform-admin/pages/complaints.md` |
| `/app/admin/complaints/:complaintId` | Platform admin | Stage 2 | `platform-admin/pages/complaint-detail.md` |
| `/app/admin/logs` | Platform admin | Stage 2 | `platform-admin/pages/logs.md` |
| `/app/admin/analytics` | Platform admin | Stage 2 | `platform-admin/pages/analytics.md` |
| `/app/admin/settings` | Platform admin | Stage 2 | `platform-admin/pages/settings.md` |
| `/app/org/:orgId/overview` | Org admin | Stage 3 | `org-admin/pages/overview.md` |
| `/app/org/:orgId/admin/brand-kit` | Org admin | Stage 3 | `org-admin/pages/brand-kit.md` |
| `/app/org/:orgId/admin/members` | Org admin | Stage 3 | `org-admin/pages/members.md` |
| `/app/org/:orgId/admin/roles` | Org admin | Stage 3 | `org-admin/pages/roles.md` |
| `/app/org/:orgId/admin/pipelines` | Org admin | Stage 3 | `org-admin/pages/pipelines.md` |
| `/app/org/:orgId/admin/credits` | Org admin | Stage 3 | `org-admin/pages/credits.md` |
| `/app/org/:orgId/admin/settings` | Org admin | Stage 3 | `org-admin/pages/settings.md` |
| `/app/org/:orgId/workspace` | Org member | Stage 4 | `org-member/pages/workspace.md` |
| `/app/org/:orgId/office` | Org member | Stage 4 | `org-member/pages/office.md` |
| `/app/org/:orgId/pipeline` | Org member | Stage 4 | `org-member/pages/pipeline.md` |
| `/app/org/:orgId/calendar` | Org member | Stage 4 | `org-member/pages/calendar.md` |
| `/app/org/:orgId/library` | Org member | Stage 4 | `org-member/pages/library.md` |
| `/app/org/:orgId/common-room` | Org member | Stage 4 | `org-member/pages/common-room.md` |
| `/app/org/:orgId/common-room/:channelId` | Org member | Stage 4 | `org-member/pages/common-room.md` |
| `/app/org/:orgId/team-activity` | Org member | Stage 4 | `org-member/pages/team-activity.md` |
| `/join` | Org member onboarding | Stage 4 | `org-member/pages/join.md` |
| `/review/:clientReviewToken` | Org member external review | Stage 4 | `org-member/pages/client-review.md` |
| `/app/*` unmatched | Shared not-found behavior | Shared | `shared/master-foundations.md` |
| `*` global unmatched | Shared not-found behavior | Shared | `shared/master-foundations.md` |

## Stage 1 Verification
- All Stage 1 required personal routes are assigned and documented in `personal/pages`.
- Alias routes are explicitly documented as aliases, not independent feature pages.

## Stage 2 Verification
- All Stage 2 required platform-admin routes are assigned and documented in `platform-admin/pages`.
- Supplemental implemented route `/app/admin/accounts` is explicitly owned by Stage 2.

## Stage 3 Verification
- All Stage 3 required org-admin routes are assigned and documented in `org-admin/pages`.
- Route implementation nuance recorded: `/app/org/:orgId/admin/brand-kit` is documented as an org-admin-owned route but is currently guarded at member-route level with page-level edit entitlement checks.

## Stage 4 Verification
- All Stage 4 required org-member routes are assigned and documented in `org-member/pages`.
- Both public Stage 4 entry routes (`/join`, `/review/:clientReviewToken`) are explicitly owned by org-member stage docs.
