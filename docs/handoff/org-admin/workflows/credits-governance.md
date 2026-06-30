# Workflow: Credits Governance

## Current Implemented Flow
1. Members can create `credit_requests`.
2. Org admins can read request queues via `/admin/credits`.
3. Backend action endpoint `credit-request-action` supports:
   - approve
   - deny
   - partial
4. On approval/partial, member `monthly_credit_limit` is adjusted and notification is sent.

## Expected Target Flow
- Org admins should be able to review and resolve credit requests directly from the credits UI with transparent outcomes and audit visibility.

## Breakpoints and Gaps Between Current and Target
- Credits page is currently read-only.
- Request context is minimal (raw ids, no rich reviewer/status detail).
- No approval action audit timeline shown in UI.

## Required Integration Points to Close the Gap
- Wire credits page actions to `credit-request-action`.
- Expand row model with requester/reviewer identity and resolution detail.
- Add post-action optimistic refresh and error recovery states.

## Suggested Order of Implementation
1. Add approve/deny/partial action controls.
2. Add requester/reviewer identity joins and richer table columns.
3. Add action-result notifications in UI and status filters.
4. Add regression tests for request resolution and limit updates.

