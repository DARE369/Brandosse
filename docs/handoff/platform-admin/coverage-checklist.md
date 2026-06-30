# Stage 2 Coverage Checklist (Platform Admin)

## Route Coverage
| Route | Page Doc | Status |
| --- | --- | --- |
| `/app/admin` | `pages/overview.md` | Covered |
| `/app/admin/users` | `pages/users.md` | Covered |
| `/app/admin/users/:userId` | `pages/user-detail.md` | Covered |
| `/app/admin/organizations` | `pages/organizations.md` | Covered |
| `/app/admin/organizations/:orgId` | `pages/organization-detail.md` | Covered |
| `/app/admin/moderation` | `pages/moderation.md` | Covered |
| `/app/admin/complaints` | `pages/complaints.md` | Covered |
| `/app/admin/complaints/:complaintId` | `pages/complaint-detail.md` | Covered |
| `/app/admin/logs` | `pages/logs.md` | Covered |
| `/app/admin/analytics` | `pages/analytics.md` | Covered |
| `/app/admin/settings` | `pages/settings.md` | Covered |

## Supplemental Route Coverage (Implemented but not in Stage 2 requested list)
| Route | Page Doc | Status |
| --- | --- | --- |
| `/app/admin/accounts` | `pages/accounts.md` | Covered |
| `/app/admin/content/review` | `pages/moderation.md` (redirect note) | Covered |

## Workflow Coverage
| Workflow | Doc | Status |
| --- | --- | --- |
| Admin access resolution | `workflows/admin-access-resolution.md` | Covered |
| User investigation | `workflows/user-investigation.md` | Covered |
| Moderation actions | `workflows/moderation-actions.md` | Covered |
| Complaint triage | `workflows/complaint-triage.md` | Covered |
| Org oversight | `workflows/org-oversight.md` | Covered |
| Audit and notification flows | `workflows/audit-and-notification-flows.md` | Covered |

## Required Page Doc Sections Check
All Stage 2 page docs include:
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
  - duplicate authority sources
  - incomplete moderation lineage
  - missing org/member linkage
  - analytics/notification partial/mock contracts
  - additional route/lineage/ownership gaps

## Confidence and Uncertainty Note
### High confidence
- Route/page mappings validated against `src/router/router.jsx` and admin page components.
- SQL object claims validated against active migration files and edge function code.
- Missing moderation function paths are explicitly evidenced in `moderationApi` fallback/error branches.

### Medium confidence
- Some admin functionality depends on deployment state of edge functions not guaranteed in local code snapshot.
- Cross-file role semantics are documented from implementation, but runtime behavior also depends on current auth metadata and database rows.

### Known uncertainty boundaries
- Existing dirty working tree may include in-progress changes not yet reflected in canonical behavior.
- Some older migration objects remain for backward compatibility, so environment-specific schema history can differ.
