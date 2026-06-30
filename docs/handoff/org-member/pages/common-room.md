# Org Member Page: Common Room

## Page Purpose (Plain Language)
This page is the collaboration hub for organization members. It supports channel-based discussion, private groups, asset and pipeline references, and optional AI-assisted responses.

## Route and Access Rules
- Routes:
  - `/app/org/:orgId/common-room`
  - `/app/org/:orgId/common-room/:channelId`
- Guard: `OrgMemberRoute`
- Channel-level access rules:
  - private-group membership and manager checks
  - brand-scope access through org membership scope and brand permissions
  - AI reply usage gated by channel and permissions

## Component Composition
- Container: `src/org/pages/CommonRoom.jsx`
- Key child domains:
  - channel list (org, brand, private groups)
  - message stream with date separators
  - composer with send and Ask AI
  - settings panel for channel management
  - `CommonRoomChannelModal`
  - `CommonRoomAssetPicker`
  - `CommonRoomPipelinePicker`

## State, Hooks, Services Used
- `useCommonRoom` for channels/messages/members loading, send/create/update/archive/leave, and AI request.
- `useOrgAssets` for asset picker source.
- `usePipelineItems` for pipeline reference picker source.
- `useOrgContext` and `useAuth` for org/user permissions and identity.
- `commonRoomService` for table/RPC/edge access.

## Data Contracts Touched
- Reads:
  - `common_room_channels`
  - `common_room_messages`
  - `common_room_channel_reads`
  - `organization_members`
  - `profiles`
  - `org_asset_library`
  - `pipeline_items`
- Writes:
  - `common_room_channels`
  - `common_room_messages`
  - `common_room_channel_reads`
- RPCs:
  - `get_common_room_channel_summaries`
  - `common_room_leave_channel`
- Edge:
  - `ai-org-chat`
- Realtime:
  - `common_room_channels`
  - `common_room_messages`
  - `common_room_channel_reads`

## Inbound Dependencies
- Sidebar route entry.
- Notification center routes into channel-specific paths.
- Org shell notification aggregation consumes common-room unread signals.

## Outbound Dependencies
- Message references route to `/library` and `/pipeline`.
- Channel settings and channel type changes affect organization collaboration topology.
- AI responses create credit/session side effects through backend contracts.

## Current Working Relationships
- Channel summaries include unread counts and last-message previews.
- Message send, channel create/update/archive/leave are operational.
- Asset and pipeline references can be embedded in chat messages.
- AI response flow is connected to channel context and credits.

## Missing or Partial Relationships
- Reference clicks route to destination page roots and do not consistently preserve entity focus.
- No thread model linked to specific pipeline items or tasks.
- No structured cross-reference panel to show all messages related to one asset/pipeline item.

## No Relation Exists Yet
- No explicit relation to task-level collaboration state from this page.
- No automatic subscription linkage where pipeline stage changes post back into a related channel thread.

## Recommended Wiring Contract
- Define typed message-reference payload schema with required ids and optional display fields.
- Add focused deep-link support from references into pipeline/calendar/library.
- Add optional thread key contract (`pipeline_item_id`, `task_id`, `post_id`) for contextual discussions.

## Risks If Wired Incorrectly
- Channel scope or membership errors can leak private-group discussions.
- Untyped reference metadata can break navigation silently and create trust issues.

