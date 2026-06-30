# Workflow: Audit and Notification Flows

## Current Implemented Flow
1. Admin actions write audit events through `write_audit_log` RPC (with fallback direct insert in admin client for recoverable cases).
2. Complaint status RPC writes:
  - complaint history
  - admin notification
  - user notification (resolved cases)
  - audit event
3. Connected-account admin actions write:
  - `admin_account_actions`
  - `connection_events`
  - optional `user_notifications`
4. Admin navbar notification center reads `admin_notifications`, normalizes legacy/canonical column pairs, and supports read/ack actions.
5. Overview risk modal subscribes to very-high risk notifications and requires acknowledgment.
6. Logs page provides read access to `audit_logs` and `connection_events` streams.

## Expected Target Flow
- One coherent observability and communication pipeline where action lineage, notifications, and operational logs share canonical schemas and correlation IDs.

## Breakpoints and Gaps Between Current and Target
- Notification model remains compatibility-dual (`type/notification_type`, `read/is_read`, `admin_id/recipient_admin_id`).
- Logs page omits `admin_account_actions` from primary investigation timeline.
- Admin settings notification preferences are local-only and do not influence backend delivery or fetch policies.
- Not all flows enforce end-to-end correlation identifiers for traceability.

## Required Integration Points to Close the Gap
- Canonical notification schema migration plan (dual-write -> canonical-read -> legacy cleanup).
- Unified logs API/view that includes audit, connection, and account-action streams.
- Persistent admin notification preferences and policy-aware delivery/filtering.
- Mandatory correlation ID propagation in admin action paths.

## Suggested Order of Implementation
1. Introduce correlation IDs and enforce them in admin action helpers/functions.
2. Build unified logs backend contract and update logs UI to consume it.
3. Implement canonical notification schema transition plan.
4. Persist admin notification preferences and apply them to fetch/subscription behavior.
