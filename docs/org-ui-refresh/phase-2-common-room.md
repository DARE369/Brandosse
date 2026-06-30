# Phase 2: Common Room

## Goal
Refresh `Common Room` into a real collaboration surface that fits the new editorial UI direction while also fixing the current product gaps around routing, unread state, sender identity, channel management, and structured references to assets and pipeline items.

## What Changed
- Rebuilt the Common Room page into a three-pane layout:
  - grouped channel rail for `Org-wide` and current `Brand-scoped` channels
  - center chat rail with richer message cards, date separators, and a composer toolbar
  - right-side `Members & Settings` panel that becomes a drawer on smaller screens
- Made channel selection route-driven through `/app/org/:orgId/common-room/:channelId`.
  Invalid or inaccessible channel ids now fall back to the first accessible channel.
- Replaced generic sender labels with resolved member identity:
  user messages now show initials, member name, role label, and timestamp
  AI messages keep a distinct visual treatment and label
- Added real channel creation and management UI for org-wide and current-brand channels.
  Users with `can_create_channels` can create, edit, and archive channels from the page.
- Added real structured reference flows from the composer:
  - asset references through a Common Room asset picker backed by org assets
  - pipeline references through a Common Room pipeline picker backed by org pipeline items
- Kept explicit AI composer actions deferred.
  Existing AI messages still render correctly if they already exist in the channel history.

## Data / Service / Migration Changes
- Added `supabase/migrations/20260325130000_common_room_reads_and_summaries.sql`.
  It introduces:
  - `public.common_room_channel_reads`
  - `public.get_common_room_channel_summaries(...)`
  - RLS for channel read rows
  - Common Room channel write-policy alignment with `public.get_member_permission(organization_id, 'can_create_channels')`
- Updated `src/org/services/commonRoomService.js`:
  - `fetchChannels()` now reads summary-enriched channel rows from the SQL function, with fallback to raw channel reads if the function is unavailable
  - added `createChannel(...)`
  - added `updateChannel(...)`
  - added `archiveChannel(channelId)`
  - added `markChannelRead(...)`
  - hardened `fetchMessages()` against invalid channel ids during route fallback
- Updated `src/org/hooks/useCommonRoom.js`:
  - loads channel summaries, messages, and org members
  - subscribes to realtime updates for channels, messages, and current-user read state
  - marks the newest visible message as read for the active channel
  - exposes channel-management helpers to the page
- Added Common Room page components:
  - `src/org/components/common-room/CommonRoomChannelModal.jsx`
  - `src/org/components/common-room/CommonRoomAssetPicker.jsx`
  - `src/org/components/common-room/CommonRoomPipelinePicker.jsx`

## UI States Covered
- channel loading state
- no-channel empty state
- route fallback when the URL channel id is missing or invalid
- active channel with messages
- active channel with no messages
- unread counts on inactive channels
- settings panel on desktop
- settings drawer on narrower screens
- create-channel modal
- asset reference picker with optional embedded upload
- pipeline reference picker
- disabled edit/create actions for users without `can_create_channels`
- disabled brand-scoped create/edit when no active brand is selected

## Verification
- `npm run build` passed on `2026-03-25`.
- The previous dynamic import warning tied to the old Common Room send path is gone because the page now uses the existing auth context directly.
- I did not run browser-based manual QA in this pass, so channel creation, unread clearing, archive flows, and reference insertion still need click-through verification against a migrated database.

## Left Out
- private or member-limited channel creation and membership management
- threaded replies
- reactions
- message editing
- file attachments
- explicit `Ask AI` composer action
- AI session browsing UI
- deep linking into a specific asset inside the library page

## Known Risks
- The new unread counts and summary-driven channel rail depend on the new migration being applied.
  Without that migration, the frontend falls back to raw channels, but unread counts and last-message summaries will be limited.
- Existing private channels remain readable if already accessible through current RLS, but Phase 2 does not provide UI to manage `member_ids`.
- The pipeline reference picker intentionally stays scoped to org context plus current brand visibility, not a page-local all-brand selector.
- Read-state refresh currently favors correctness over minimizing reloads, so very active channels may trigger frequent summary refreshes.

## Theme Alignment Note
- On `2026-03-26`, the final Common Room styling was aligned to the default org dashboard dark theme instead of the earlier amber/editorial treatment.
- The three-pane Phase 2 layout, route-driven navigation, unread handling, and structured reference flows remain unchanged.
- The final visual system now uses org workspace tokens and typography:
  - `var(--org-*)` color tokens
  - `var(--font-display)` / `Sora` for headings
  - `var(--font-body)` / `Manrope` for body copy
