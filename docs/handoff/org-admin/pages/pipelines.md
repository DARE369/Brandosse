# Org Admin Page: Pipelines

## Page Purpose (Plain Language)
This page designs the organization’s content review workflow. Admins define stages, who owns each stage, SLA expectations, escalation contacts, and which pipeline is default.

## Route and Access Rules
- Route: `/app/org/:orgId/admin/pipelines`
- Guard: `OrgAdminRoute`

## Component Composition
- Container: `src/org/admin/PipelineConfigPage.jsx`
- Key composition:
  - Config list sidebar
  - Pipeline canvas with ordered stage nodes
  - Stage settings editor
  - Template gallery modal

## State, Hooks, Services Used
- `useOrgContext` for org and active brand-project scope.
- Services:
  - `fetchPipelineConfigs`
  - `createPipelineConfig`
  - `updatePipelineConfig`
  - `duplicatePipelineConfig`
  - `deletePipelineConfig`
  - `setDefaultPipelineConfig`
  - `fetchOrganizationMembers`
- Helpers:
  - `PIPELINE_TEMPLATE_PRESETS`
  - `buildTemplateStages`
  - `normalizePipelineStages`
  - `createPipelineStage`

## Data Contracts Touched
- Reads:
  - `pipeline_configs`
  - `organization_members`
  - `profiles` (indirect via member fetch)
- Writes:
  - `pipeline_configs` CRUD
  - `organizations.settings.default_pipeline_id` via `setDefaultPipelineConfig`

## Inbound Dependencies
- Admin sidebar `Pipelines` route entry.
- Active brand project context in top navbar scopes config query behavior.

## Outbound Dependencies
- New pipeline submissions use these configs to initialize `pipeline_items`.
- Stage metadata drives downstream review behavior in pipeline and calendar flows.
- Default pipeline setting controls fallback selection during submission.

## Current Working Relationships
- Stage model supports:
  - role-based or user-specific assignment
  - SLA hours and escalation user
  - optional stages
  - rejection-comment requirement
  - client-review-link generation marker
- Template-based bootstrapping accelerates config creation.

## Missing or Partial Relationships
- No direct visibility of active pipeline-item counts by config inside this page.
- No deployment/capability check for client-review-related flows when stage flag is enabled.
- No config versioning or migration preview for teams with in-flight items.

## No Relation Exists Yet
- No relation from a pipeline config to a simulation of end-to-end review timing.
- No relation from this page to a filtered pipeline board showing only items using the selected config.

## Recommended Wiring Contract
- Add “usage impact” panel:
  - number of items using config
  - affected assignees
  - SLA risk summary
- Add feature capability check for client-review functions before enabling relevant stage flags.
- Add immutable config versioning when editing active defaults with in-flight workload.

## Risks If Wired Incorrectly
- Changing stage semantics without migration handling can break in-flight pipeline lineage.
- Invalid assignee references can create unowned review stages and stalled content.
- Incorrect default-pipeline writes can silently reroute new submissions.

