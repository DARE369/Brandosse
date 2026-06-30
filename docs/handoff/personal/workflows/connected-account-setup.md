# Workflow: Connected Account Setup

## Current Implemented Flow
1. `/app/settings` personal tab loads platform registry and user personal accounts.
2. User starts connect/edit flow through `MockOAuthScreen`.
3. `connectionService.connectAccount`:
   - validates platform
   - runs mock provider auth
   - upserts `connected_accounts`
   - inserts `connection_events`.
4. Reconnect/disconnect actions update account status and insert events.
5. Health modal reads `connected_accounts_health_summary` and latest `connection_events`.

## Expected Target Flow
- Explicitly governed account lifecycle with clear ownership boundaries for personal vs org scopes.

## Breakpoints and Gaps
- Personal settings can only deep-link to org settings for org accounts; no targeted context handoff.
- No explicit user-facing explanation of `granted_member_ids` policy behavior when scope is org.

## Required Integration Points
- Add deep-link state payload with target org/account/action.
- Add account policy explanation component for scope and permission implications.

## Suggested Implementation Order
1. Add deep-link contract and consumer in org settings pages.
2. Add shared account access policy renderer.
3. Add tests for reconnect/disconnect status transitions and health view consistency.
