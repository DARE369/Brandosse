# Workflow: Org Scheduling and Publishing

## Current Implemented Flow
1. Member opens scheduling context from workspace/calendar/library/task flows.
2. Calendar view and schedule modal drive schedule/publish actions.
3. Scheduling and publish-now use `org-calendar-publish` for pipeline-linked records.
4. Standalone post scheduling updates post scheduling fields directly.
5. Publish flow emits notification and audit side effects in edge function.

## Expected Target Flow
- Scheduling and publishing should use one consistent context contract, return structured action reasons, and provide deterministic deep-link continuity for every entry path.

## Breakpoints and Gaps Between Current and Target
- `orgCalendarService` references schedule-context helpers without import wiring.
- Denied action reasons are not consistently surfaced in all calling UI surfaces.
- Some pages launch scheduling without preserving focused return context.

## Required Integration Points to Close the Gap
- Fix service-level imports and tests around schedule context.
- Standardize publish/schedule error reason mapping.
- Add common action result payload for caller UI feedback and navigation.

## Suggested Order of Implementation
1. Fix schedule-context helper wiring in calendar service.
2. Add action result schema with reason codes and entity ids.
3. Apply consistent deep-link return contracts from all launch points.

