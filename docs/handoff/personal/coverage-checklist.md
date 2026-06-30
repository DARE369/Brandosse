# Stage 1 Coverage Checklist (Personal)

## Route Coverage
| Route | Page Doc | Status |
| --- | --- | --- |
| `/login` | `pages/login.md` | Covered |
| `/register` | `pages/register.md` | Covered |
| `/auth/callback` | `pages/auth-callback.md` | Covered |
| `/complete-signup` | `pages/complete-signup.md` | Covered |
| `/select-context` | `pages/select-context.md` | Covered |
| `/app/dashboard` | `pages/dashboard.md` | Covered |
| `/app/generate` | `pages/generate.md` | Covered |
| `/app/generate/:sessionId` | `pages/generate.md` | Covered |
| `/app/calendar` | `pages/calendar.md` | Covered |
| `/app/library` | `pages/library.md` | Covered |
| `/app/settings` | `pages/settings.md` | Covered |
| `/app/settings/brand-kit` | `pages/settings-brand-kit.md` | Covered |
| `/app/help` | `pages/help.md` | Covered |

## Workflow Coverage
| Workflow | Doc | Status |
| --- | --- | --- |
| Auth and post-auth routing | `workflows/auth-and-post-auth-routing.md` | Covered |
| Signup completion | `workflows/signup-completion.md` | Covered |
| Workspace selection | `workflows/workspace-selection.md` | Covered |
| Generation to post lifecycle | `workflows/generation-to-post-lifecycle.md` | Covered |
| Scheduling and publishing | `workflows/scheduling-and-publishing.md` | Covered |
| Connected account setup | `workflows/connected-account-setup.md` | Covered |
| Brand kit usage | `workflows/brand-kit-usage.md` | Covered |
| Help and complaint initiation | `workflows/help-and-complaint-initiation.md` | Covered |

## Required Page Doc Sections Check
All Stage 1 page docs include:
- Purpose in plain language
- Route and access rules
- Component composition
- State/store/hooks/services used
- Tables/views/RPC/edge/realtime touched
- Inbound dependencies
- Outbound dependencies
- Current relationships
- Missing/partial relationships
- "No relation exists yet"
- Recommended wiring contract
- Risks if wired incorrectly

## Missing-Link Inventory Check
- Dedicated report present: `wiring-gaps.md`
- Includes:
  - missing page-to-page links
  - incomplete service-schema contracts
  - unfinished publish/account/library/help flows
  - data exists without UI wiring
  - UI exists without backend completion

## Confidence and Uncertainty Note
### High confidence
- Route ownership, component composition, and service/store wiring documented from current code paths.
- Stage 1 schema references validated against active migrations and provided schema snapshot.

### Medium confidence
- Some backward-compatible fallback paths intentionally handle schema variants; these are documented as partial contracts.
- Ghost slot generation origin is not directly visible from Stage 1 page/store code and is treated as a wiring gap.

### Known uncertainty boundaries
- External worker/cron processes not present in reviewed frontend files may create data asynchronously.
- Legacy modules still present in repo may be unused at runtime; Stage 5 audit will classify dormancy definitively.
