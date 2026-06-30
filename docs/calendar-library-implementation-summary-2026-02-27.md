# Calendar + Library + Generate Integration Summary

Date: 2026-02-28  
Scope: Fix generation-to-library/calendar mismatch, restore enhanced prompt UX, align lifecycle defaults, and harden DB consistency.

## 1) What Was Implemented

### 1.1 Generation -> Draft -> Library consistency (fixed)

- Newly completed generations are now auto-synced to `posts` as `draft` by default.
- Library visibility now reflects newly generated content immediately.
- Added explicit cross-page refresh event (`socialai:data-sync`) after generation/draft/publish actions.
- Added safer library-link insertion for posts (`content_library_items`) with duplicate-safe upsert behavior.

Files:
- `src/stores/SessionStore.js`
  - Sync event + dispatcher: lines 26, 55
  - Draft creation guard: line 124
  - Library row upsert helper: line 103
  - Sync triggers after generation flows: lines 506, 679, 800, 990, 1404, 1473

### 1.2 Post lifecycle behavior (default drafts + publish/schedule flow)

- `saveDraft` and `publishContent` now work against generation-linked posts more safely:
  - reuse non-terminal rows when appropriate,
  - avoid terminal-status edits,
  - clean stale draft rows after schedule/publish.
- Hydration of post-production state from existing generation-linked posts is now preserved better when a schedule date is prefilled from route context.

Files:
- `src/stores/SessionStore.js`
  - Hydration: line 1194
  - Save draft: line 1229
  - Publish/schedule: line 1296

### 1.3 Prompt bar redesign + enhance prompt restored

- Restored `Enhance Prompt` behavior (edge function first, fallback API).
- Added inline enhance trigger that appears only when user has typed text.
- Added styled suggestions menu with accept/reject behavior.
- Added textarea growth cap with internal scrolling (professional prompt input behavior).
- Styled prompt textarea scrollbar and app-wide scrollbar.

Files:
- `src/components/Generate/GenerationPromptBar.jsx`
  - Textarea JS max height cap: line 171 (`Math.min(..., 220)`)
- `src/styles/GeneratePromptBar.css`
  - Prompt textarea max height + scroll styles: lines 1198, 1214, 1222
  - Enhance menu styles: lines 1236, 1243, 1266, 1309
- `src/styles/global.css`
  - App-wide scrollbar styling: lines 41-63

### 1.4 Route interoperability (buttons now pass context into Generate)

- Generate page now consumes route-state payloads from Calendar/Library actions:
  - `repurposeFromPostId`
  - `editPostId`
  - `templateId`
  - `prefillDate` (schedule prefill support)
- Template route flow now seeds the prompt input through a custom event.
- Added guard to prevent post-production reset from wiping route-state prefills.

Files:
- `src/pages/GeneratePage/GeneratePageV2.jsx`
  - Route state processing: lines 154-286
  - Prefill schedule + reset guard: lines 49, 52, 84-89, 240
  - Session-route preservation when creating fallback/new sessions: lines 123, 133
- `src/components/Generate/GenerationCanvas.jsx`
  - Prompt seed event listener: lines 140-142

### 1.5 Calendar + Library workflow alignment

- Added explicit sync listeners in both pages so updates from Generate are reflected without manual reload.
- Added optional persisted filters (`Keep filters`) with default reset behavior.
- Calendar now links drafts to Library (`/app/library`, section `drafts`) and de-emphasizes duplicated draft handling.

Files:
- `src/pages/CalendarPage/CalendarPageV2.jsx`
  - Sync listener: lines 126-127
  - Filter persistence: lines 73, 79, 131-142, 449-452
  - Drafts -> Library action: line 320
- `src/pages/LibraryPage/LibraryPageV2.jsx`
  - Sync listener: lines 265-266
  - Filter persistence: lines 221, 227, 270-283, 581-584

### 1.6 Prompt suggestions now AI-generated (not static hardcoded)

- Added new edge function for random prompt suggestions with Groq/Grok failover.
- Client prompt suggestions now:
  1. call edge function,
  2. fallback to Groq direct JSON,
  3. fallback to local deterministic emergency suggestions.

Files:
- `supabase/functions/prompt-suggestions/index.ts`
- `src/services/suggestedPrompts.js` (lines 7, 43, 53+)

### 1.7 Settings shell integration

- Settings page now uses shared app shell (`UserNavbar` + `UserSidebar`) for layout consistency.

Files:
- `src/pages/Settings.jsx` (lines 123-127)
- `src/styles/Settings.css` (`.settings-shell`)

## 2) Database Changes Applied

### 2.1 Existing alignment migration

- `supabase/migrations/20260227090000_calendar_library_alignment.sql`
  - library tables and relationships,
  - lifecycle trigger,
  - library sync triggers,
  - index and helper function alignment.

### 2.2 New unification + RLS migration

- `supabase/migrations/20260227103000_generation_post_unification_and_rls.sql`
  - admin helper: `is_admin_user` (line 13)
  - user/admin RLS policies for core tables, including posts (line 45)
  - duplicate draft guard index (line 76)
  - generation->draft auto trigger function (line 85)
  - completed generation backfill into posts (line 142)

## 3) Manual Steps You Need To Run

1. Apply DB migrations:
   - `supabase db push`
   - Ensure both migrations are applied:
     - `20260227090000_calendar_library_alignment.sql`
     - `20260227103000_generation_post_unification_and_rls.sql`
2. Deploy edge functions:
   - `supabase functions deploy prompt-suggestions`
   - Confirm existing `enhance-prompt` function is deployed and reachable.
3. Set/verify environment secrets in Supabase:
   - `GROQ_API_KEY` (preferred)
   - optional fallback: `GROK_API_KEY` or `XAI_API_KEY`
4. Verify storage buckets:
   - `generated_assets` exists and is writable for your upload/generation paths.
5. Verify RLS behavior after deploy:
   - Normal users only see their own generations/posts.
   - Admin users can see all per policy.

## 4) Rollback / Revert Plan (Safe)

If you need to revert quickly:

1. Frontend-only rollback:
   - Revert `SessionStore`, `GeneratePageV2`, `GenerationCanvas`, and prompt-bar styling files in git.
2. DB rollback (manual):
   - Drop new trigger(s) and function from `20260227103000...`:
     - `generations_to_draft_post_insert`
     - `generations_to_draft_post_update`
     - `ensure_draft_post_for_generation()`
   - Drop index:
     - `idx_posts_unique_draft_per_generation_account`
   - Restore prior RLS policies if needed.
3. Edge rollback:
   - Undeploy/disable `prompt-suggestions` and rely on client fallback only.

## 5) Remaining Gaps / Not Fully Completed

- Full template-to-generate structured prefill (hashtags/platform/pillar) is still partial; caption format seeding is implemented, but deeper template variable UX is not complete.
- Full "post immediately" production pipeline still depends on connected account publishing infrastructure; lifecycle/state logic is in place.
- Calendar/List and Library bulk multi-select action parity from the full design packet is not fully complete yet.

## 6) Verification

- Build verification passed:
  - `npm run build`
  - Result: success (bundle-size warnings only).
