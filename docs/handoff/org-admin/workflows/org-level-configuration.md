# Workflow: Org-Level Configuration

## Current Implemented Flow
1. `/admin/settings` provides:
   - shared connected-account operations
   - task status taxonomy management
   - read-only org summary cards
2. Connected-account management supports account connect/edit/reconnect/disconnect and per-member publish access grants.
3. Task statuses are editable for custom workflow naming/order/color.

## Expected Target Flow
- Org-level configuration should be a complete, domain-partitioned control plane covering general org settings, workflow settings, publishing settings, and governance settings.

## Breakpoints and Gaps Between Current and Target
- General org profile/settings mutations are not available here.
- Default pipeline id is visible but not directly editable from settings.
- Combined page coupling (accounts + task statuses + summary) increases operational complexity.

## Required Integration Points to Close the Gap
- Split settings into clear subdomains.
- Add core organization profile/settings management with audited writes.
- Add direct configuration linkage between settings domains (for example default pipeline, publish policies, account policies).

## Suggested Order of Implementation
1. Introduce settings sub-route structure by domain.
2. Add general org settings edit workflow.
3. Add cross-domain links (default pipeline, publish policy, role policy).
4. Add unified org-admin configuration audit feed.

