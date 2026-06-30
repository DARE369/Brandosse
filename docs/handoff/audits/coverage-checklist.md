# Stage 5 Coverage Checklist (Audits and Consolidation)

## Deliverable Coverage
| Required Output | Document | Status |
| --- | --- | --- |
| Dormant frontend/backend code audit | `dormant-code-and-schema.md` | Covered |
| Unused/legacy SQL object audit | `dormant-code-and-schema.md` | Covered |
| Duplicate/parallel model audit | `dormant-code-and-schema.md` | Covered |
| Dirty tree and work-cluster audit | `dirty-tree-work-clusters.md` | Covered |
| Security/RBAC/RLS/token audit | `security-rbac-rls-token-gaps.md` | Covered |
| Communication contract gap audit | `communication-contract-gaps.md` | Covered |
| Target structure recommendation | `target-repo-and-architecture-structure.md` | Covered |
| System-wide wired/partial/no-relation map | `system-integration-map.md` | Covered |

## Validation Rule Coverage
| Rule | Status | Notes |
| --- | --- | --- |
| Evidence-based schema/function claims | Covered | Claims cite current migration/function/page files and line-level evidence where critical. |
| Missing links treated as first-class content | Covered | Included in all Stage 5 docs and consolidated map. |
| Default integration path recommended for unresolved gaps | Covered | Each major gap includes recommended implementation path. |
| Risks of incorrect wiring captured | Covered | Risks included per finding and per domain map. |

## Confidence and Uncertainty Note
### High confidence
- Security findings tied to explicit code evidence in edge functions and role helpers.
- Confirmed legacy table classification from migration comments.
- Dirty tree cluster counts from direct git status snapshot.
- Communication break in `orgCalendarService` based on direct line-level mismatch.

### Medium confidence
- Dormancy classification for non-invoked edge functions because some may be cron/internal/external-entrypoint only.
- View exposure risk depends on deployment grants and environment-specific privilege configuration.

### Known uncertainty boundaries
- Current working tree is highly active and may change quickly.
- Some behavior depends on deployed environment variables, cron wiring, and external API integrations.

