# Workflow: Common-Room Collaboration

## Current Implemented Flow
1. Member opens common-room route and channel is resolved.
2. Channel summaries/messages/members load; realtime subscriptions keep state current.
3. Members send messages, attach asset/pipeline references, and optionally request AI replies.
4. Read markers update `common_room_channel_reads`.
5. Notification center incorporates unread common-room activity.

## Expected Target Flow
- Collaboration should support strong context threading with deep links to exact workflow entities and predictable reference schemas.

## Breakpoints and Gaps Between Current and Target
- Reference metadata is partial and destination routing is often page-level.
- No thread model tied to one pipeline item/task/post lifecycle.
- Cross-channel workflow traceability is limited.

## Required Integration Points to Close the Gap
- Define typed message-reference contract and validation.
- Add deep-link resolvers on destination pages.
- Add optional contextual thread key support for workflow entities.

## Suggested Order of Implementation
1. Standardize and validate reference metadata payloads.
2. Add focused deep-link support to pipeline/calendar/library.
3. Add workflow-thread conventions and UI filters.

