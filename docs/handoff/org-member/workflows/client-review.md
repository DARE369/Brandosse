# Workflow: Client Review

## Current Implemented Flow
1. External reviewer opens `/review/:clientReviewToken`.
2. Page calls `pipeline-client-action` with `action = preview`.
3. Reviewer selects approve or request changes and optional comment.
4. Backend applies action on pipeline item and marks token as used.
5. Subsequent attempts return completed state.

## Expected Target Flow
- Internal member workflow should explicitly create, monitor, and revoke client review links with full stage-aware visibility.

## Breakpoints and Gaps Between Current and Target
- Backend link generation exists, but Stage 4 route pages do not clearly expose it.
- Internal pages do not show full link lifecycle status to members.
- Reviewer context is minimal and not brand-tailored.

## Required Integration Points to Close the Gap
- Add member UI action to generate/reissue client-review links.
- Expose link status and lifecycle metadata on pipeline/calendar surfaces.
- Add optional richer review context payload for external reviewer.

## Suggested Order of Implementation
1. Wire link generation into review-capable member UI with stage checks.
2. Add internal visibility of token lifecycle and review outcome status.
3. Add optional branded reviewer context and structured feedback categories.

