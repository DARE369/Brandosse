# Org Workspace Stage 5: Common Room Groups Implementation

Updated: 2026-03-27  
Stage status: implemented  
Validation status: `npm run build` passed

## What was implemented

### 1. Stage 5 schema slice for private groups

Added:

- `supabase/migrations/20260327040000_common_room_groups_stage5.sql`

This migration adds:

- `common_room_channels.group_admin_user_id`
- `common_room_channels.max_members`
- `common_room_channels.is_ai_enabled`
- `private_group` support in `common_room_channels.channel_type`
- a max-member constraint for private groups
- a preparation trigger that normalizes:
  - private-group membership
  - group-admin inclusion
  - AI-enabled defaults
  - member-limit enforcement
- `common_room_leave_channel(...)` RPC for safe leave behavior
- an expanded `get_common_room_channel_summaries(...)` payload with:
  - `group_admin_user_id`
  - `max_members`
  - `is_ai_enabled`

Current database behavior:

- private groups always keep the current group admin inside `member_ids`
- member limits are enforced in the database, not just in the UI
- leaving the last private-group member archives the group automatically
- if the current group admin leaves and members remain, admin ownership transfers to the next remaining member
- update RLS now allows either:
  - members with `can_create_channels`
  - the current private-group admin

### 2. AI enforcement in channel chat

Updated:

- `supabase/functions/ai-org-chat/index.ts`

Current behavior:

- `ai-org-chat` now reads `is_ai_enabled` from the channel row
- AI replies are rejected with `403` when AI is disabled for that channel
- credit logging remains channel-scoped through the existing `channel_id` path

This keeps Stage 5 aligned with the original requirement that private-group AI stays permissioned and auditable.

### 3. Common Room service and hook extensions

Updated:

- `src/org/services/commonRoomService.js`
- `src/org/hooks/useCommonRoom.js`

Current behavior:

- channel fetch normalization now includes:
  - `channel_type`
  - `member_ids`
  - `group_admin_user_id`
  - `max_members`
  - `is_ai_enabled`
- channel create and update flows now support private-group payloads
- `leaveChannel(...)` now calls the new `common_room_leave_channel` RPC
- AI request failures are normalized into deployment/permission-aware messages

Client-side safety behavior:

- member-limit validation runs before insert/update requests
- create/update still defer to DB constraints as the final authority

### 4. Channel creation flow now supports private groups

Updated:

- `src/org/components/common-room/CommonRoomChannelModal.jsx`

Current modal behavior:

- users with `can_create_channels` can now create either:
  - standard channels
  - private groups
- private-group creation supports:
  - member selection
  - automatic inclusion of the creating user as group admin
  - optional member limit
  - per-channel AI enablement
- the modal blocks submit when the selected member count exceeds the chosen limit

### 5. Common Room page now supports private-group operations

Updated:

- `src/org/pages/CommonRoom.jsx`
- `src/org/styles/CommonRoom.css`

Current UI behavior:

- the left rail now separates:
  - org-wide channels
  - brand-scoped channels
  - private groups
- channel cards now show badges for:
  - privacy
  - scope
  - AI enabled/disabled state
- the active channel header now surfaces group context and current group-admin identity for private groups
- the composer now supports `Ask AI` directly from Common Room
- AI requests:
  - send the user prompt into the channel first
  - then request a channel-scoped AI reply
  - refresh the message stream after the function responds

Private-group settings behavior:

- current private-group admins can:
  - rename the group
  - change description
  - move between org and brand scope
  - toggle AI
  - set member limit
  - add/remove members
  - transfer group admin
  - archive the group
- any private-group member can leave the group through the settings panel

Compatibility behavior:

- standard channels continue to use the existing org-wide / brand-scoped model
- private-group settings only appear when the active channel is a `private_group`
- the route structure remains unchanged under `/app/org/:orgId/common-room/:channelId`

## What was intentionally left out

These items were not completed in this Stage 5 pass:

1. **Per-message AI thread controls**
   - AI can reply inside the active channel
   - message-level regenerate / continue / quote-reply AI controls were not added

2. **Invite-by-email private-group flow**
   - group membership uses existing org members only
   - there is no private-group-specific invitation workflow yet

3. **Unread segmentation by group type**
   - unread counts work at the channel level
   - there is no separate “private group inbox” summary card yet

4. **Dedicated private-group analytics**
   - AI usage still logs credits correctly
   - no reporting surface was added for group activity, member participation, or AI usage by group

5. **Cross-group bulk management**
   - group admin transfer, membership edits, leave, and archive are implemented one channel at a time
   - no bulk group admin tool was added

## How the system works now

### Standard channels

- org-wide and brand-scoped channels continue to work as before
- they now also carry `is_ai_enabled`, so AI can be turned off without removing channel access

### Private groups

- private groups appear as first-class channels in Common Room
- access is limited to members listed in `member_ids`
- the group admin can manage membership and settings without requiring full org-channel permission
- members can leave safely through the RPC-backed flow

### AI replies

- AI replies can now be triggered directly from Common Room
- the request remains channel-scoped and uses the existing org AI function
- if the active Supabase project is missing the `ai-org-chat` deployment, the UI now surfaces a direct deployment-oriented error instead of a generic failure

### Admin ownership

- the current group admin is explicit in both data and UI
- transferring group admin is handled as a normal channel update
- leaving a private group uses server-side ownership rules so group state stays valid

## Stage 5 deviations from the original staged spec

These were deliberate and match the current repo structure:

1. **Channel route preserved**
   - Stage 5 was implemented inside the existing `CommonRoom.jsx` route instead of introducing a second group workspace

2. **Service-first client integration**
   - the staged spec focused on group capability
   - this implementation kept all write paths behind `commonRoomService.js` and `useCommonRoom.js` for consistency with the repo

3. **AI ask flow embedded in composer**
   - instead of a separate AI side panel, the existing composer now supports channel-scoped AI replies directly

## Validation completed

Executed:

```bash
npm run build
```

Result:

- success
- Stage 5 client and schema integration build cleanly with the private-group UI and Common Room service changes
