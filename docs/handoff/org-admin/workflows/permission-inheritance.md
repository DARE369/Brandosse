# Workflow: Permission Inheritance

## Current Implemented Flow
1. Effective permissions are resolved in frontend (`resolveOrgPermissions`) as:
   - role defaults
   - template permissions
   - member overrides
2. Database authorization checks use helper functions (`get_member_permission`, `org_current_user_role`, `org_current_user_has_brand_access`).
3. Feature surfaces consume effective permissions:
   - publish access
   - scheduling
   - library management
   - task management
   - invite rights

## Expected Target Flow
- One canonical permission contract should drive both UI capability display and backend enforcement with no drift.

## Breakpoints and Gaps Between Current and Target
- Capability logic is duplicated across frontend constants and SQL helper functions.
- Contract changes require synchronized edits across app code, edge functions, and SQL.
- No shared capability-schema versioning mechanism exists.

## Required Integration Points to Close the Gap
- Define a canonical capability schema and version.
- Generate or centrally source both frontend and backend permission maps from the same contract.
- Add permission parity tests for key roles and override combinations.

## Suggested Order of Implementation
1. Define canonical permission schema (keys, types, defaults, dependencies).
2. Refactor frontend resolver and SQL helper fallbacks to this schema.
3. Add parity test fixtures for `org_owner`, `org_admin`, `editor`, `contributor`, `reviewer`.
4. Add CI checks that block schema drift.

