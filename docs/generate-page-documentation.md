# Generate Page Documentation

Updated: 2026-02-17
Scope: User-facing generation workflow (`/app/generate` and `/generate`), excluding admin pages.

## 1. Page Purpose
The Generate page is the content creation workspace. It should let a user:
- Start generation sessions
- Generate image/video assets from prompts
- Review generated outputs
- Prepare caption/hashtags
- Select destination accounts and publish or schedule posts

## 2. Route and Composition
Routes currently mapped to same page:
- `/app/generate` (protected)
- `/generate` (public route currently)

Main page:
- `src/pages/GeneratePage/GeneratePageV2.jsx`

Main child areas:
- Session rail: `src/components/Generate/SessionHistoryRail.jsx`
- Prompt + output canvas: `src/components/Generate/GenerationCanvas.jsx`
- Result grid: `src/components/Generate/BatchGenerationGrid.jsx`
- Post-production panel: `src/components/Generate/PostProductionPanel.jsx`

State and services:
- Store: `src/stores/SessionStore.js`
- AI providers: `src/services/ApiService.js`
- Supabase client: `src/services/supabaseClient.js`

## 3. Runtime Behavior (As Implemented)
### 3.1 Session lifecycle
- Fetch sessions from `sessions` table
- Create new session if none exists when user submits prompt
- Switch session loads associated `generations`

### 3.2 Generation lifecycle
`startGeneration(prompt)` in `SessionStore`:
1. Insert placeholder `generations` rows with `status='processing'`
2. Call provider layer (`generateImages` / `generateVideo`)
3. Update generation rows with media URL + metadata + `status='completed'`
4. Refresh session generation list

### 3.3 Realtime
- `GeneratePageV2` subscribes to `generations` table changes via store
- Active session list updates for INSERT/UPDATE in current session

### 3.4 Post-production flow
Panel has 3 steps:
1. Caption generation/edit
2. Hashtag and SEO optimization
3. Distribution (connected account selection + post now/schedule)

Publish action:
- Inserts rows in `posts` for selected accounts
- Uses status `scheduled` if date chosen, otherwise `published`

## 4. Schema Relationships Used
Core chain:
- `sessions.user_id -> auth.users.id`
- `generations.session_id -> sessions.id`
- `posts.generation_id -> generations.id`
- `posts.account_id -> connected_accounts.id`
- `connected_accounts.user_id -> auth.users.id`

Optional/related tables not currently wired in main flow:
- `generation_assets`
- `generation_metadata`
- `generation_sessions`

## 5. What Must Be In Place
Database and policies:
- RLS for user-owned reads/writes on `sessions`, `generations`, `posts`, `connected_accounts`
- Indexes:
  - `sessions(user_id, created_at)`
  - `generations(session_id, created_at)`
  - `posts(user_id, created_at)`

Storage/network:
- Stable media URLs (or proxy/download endpoint if provider URLs are ephemeral)
- Upload bucket if mask/edit flow is enabled (`generated_assets`)

Product/UX behavior:
- Canonical generation status enum and canonical post status enum shared across UI/store/DB
- Clear error surface to users (not console-only)

## 6. Current Gaps and Required Fixes
P0
- Result grid status mismatch prevents completed outputs from rendering correctly.
  - Store writes `completed/processing`: `src/stores/SessionStore.js:249`, `src/stores/SessionStore.js:194`
  - Grid reads `published/publishing`: `src/components/Generate/BatchGenerationGrid.jsx:108`, `src/components/Generate/BatchGenerationGrid.jsx:109`

- Publish success messaging uses `posted` check while status set is `published`.
  - `src/stores/SessionStore.js:425`
  - `src/stores/SessionStore.js:455`

P1
- Public route `/generate` exposes generation UI without route protection.
  - `src/router/router.jsx:27`
- Step state in post-production panel is not reset between opens.
  - `src/components/Generate/PostProductionPanel.jsx:21`
- Account selection includes all connected accounts; should filter to active/mock and supported platforms.
  - `src/components/Generate/PostProductionPanel.jsx:39`

P2
- Caption finalization concatenates hashtags without forcing `#` format.
  - `src/stores/SessionStore.js:423`
- Legacy/unused generation architecture increases maintenance load:
  - `src/pages/GeneratePage/state/useGenerationService.js`
  - `src/pages/GeneratePage/state/generationMachine.js`

## 7. Recommended Target Behavior
- Single source of truth for statuses in a shared constants module
- Route protection parity: remove or protect public `/generate`
- Separate concerns in store:
  - generation orchestration
  - post publishing
  - UI-only state
- Replace alerts with toast/system notifications
- Add optimistic but reversible UI for publish/schedule with explicit failure states

## 8. Acceptance Criteria
- Completed generations always render in result grid
- Publish Now and Schedule return correct status messages and DB states
- Generate flow behaves consistently whether first session or existing session
- No orphan or legacy generation pathways in active codepath
