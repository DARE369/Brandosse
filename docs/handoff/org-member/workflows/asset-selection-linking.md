# Workflow: Asset Selection and Linking

## Current Implemented Flow
1. Assets are uploaded/managed in `/library` (folders, metadata, approval, archive).
2. Calendar can open library picker and attach assets to posts via `org_post_asset_links`.
3. Asset service enriches asset origin metadata by post/pipeline/task joins.
4. Common room can send `asset_reference` messages.

## Expected Target Flow
- Members should be able to move between asset, post, pipeline item, and task with complete lineage and focused navigation.

## Breakpoints and Gaps Between Current and Target
- Origin links do not always deep-link to exact pipeline/task targets.
- Library page does not provide a direct "attach to selected draft/pipeline item" action path.
- Cross-page lineage visibility is partial.

## Required Integration Points to Close the Gap
- Add focused navigation from origin badges.
- Add direct attach flow in library detail pane.
- Add lineage viewer contract spanning asset, post, pipeline, and task entities.

## Suggested Order of Implementation
1. Implement focused deep links for existing origin links.
2. Add attach action from library to selected workflow target.
3. Add unified lineage drawer/service for cross-entity traceability.

