# Org Workspace Reference: My Office, Common Room, and Asset Library

## Document Goal
This document explains the org workspace as it exists in the current codebase, with special focus on:

- `My Office`
- `Common Room`
- `Shared Asset Library`

It covers both:

- non-technical understanding: what each space is for, who uses it, and how it fits into the org workflow
- technical understanding: routes, components, hooks, services, database tables, RLS policies, edge functions, and current implementation gaps

It also explicitly calls out:

- what is working today
- what is thin but present
- what is not working or is currently inconsistent

This write-up reflects the current repository state on `2026-03-25`.

---

## 1. Executive Summary

### Non-technical mental model
The org workspace currently has three major collaboration surfaces:

1. `My Office`
   This is the member's personal desk inside the org. It is where org-scoped drafts are created, edited, saved, and then submitted into the review pipeline.

2. `Common Room`
   This is the team's shared communication space. It is meant to support general conversation, scoped collaboration by brand project, and AI-assisted discussion.

3. `Shared Asset Library`
   This is the organization's reusable media and reference repository. It is where approved images, videos, documents, prompt templates, and brand assets live for reuse across drafts, posts, and calendar scheduling.

### High-level product relationship
The intended product flow is:

1. Create or refine content in `My Office`
2. Submit it to the `Pipeline`
3. Move approved content into the `Calendar`
4. Support that work with reusable materials from the `Asset Library`
5. Discuss, coordinate, and eventually involve AI in the `Common Room`

That overall flow is mostly visible in the architecture, but it is not equally mature in every surface:

- `My Office` is conceptually central, but currently has a real submit bug and some scoping issues.
- `Common Room` has the database and AI backend foundations, but the UI is still minimal and does not expose the more advanced capabilities.
- `Asset Library` is the strongest of the three from a CRUD and integration standpoint, especially because it already connects to the calendar and post asset links.

---

## 2. Org Workspace Architecture

## 2.1 Shared shell and routing

### Main org workspace shell
Core files:

- `src/layouts/OrgWorkspaceShell.jsx`
- `src/org/context/OrgContextProvider.jsx`
- `src/org/components/OrgSidebar.jsx`
- `src/org/components/OrgTopNavbar.jsx`
- `src/org/hooks/useOrgContext.js`
- `src/org/stores/orgRuntimeStore.js`
- `src/router/router.jsx`

### What these pieces do

- `OrgWorkspaceShell.jsx`
  Wraps every org page with the shared top navbar, sidebar, content area, and toast system.

- `OrgContextProvider.jsx`
  Loads the active organization, membership, role, permissions, brand projects, and active brand project from the current route's `orgId`.

- `OrgSidebar.jsx`
  Exposes the org workspace route structure:
  - Overview
  - My Office
  - Pipeline
  - Calendar
  - Asset Library
  - Common Room
  - Team Activity
  - Admin pages for Members, Roles, Pipelines, Credits, Settings

- `OrgTopNavbar.jsx`
  Provides workspace switching, brand project switching for agency orgs, credit visibility, a bell shortcut that currently routes to Common Room, and a profile menu shortcut back to My Office.

- `orgRuntimeStore.js`
  Stores active org and brand-project scope outside React context so non-React store logic can still persist org-scoped drafts/posts/assets.

### Important architectural point
The org workspace is not just a set of pages. It is a shared runtime context.

That runtime context is used by:

- `OrgGenerateComposer`
- `SessionStore`
- `assetLibraryService`
- `pipelineService`
- `useCommonRoom`
- `useOrgAssets`
- `useOrgCalendar`

So when the member changes org or brand project, that affects what data is read and written across multiple surfaces.

---

## 2.2 Org route map and page relationships

From `src/router/router.jsx`, the org routes are:

- `/app/org/:orgId/overview`
- `/app/org/:orgId/office`
- `/app/org/:orgId/pipeline`
- `/app/org/:orgId/calendar`
- `/app/org/:orgId/library`
- `/app/org/:orgId/common-room`
- `/app/org/:orgId/common-room/:channelId`
- `/app/org/:orgId/team-activity`
- `/app/org/:orgId/admin/members`
- `/app/org/:orgId/admin/roles`
- `/app/org/:orgId/admin/pipelines`
- `/app/org/:orgId/admin/credits`
- `/app/org/:orgId/admin/settings`

### How the three surfaces relate to the rest of the org pages

| Surface | Main relationship to other pages |
| --- | --- |
| My Office | Feeds Pipeline, indirectly feeds Calendar, depends on Admin Pipelines for review rules, depends on Roles/Permissions for who can later publish/schedule |
| Common Room | Lives as a collaboration surface in parallel with the rest of the workspace; linked from top nav bell; technically tied to Credits when AI chat is used |
| Asset Library | Feeds Calendar and post asset linking directly; can seed new draft creation through calendar library picker; depends on Roles/Permissions for approvals and management |

### Other important page relationships

- `Overview`
  Summarizes scheduled content, approved queue, pipeline review load, and recent asset activity.

- `Pipeline`
  Receives items from My Office through `submitPostToPipeline`.

- `Calendar`
  Uses posts, pipeline items, and asset links. This is the strongest point of integration between content operations and the asset library.

- `Team Activity`
  Currently acts more like a lightweight recent pipeline feed than a true cross-surface activity stream.

- `Admin Members`
  Determines who is a member and what role they have.

- `Admin Roles`
  Controls permissions like:
  - `can_publish`
  - `can_schedule`
  - `can_manage_library`
  - `can_approve_library_uploads`
  - `can_create_channels`

- `Admin Pipelines`
  Defines the pipeline templates that My Office submissions use.

- `Admin Credits`
  Matters especially for AI-assisted org actions, including the Common Room AI function.

- `Admin Settings`
  Holds org-level configuration such as preferred AI model in `organization.settings`.

---

## 2.3 Shared org data foundations

### Core tables behind the whole org workspace
Relevant migrations:

- `supabase/migrations/20260312153000_admin_foundation.sql`
- `supabase/migrations/20260324100000_org_workspace_foundation.sql`
- `supabase/migrations/20260324150000_org_posts_generations_columns.sql`
- `supabase/migrations/20260324160000_org_rls_policies.sql`
- `supabase/migrations/20260324170000_org_helper_functions.sql`
- `supabase/migrations/20260324180000_org_seed_plan_data.sql`

### Foundation tables

- `organizations`
  The top-level org workspace container.

- `organization_members`
  The user's membership, role, permissions override, brand-project scope, and credit usage.

- `brand_projects`
  Brand-scoped sub-contexts within the org. Agency workspaces surface this in the UI.

- `org_role_templates`
  Role definitions and permission bundles.

- `context_last_used`
  Stores the last org and brand project a user used.

- `organization_plans`
  Defines plan features like `approval_pipeline`, `common_room`, `shared_library`, and `brand_projects`.

### Important implementation detail
The plan system exists in the database, but the org sidebar and org routing do not appear to actively hide or hard-gate `My Office`, `Common Room`, or `Asset Library` based on `organization_plans.features`.

That means feature flags are modeled in data, but current page exposure is mostly static.

---

## 2.4 Shared permission model

Permission definitions live in:

- `src/org/services/orgService.js`
- `src/org/constants/permissions.js`
- `supabase/functions/_shared/org.ts`
- `supabase/migrations/20260324160000_org_rls_policies.sql`

The key permissions most relevant to these surfaces are:

- `can_publish`
- `publish_requires_final_approval`
- `can_schedule`
- `can_manage_library`
- `can_approve_library_uploads`
- `can_create_channels`
- `can_invite_members`
- `monthly_credit_limit`

### Important architectural point
Permissions are enforced in multiple layers:

1. UI visibility and button enablement
2. client-side service decisions
3. RLS policies
4. Supabase edge functions

This is good in principle, but there are still inconsistencies between layers, especially in the Asset Library upload flow.

---

## 3. My Office

## 3.1 What My Office is, non-technically
`My Office` is meant to be the org member's personal workspace inside the shared org environment.

Think of it as:

- your personal draft desk
- your org-scoped generation workspace
- the handoff point into the approval pipeline

It is not meant to be the final team operations surface. It is the place where content is still private-to-author or at least author-driven before it becomes a workflow item.

---

## 3.2 Main files involved

UI and state:

- `src/org/pages/MyOffice.jsx`
- `src/org/components/OrgGenerateComposer.jsx`
- `src/components/Generate/PostProductionPanel.jsx`
- `src/stores/SessionStore.js`
- `src/org/stores/orgRuntimeStore.js`

Data/services:

- `src/org/services/orgService.js`
- `src/org/services/pipelineService.js`
- `src/org/hooks/usePipelineItems.js`
- `src/org/hooks/useOrgContext.js`

Related downstream surfaces:

- `src/org/pages/PipelineBoard.jsx`
- `src/org/pages/OrgCalendar.jsx`
- `src/org/pages/OrgOverview.jsx`

---

## 3.3 How My Office works today

### User-facing behavior
The page has two main panels:

1. `Your Drafts`
   Shows draft posts owned by the current member inside the active organization.

2. `In the Pipeline`
   Shows recent pipeline items and links the user into the pipeline board.

The page also opens `OrgGenerateComposer` for:

- new draft creation
- continuing an existing draft

### What happens when a user creates or edits content

1. `MyOffice.jsx` opens `OrgGenerateComposer`
2. `OrgGenerateComposer` works on top of the shared generation/session stack
3. `SessionStore` uses `orgRuntimeStore` to apply current org scope to saved posts/generations
4. draft content is stored in `posts` with:
   - `organization_id`
   - `brand_project_id`
   - `status = draft`
5. later, a draft can be submitted to the pipeline

### What happens when a draft is saved
Draft save is handled inside `SessionStore.saveDraft()`:

- it builds the final caption
- it reuses an existing draft post when possible
- otherwise it inserts a new `posts` row
- it syncs org scope into the row
- it ensures a `content_library_items` row exists for the post
- if asset references exist, it syncs them into `org_post_asset_links`
- it dispatches the `socialai:data-sync` browser event

That event is important because `MyOffice.jsx` listens for it and reloads drafts after content changes.

---

## 3.4 My Office data model

### Directly relevant tables

#### `posts`
My Office drafts are stored here.
Important fields:

- `id`
- `user_id`
- `generation_id`
- `organization_id`
- `brand_project_id`
- `pipeline_item_id`
- `caption`
- `status`
- `scheduled_at`

### `generations`
The original generated media/prompt context behind the draft.
Important fields used by My Office:

- `id`
- `organization_id`
- `brand_project_id`
- `prompt`
- `storage_path`
- `media_type`

### `pipeline_items`
Created when a draft is submitted.

### `pipeline_configs`
Determines which review flow a draft enters.

### `org_post_asset_links`
Optional links from a draft/post to reusable library assets.

### `content_library_items`
This is not org-specific, but `SessionStore` still mirrors saved posts into it, so My Office content participates in the wider library/history system.

---

## 3.5 My Office database and migration dependencies

Key migrations:

- `20260324150000_org_posts_generations_columns.sql`
  Adds org and brand scope to `posts` and `generations`, plus `pipeline_item_id` to `posts`.

- `20260324110000_org_pipeline_tables.sql`
  Defines `pipeline_configs` and `pipeline_items`.

- `20260324160000_org_rls_policies.sql`
  Adds org read/write access for posts, generations, pipeline configs, and pipeline items.

- `20260325110000_org_calendar_view_presets_and_asset_links.sql`
  Adds `org_post_asset_links`, which My Office can use when asset references are attached to a post.

- `20260324170000_org_helper_functions.sql`
  Adds triggers that sync org scope between generations and posts.

---

## 3.6 My Office service and function flow

### Client-side services and hooks

- `fetchOrgDrafts({ organizationId, userId })`
  Reads draft rows from `posts`.

- `submitPostToPipeline({ organizationId, brandProjectId, post, userId, ... })`
  Inserts into `pipeline_items` and writes `posts.pipeline_item_id`.

- `usePipelineItems()`
  Reads pipeline items and subscribes to realtime changes on `pipeline_items`.

- `SessionStore.saveDraft()`
  Writes or updates draft posts.

- `SessionStore.publishContent()`
  Schedules or publishes posts directly from the composer using org scope.

### Important note about edge functions
`My Office` itself does not directly call an org edge function when submitting a draft into review.
That submit path is a direct client-side insert/update through `pipelineService.submitPostToPipeline()`.

The downstream edge functions belong to later stages:

- `pipeline-advance`
- `pipeline-generate-client-link`
- `pipeline-client-action`
- `org-calendar-publish`

So My Office is the pipeline entry point, not the full pipeline executor.

---

## 3.7 How My Office relates to all other pages

### `Overview`
- Overview does not read My Office directly.
- It reads calendar and pipeline aggregates, so My Office only affects Overview after drafts are submitted or scheduled.

### `Pipeline`
- This is the strongest direct relationship.
- My Office creates the inputs that become `pipeline_items`.
- Pipeline empty states explicitly tell users to submit from My Office.

### `Calendar`
- My Office can save drafts and publish/schedule posts.
- Once a post is scheduled, it becomes calendar-visible.
- If a draft is submitted and approved, it moves into the calendar queue later.

### `Asset Library`
- There is a data relationship through `org_post_asset_links`.
- The composer can persist asset references to draft/post rows.
- However, My Office does not currently expose a direct "browse the asset library" interaction from its own page.

### `Common Room`
- There is no strong direct integration today.
- The surfaces live in the same org shell and share org/brand context, but My Office does not post activity into Common Room.

### `Team Activity`
- Team Activity only reflects pipeline items, so My Office affects it indirectly after submission.

### `Admin Pipelines`
- Admin pipeline configuration directly controls what happens when My Office content is submitted.

### `Admin Roles`
- Role templates affect who can later review, schedule, publish, or manage attached assets.

### `Admin Credits`
- Credits matter for generation workflows and AI usage more broadly, but My Office itself is not where the credit rules are explained.

---

## 3.8 What is working in My Office

- The page loads org-scoped draft posts for the current user via `fetchOrgDrafts`.
- The page opens the org-scoped composer for new or existing drafts.
- The composer uses current org and brand-project scope through `orgRuntimeStore`.
- Draft save flow writes org-scoped posts successfully through `SessionStore.saveDraft()`.
- Publishing/scheduling from the composer uses org scope and can create/update org-scoped posts.
- My Office refreshes after content changes through the `socialai:data-sync` event.
- The page reads pipeline items through `usePipelineItems()` and reacts to realtime `pipeline_items` updates.

---

## 3.9 What is broken or incomplete in My Office

### Broken now

- `handleSubmitDraft()` in `src/org/pages/MyOffice.jsx` passes `brandProjectId`, but that variable is not defined in the component.
  This means the `Submit` action is currently at risk of throwing at runtime when clicked.

- The `In the Pipeline` panel is labeled as if it is the current user's pipeline work, but it actually uses:
  - `const myPipelineItems = pipelineItems.slice(0, 8);`
  This means it shows the first eight org pipeline items, not the current member's pipeline items.

### Thin or incomplete

- Draft fetching is scoped by organization and user, but not by active brand project.
  So in an agency org, My Office may show the user's drafts across brand projects rather than the currently selected one.

- There is no direct draft deletion flow.

- There is no direct per-draft rename or metadata editing flow outside the composer.

- There is no item-specific deep link into the pipeline item; the page navigates to the general pipeline board.

- My Office does not directly expose asset-library browsing, even though the composer and data model support asset references.

- My Office is still heavily dependent on the shared generation stack from the personal product side, so its behavior is partly inherited rather than fully purpose-built for org workflows.

---

## 4. Common Room

## 4.1 What Common Room is, non-technically
`Common Room` is the team's shared collaboration space inside the org workspace.

Think of it as:

- the org chat room
- a brand-scoped or org-wide discussion surface
- the future home of AI-assisted team ideation

The data model is broader than the current UI. The schema clearly expects channels, scoped participation, AI sessions, threaded replies, reactions, and references to files or pipeline items. The page UI today exposes only a simple channel list and text message composer.

---

## 4.2 Main files involved

UI and state:

- `src/org/pages/CommonRoom.jsx`
- `src/org/hooks/useCommonRoom.js`
- `src/org/styles/CommonRoom.css`

Client service layer:

- `src/org/services/commonRoomService.js`

Edge/backend:

- `supabase/functions/ai-org-chat/index.ts`
- `supabase/functions/_shared/org.ts`

Bootstrap/setup:

- `supabase/functions/_shared/org-bootstrap.ts`

Schema:

- `supabase/migrations/20260324120000_org_common_room_tables.sql`
- `supabase/migrations/20260324160000_org_rls_policies.sql`

---

## 4.3 How Common Room works today

### User-facing behavior
The page does three visible things:

1. Loads available channels
2. Loads messages for the active channel
3. Allows the user to send a plain text message into that channel

The route supports:

- `/common-room`
- `/common-room/:channelId`

The page shows:

- channel list in the sidebar
- active channel name
- a generic `Brand scoped` or `Org wide` badge
- flat message list
- textarea composer

### Realtime behavior
`useCommonRoom()` subscribes to realtime changes on `common_room_messages` for the active channel. When a message changes, it refetches messages for that channel.

That means:

- message updates are live
- channel list updates are not live

---

## 4.4 Common Room data model

### Directly relevant tables

#### `common_room_channels`
Represents channels.
Important fields:

- `id`
- `organization_id`
- `brand_project_id`
- `name`
- `description`
- `channel_type`
- `is_default`
- `member_ids`
- `created_by`
- `is_archived`

#### `common_room_messages`
Represents messages inside channels.
Important fields:

- `id`
- `channel_id`
- `organization_id`
- `sender_id`
- `sender_type`
- `content`
- `content_type`
- `metadata`
- `reply_to_id`
- `reactions`
- `is_deleted`
- `edited_at`
- `created_at`

#### `ai_session_logs`
Represents AI-session accounting and metadata for Common Room style conversations.
Important fields:

- `session_key`
- `organization_id`
- `brand_project_id`
- `channel_id`
- `initiated_by`
- `session_type`
- `model_used`
- `credits_consumed`
- `message_count`

### Indirectly relevant tables

- `organizations`
  Holds organization settings including AI model preferences and credit totals.

- `organization_members`
  Enforces membership, permissions, and credit usage.

- `brand_projects`
  Controls brand-scoped channel access and AI prompt grounding.

- `credit_events`
  Stores AI usage events when the AI chat function is used.

---

## 4.5 Common Room database and policy behavior

### Read rules
Members can read channels if:

- they are active org members
- they have brand-project access where relevant
- and either:
  - `member_ids` is null, or
  - their `auth.uid()` is included in `member_ids`

Messages can be read if:

- the user is an active org member
- the message belongs to a channel the user can access

### Write rules

- Members can insert messages only if:
  - `sender_id = auth.uid()`
  - they are active org members
  - they have access to the channel

- Channel creation/update is restricted to:
  - `org_owner`
  - `org_admin`
  - `editor`

### Important architectural point
The database and RLS clearly support richer collaboration than the page currently shows.

Supported in schema/policies:

- private channels via `member_ids`
- multiple channel types
- replies via `reply_to_id`
- reactions via `reactions`
- edit state via `edited_at`
- non-text content types like:
  - `file`
  - `asset_reference`
  - `pipeline_reference`
  - `ai_response`

Exposed in UI today:

- flat text messages only

---

## 4.6 Common Room service and function flow

### Client side

- `fetchChannels({ organizationId, brandProjectId })`
  Reads channels, filtered to:
  - the org
  - unarchived channels
  - org-wide channels plus the selected brand project when applicable

- `fetchMessages(channelId)`
  Reads up to 200 non-deleted messages in ascending time order.

- `sendMessage(payload)`
  Inserts a message directly into `common_room_messages`.

- `requestAiChannelReply(payload)`
  Invokes the `ai-org-chat` edge function, but the current page does not use it.

### Edge function: `ai-org-chat`
This function is already more advanced than the current UI.

It does the following:

1. requires the user to be an active org member
2. validates channel access, including `member_ids`
3. validates brand-project access
4. checks credit availability
5. loads:
   - organization settings
   - brand project settings
6. builds a system prompt grounded in org + brand settings
7. calls the LLM via `_shared/llm.ts`
8. inserts an AI message into `common_room_messages`
9. writes or updates `ai_session_logs`
10. records credit usage in `credit_events`
11. increments:
    - `organization_members.credits_used_this_period`
    - `organizations.credits_used_this_period`

This means Common Room already has a real backend foundation for AI collaboration, even though the page UI does not yet expose it.

---

## 4.7 How Common Room relates to all other pages

### `Overview`
- No direct overview card or feed is built around Common Room activity.
- Overview does not currently summarize channel volume, active conversations, or AI chat sessions.

### `My Office`
- Conceptually complementary: Office is individual creation; Common Room is shared discussion.
- Practically, they are still loosely connected. There is no "send draft to room" or "discuss this draft" integration.

### `Pipeline`
- The `common_room_messages` schema supports `pipeline_reference`, but the UI does not expose pipeline-linked messages.

### `Calendar`
- There is no current calendar-to-room collaboration shortcut.

### `Asset Library`
- The schema supports `asset_reference` content type, but the UI does not expose asset-linked messages.

### `Admin Credits`
- This is the strongest admin relationship today because Common Room AI chat consumes org/member credits.

### `Admin Roles`
- `can_create_channels` exists here, but there is no channel creation UI in the page yet.

### Top navbar
- The bell icon routes to Common Room, but this is a shortcut, not a true notification center.

---

## 4.8 What is working in Common Room

- Channels can be fetched for the active organization and brand project.
- Messages can be fetched for the active channel.
- Members can send plain text messages.
- Message updates are realtime for the active channel.
- Default `General` channel bootstrap exists in `_shared/org-bootstrap.ts`.
- Channel/member access checks are present in both RLS and the AI edge function.
- AI reply infrastructure exists end-to-end on the backend:
  - org membership check
  - brand access check
  - credits check
  - prompt grounding
  - AI message insertion
  - session logging
  - credit recording

---

## 4.9 What is broken or incomplete in Common Room

### Not wired in UI yet

- The page never calls `requestAiChannelReply()`.
  The backend exists, the hook exposes it, but the UI has no button or flow for AI participation.

- There is no UI to create, edit, archive, or manage channels even though:
  - permissions exist
  - RLS exists
  - schema supports it

### Schema richer than UI

- replies are modeled, but there is no threaded reply UI
- reactions are modeled, but there is no reaction UI
- edit state is modeled, but there is no edit-message UI
- rich message types are modeled, but only text rendering is implemented
- private/member-scoped channels are modeled, but there is no UI to manage membership lists
- AI session logs exist, but there is no UI for browsing them

### Presentational and routing gaps

- Clicking a channel updates local state, but the page does not appear to push the selected channel into the URL.
  The route supports `:channelId`, but the active selection is not deep-linked on user click.

- Channel display is generic:
  - team messages render as `Team Member`
  - AI messages render as `AI Assistant`
  There is no profile/name resolution in the page UI.

- The header shows only:
  - `Brand scoped`
  - `Org wide`
  It does not show the actual brand project name.

- There is no unread/read model or notification state.

- The top-nav bell is not a real notification center. It is currently just a navigation shortcut to Common Room.

- There is no realtime subscription for the channel list itself, only for messages.

---

## 5. Shared Asset Library

## 5.1 What the Asset Library is, non-technically
The `Shared Asset Library` is the reusable asset warehouse for the org.

Think of it as:

- the shared filing cabinet
- the media shelf
- the reusable prompt and reference bank

It is meant to serve:

- current draft creation
- future campaign work
- scheduling in the calendar
- org-wide brand consistency

This surface is already integrated more deeply than Common Room, especially because asset links can persist onto posts and show up later in the calendar.

---

## 5.2 Main files involved

Page and hooks:

- `src/org/pages/OrgAssetLibrary.jsx`
- `src/org/hooks/useOrgAssets.js`
- `src/org/hooks/useOrgContext.js`

Services:

- `src/org/services/assetLibraryService.js`

UI components:

- `src/org/components/OrgAssetUploadModal.jsx`
- `src/org/components/calendar/CalendarLibraryPicker.jsx`

Edge/backend:

- `supabase/functions/org-asset-upload/index.ts`

Schema:

- `supabase/migrations/20260324130000_org_asset_library_table.sql`
- `supabase/migrations/20260324160000_org_rls_policies.sql`
- `supabase/migrations/20260325110000_org_calendar_view_presets_and_asset_links.sql`

Cross-surface consumers:

- `src/stores/SessionStore.js`
- `src/org/services/orgCalendarService.js`
- `src/org/pages/OrgCalendar.jsx`

---

## 5.3 How the Asset Library works today

### User-facing behavior
The page has three zones:

1. left sidebar
   - search
   - smart collections
   - folder filter

2. center grid
   - asset cards
   - density switcher
   - collection results

3. right detail panel
   - preview
   - status
   - folder
   - tags
   - usage count
   - action buttons

There is also an upload modal:

- `OrgAssetUploadModal`

### Available page actions

- search assets
- filter by collection:
  - all
  - recent
  - mine
  - brand
  - pending
  - archived
- filter by folder
- change grid density
- open asset detail
- upload asset
- approve pending asset
- toggle brand-asset flag
- archive or restore asset

### Important cross-surface behavior
The library is not just a standalone gallery.
It also supports:

- selecting assets inside the calendar workflow through `CalendarLibraryPicker`
- attaching asset references to posts through `SessionStore`
- reading those asset links back into calendar records

So the current asset library is part catalog, part operations input.

---

## 5.4 Asset Library data model

### Direct table: `org_asset_library`
Important fields:

- `id`
- `organization_id`
- `brand_project_id`
- `asset_level`
- `uploaded_by`
- `name`
- `description`
- `file_url`
- `thumbnail_url`
- `file_type`
- `mime_type`
- `file_size_bytes`
- `tags`
- `folder_path`
- `approval_status`
- `approved_by`
- `approved_at`
- `is_brand_asset`
- `usage_count`
- `versions`
- `current_version`
- `is_archived`
- `metadata`

### Linking table: `org_post_asset_links`
This is the critical bridge between the asset library and content operations.
Important fields:

- `organization_id`
- `post_id`
- `asset_id`
- `asset_role`
- `sort_order`
- `created_by`

### Related operational tables

- `posts`
  The content records that can be linked to assets.

- `pipeline_items`
  These do not link directly to assets in schema, but pipeline items inherit attached assets through linked posts in service normalization.

---

## 5.5 Asset Library database and policy behavior

### Read rules
Members can read assets if they have brand-project access to the asset's scope.

### Insert rule at RLS level
The `org_workspace_member_insert_assets` RLS policy allows insert when:

- `uploaded_by = auth.uid()`
- and the member has brand access

### Update rule
Assets can be updated by:

- the original uploader, or
- `org_owner`
- `org_admin`
- `editor`

### Important inconsistency
The edge function `org-asset-upload` is stricter than the raw RLS insert policy.

It requires `can_manage_library`, which means:

- contributors may be allowed by table policy in theory
- but the actual upload function blocks them in practice

So the real operational rule is currently "library managers only", even though the insert RLS policy is looser.

---

## 5.6 Asset Library service and function flow

### Client side

- `fetchOrgAssets({ organizationId, brandProjectId, includeArchived })`
  Reads org assets and includes org-wide assets plus current brand assets when a brand project is selected.

- `updateOrgAsset(assetId, updates)`
  Updates asset rows directly.

- `uploadOrgAsset(...)`
  Calls the `org-asset-upload` edge function via explicit `fetch`.
  This is important because it classifies failures better than a generic invoke path.

- `fetchOrgPostAssetLinks({ organizationId, postIds })`
  Reads asset links for posts and hydrates the linked asset rows.

- `syncOrgPostAssetLinks(...)`
  Makes post-to-asset links match the desired selected asset references.

### Edge function: `org-asset-upload`
This function:

1. authenticates the user
2. validates org membership
3. validates brand-project access
4. resolves member permissions
5. requires `can_manage_library`
6. ensures the `org-assets` storage bucket exists
7. uploads the file to storage
8. inserts the `org_asset_library` row
9. auto-approves the asset if the member can approve uploads

### Storage behavior
The storage bucket is:

- `org-assets`

Path structure:

- `organizationId/brandProjectId-or-shared/timestamp-uuid-filename`

### Cross-surface integration behavior

- `SessionStore.saveDraft()` and `SessionStore.publishContent()` call `syncOrgPostAssetLinks()`
- `fetchPipelineItems()` hydrates attached assets onto pipeline items by looking up linked post asset rows
- `fetchOrgCalendarSnapshot()` hydrates attached assets onto calendar posts
- `CalendarLibraryPicker` uses the same asset source and can upload assets inline

---

## 5.7 How the Asset Library relates to all other pages

### `Overview`
- Overview reads asset counts and recent-asset activity through `useOrgAssets()`.

### `My Office`
- There is a data relationship through asset references and post asset links.
- There is not yet a strong direct page-to-page interaction from the library page into My Office.

### `Pipeline`
- Pipeline items can carry attached assets indirectly because `fetchPipelineItems()` hydrates them from linked post asset rows.
- The current pipeline board page does not surface those assets much.

### `Calendar`
- This is the strongest relationship.
- Calendar loads assets, asset links, and attached assets.
- Calendar can open `CalendarLibraryPicker` to seed a draft or attach assets into the scheduling flow.
- Calendar detail records can display linked assets.

### `Common Room`
- The schema supports `asset_reference` content type, but the UI does not expose asset-linked messages.

### `Admin Roles`
- Determines who can manage the library and approve uploads.

### `Admin Settings` and plans
- Brand scoping is more important for agency orgs because the brand selector is surfaced there.

---

## 5.8 What is working in the Asset Library

- Assets can be loaded for the active org.
- Brand-project filtering works at the service level and includes org-wide assets.
- Search, collection filtering, folder filtering, and density switching work in the page.
- Upload modal exists and calls a real edge upload function.
- Approve, brand-flag toggle, and archive/restore toggle work through `updateOrgAsset()`.
- Asset selection and inline upload work inside the calendar library picker.
- Asset references can be persisted to posts through `org_post_asset_links`.
- Calendar and pipeline normalization already understand attached assets.
- Upload error handling is relatively mature and includes clear deployment/reachability messaging.

---

## 5.9 What is broken or incomplete in the Asset Library

### Inconsistent access behavior

- The page always shows an `Upload` button, even for members who cannot manage the library.
- The modal then disables the submit button for those members.
- This is not fatal, but it is a poor permission UX.

- The upload function requires `can_manage_library`, while the table insert policy is broader.
- The enforcement layers are not aligned.

### Missing management features

- No metadata edit UI for:
  - name
  - description
  - tags
  - folder

- No explicit reject action for pending assets, even though `approval_status` supports `rejected`.

- No permanent delete flow.

- No version-management UI, even though:
  - `versions`
  - `current_version`
  exist in the table.

- No download or original-file action is surfaced in the page.

### Data quality gaps

- `usage_count` is displayed, but there is no visible code path updating it.
  So the number is currently not trustworthy unless updated elsewhere outside this repo path.

- Non-image asset preview is weak.
  The page mostly treats `thumbnail_url || file_url` as imageable media.

- Folder behavior is flat exact-match filtering, not true folder-tree navigation.

### Cross-surface gaps

- There is no direct "use this in My Office" CTA from the library page.
- There is no Common Room asset sharing UI, even though the schema suggests future support.
- There is no realtime subscription for library changes, so refresh is manual.
- There is no pagination or virtualization for large libraries.

---

## 6. Cross-Surface Flows

## 6.1 Draft creation flow

1. User opens `My Office`
2. User opens `OrgGenerateComposer`
3. Composer uses org runtime context
4. `SessionStore.saveDraft()` writes:
   - `posts`
   - org scope fields
   - optional `org_post_asset_links`
5. `socialai:data-sync` fires
6. My Office reloads drafts

### Meaning
This is the main "personal creation inside a shared org" loop.

---

## 6.2 Draft-to-pipeline flow

1. Draft exists as a `posts.status = draft` row
2. User clicks `Submit` in My Office
3. `submitPostToPipeline()`:
   - picks a pipeline config
   - inserts a `pipeline_items` row
   - writes `posts.pipeline_item_id`
4. Pipeline page can now show the item
5. Calendar and Overview can later reflect it after approval/scheduling

### Meaning
My Office is the pipeline entry point.

### Current reality
This flow is conceptually correct but currently has a runtime issue because `MyOffice.jsx` references an undefined `brandProjectId` in the submit handler.

---

## 6.3 Asset-to-post flow

1. Asset is uploaded to `org_asset_library`
2. User selects assets from a library-aware surface such as `CalendarLibraryPicker`
3. Composer or post-production state holds `assetReferences`
4. `syncOrgPostAssetLinks()` persists those links
5. Later reads hydrate attached assets into:
   - pipeline items
   - calendar records

### Meaning
The most important library integration is not the standalone library page. It is the link table that allows reusable assets to stay attached to operational content.

---

## 6.4 Common Room AI flow

1. UI would call `requestAiChannelReply()` with channel + org context
2. `ai-org-chat` validates:
   - membership
   - brand access
   - credits
3. function grounds the prompt in brand settings
4. function inserts an AI message
5. function updates `ai_session_logs`
6. function records credit usage

### Current reality
The backend is ready, but the Common Room page does not trigger this flow yet.

---

## 7. What is working vs what is not: concise status summary

## 7.1 My Office

### Working
- org-scoped draft loading
- org-scoped composer
- draft save
- post publish/schedule from composer
- draft refresh via sync event
- pipeline data read

### Broken
- draft submit action likely fails because `brandProjectId` is undefined in `MyOffice.jsx`

### Thin
- pipeline list not user-specific
- no brand-project filter on draft fetch
- no direct asset-library picker from the page itself

---

## 7.2 Common Room

### Working
- channel read
- message read
- plain-text send
- realtime message refresh
- AI chat backend exists

### Not wired or missing
- no AI trigger in UI
- no channel create/manage UI
- no threads
- no reactions
- no attachments or references
- no sender identity resolution
- no unread/read UX

---

## 7.3 Asset Library

### Working
- browse/search/filter/select
- upload through edge function
- approve/brand/archive actions
- brand-project filtering
- calendar integration
- post asset link persistence

### Inconsistent or missing
- upload permission UX is confusing
- uploader permission logic is stricter in function than in RLS
- no reject action
- no edit metadata UI
- no version UI
- `usage_count` appears unmaintained
- no direct CTA into My Office

---

## 8. Key implementation risks and inconsistencies

These are the most important issues to understand if someone is inheriting this area.

### 1. My Office submit path appears broken
This is the most immediate issue because it affects the core "draft to pipeline" workflow.

### 2. Common Room backend maturity is ahead of UI maturity
The schema and AI function imply a much richer collaboration product than the current page exposes.

### 3. Asset Library standalone UX is behind its underlying integrations
The most useful asset behavior is happening in calendar/composer/post-link integration, not from the library page itself.

### 4. Feature flags exist in plan data but are not visibly enforced in org routing/navigation
This creates a risk that the product story and the actual exposure of surfaces diverge.

### 5. Permission enforcement is not perfectly aligned across UI, service, RLS, and edge function layers
The asset upload flow is the clearest example.

---

## 9. Recommended documentation reading order for a new engineer

If someone is new and wants to understand this part of the product quickly, the best order is:

1. this document
2. `src/layouts/OrgWorkspaceShell.jsx`
3. `src/org/context/OrgContextProvider.jsx`
4. `src/org/pages/MyOffice.jsx`
5. `src/org/components/OrgGenerateComposer.jsx`
6. `src/stores/SessionStore.js`
7. `src/org/services/pipelineService.js`
8. `src/org/pages/CommonRoom.jsx`
9. `src/org/hooks/useCommonRoom.js`
10. `src/org/services/commonRoomService.js`
11. `supabase/functions/ai-org-chat/index.ts`
12. `src/org/pages/OrgAssetLibrary.jsx`
13. `src/org/services/assetLibraryService.js`
14. `supabase/functions/org-asset-upload/index.ts`
15. the org workspace migrations:
    - `20260324100000_org_workspace_foundation.sql`
    - `20260324110000_org_pipeline_tables.sql`
    - `20260324120000_org_common_room_tables.sql`
    - `20260324130000_org_asset_library_table.sql`
    - `20260324150000_org_posts_generations_columns.sql`
    - `20260324160000_org_rls_policies.sql`
    - `20260324170000_org_helper_functions.sql`
    - `20260325110000_org_calendar_view_presets_and_asset_links.sql`

---

## 10. Final take

If someone asks, "What are these three surfaces right now?" the honest answer is:

- `My Office` is the personal org draft workspace and should be the front door to the pipeline, but it currently has a submit-path bug and a few scoping mismatches.
- `Common Room` is structurally designed to become a serious collaboration surface with AI, but the current page only exposes the simplest message flow.
- `Asset Library` is already operational and integrated into downstream workflow data, but its standalone management UX is still shallower than its data model.

That means the architecture is ahead of the UI in some places and behind it in others. The strongest production-ready connective tissue today is:

- org context
- role and permission modeling
- asset-link persistence
- pipeline/calendar data normalization

The weakest points are:

- My Office handoff correctness
- Common Room UI completeness
- Asset Library management depth and permission consistency
