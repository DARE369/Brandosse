# Workflow: Pipeline Setup

## Current Implemented Flow
1. Admin creates/edits pipeline configs in `/admin/pipelines`.
2. Stages are stored as normalized JSON arrays in `pipeline_configs.stages`.
3. Default pipeline selection updates both `pipeline_configs.is_default` and `organizations.settings.default_pipeline_id`.
4. Submission workflows use default/config-selected pipeline to create `pipeline_items`.

## Expected Target Flow
- Pipeline setup should support controlled rollout, impact visibility, and safe evolution when active items are in-flight.

## Breakpoints and Gaps Between Current and Target
- No in-page impact view of active items tied to selected config.
- No config versioning when modifying active defaults.
- Client-review stage flags are configurable but not validated against runtime function capability in this page.

## Required Integration Points to Close the Gap
- Add config usage counters and in-flight impact panel.
- Introduce config version model for non-breaking edits.
- Add capability checks for client-review workflows before enabling related stage options.

## Suggested Order of Implementation
1. Add usage/impact summary in pipeline builder.
2. Add non-breaking versioning and migration behavior for config edits.
3. Add client-review capability validation and warnings.
4. Add rollback controls for default pipeline changes.

