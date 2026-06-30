# Workflow: Generation to Post Lifecycle

## Current Implemented Flow
1. User prompts in `/app/generate`.
2. `SessionStore` ensures active `sessions` row.
3. Generation path:
   - single: content plan -> generation insert -> edge generation completion update
   - carousel: planner -> placeholder rows -> per-slide generation update
   - edit/video: specialized insert + provider polling/update
4. For completed generation, draft `posts` row is ensured.
5. `content_library_items` post row is ensured where applicable.
6. Post production panel hydrates/edits caption, hashtags, platforms, schedule.
7. Save draft or publish action writes to `posts`.

## Expected Target Flow
- Unified and explicit state machine across all generation modes and post lifecycle states.

## Breakpoints and Gaps
- Parallel legacy service layers can create orchestration ambiguity.
- Multi-account publish writes occur as multiple operations without explicit idempotency envelope.
- Optional org scope path exists in personal generate only through route state injection.

## Required Integration Points
- Canonical orchestration contract for generation providers and fallback behavior.
- Publish request id and dedupe semantics for repeated publish actions.
- Explicit org-scope guardrails if personal pages continue supporting org route-state handoff.

## Suggested Implementation Order
1. Canonicalize generation orchestration service.
2. Add idempotent publish request layer.
3. Add integration tests for single, carousel, edit, and video paths.
