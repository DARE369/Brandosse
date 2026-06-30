# Personal Workspace — Technical Spec

Updated: 2026-06-23
Scope: Everything a solo (non-org) user can do in Brandosse, **excluding the Calendar and the Library pages entirely** — those are documented separately. This spec stops at the point where a piece of content becomes a draft/scheduled/published `posts` row; what happens to it after that (calendar view, library browsing) is out of scope here.

Companion document: `docs/ORG_WORKSPACE_SPEC.md` (multi-user/team side of the product).

---

## 1. The personal/org scoping rule

This is the one mechanism every other section depends on, so it comes first.

Almost every query in the app is scoped through `getSessionScope()` (`src/stores/SessionStore.js:293`):

```js
function getSessionScope() {
  const orgScope = getActiveOrgScope();
  if (orgScope?.organization_id) {
    return { workspace_type: 'organization', organization_id: orgScope.organization_id, brand_project_id: ... };
  }
  return { workspace_type: 'personal', organization_id: null, brand_project_id: null };
}
```

- If the user is not currently acting inside an org context, every write (`withSessionScope`) and every read (`applySessionScope`) is tagged `workspace_type = 'personal'`, `organization_id IS NULL`.
- This is what makes "Personal Workspace" a real, enforced boundary rather than just a UI skin — a personal generation, draft, or post can never be queried back as if it belonged to an org, and vice versa.
- The active scope is decided by `getActiveOrgScope()`, which reflects whichever context (personal vs. a specific org) the user last selected — see §7, Context Selector.

Personal-scope tables of note: `generations`, `sessions`, `posts`, `brand_kits`, `connected_accounts`, `connected_accounts_health_summary`, `user_settings`, `video_clips`, `user_notifications` — all filtered by `user_id` + `organization_id IS NULL`.

---

## 2. Auth & onboarding

Files: `src/Context/AuthContext.jsx`, `src/pages/Auth/{Login,Register,ForgotPassword,ResetPassword,AuthCallback,CompleteSignupPage}.jsx`

1. **Register** — email/password or Google OAuth. The signup form includes a plan choice: `individual`, `organization`, or `agency`. Choosing org/agency additionally requires an organization name + slug.
2. **Login** — email/password or Google OAuth via Supabase session management. On success, `AuthContext` calls `loadResolvedAccess(user)` to fetch the profile, org memberships, and last-used context, then redirects to `resolveWorkspaceRedirectPath(...)`.
3. **Google OAuth** redirects through `AuthCallback.jsx`, which either resumes a pending org-signup completion or sends the user to their resolved workspace.
4. **Complete Signup** (`CompleteSignupPage.jsx`) only appears if the user self-registered an org/agency plan and provisioning hasn't finished — it calls `provisionSelfSignupOrganization()` to finish creating the org, then routes into that org's workspace.
5. **First-run state for a brand-new individual user:**
   - No org memberships → `workspaceRedirectPath` resolves to the personal default route (`/app/dashboard`).
   - If the user's Brand Kit isn't `setup_completed`, a Brand Kit onboarding modal appears.
   - The Dashboard itself shows an `OnboardingChecklist` (Create account → Connect an account → Generate first post) until the user has at least one generation and one connected account.

---

## 3. Navigation shell

Files: `src/components/User/UserNavbar.jsx`, `src/components/User/UserSidebar.jsx`, `src/Context/AppNavigationContext`

**Navbar:**
- Brand mark + live search box that queries the `generations` table as the user types and jumps straight to a result inside Generate.
- Notification bell — merges recent rows from `generations` (completed/processing/failed), `posts` (published/scheduled/failed), and `user_notifications`, capped at the 15 most recent.
- Credits balance (read from `profile.credits`).
- Profile menu (avatar, name, logout).

**Sidebar** (`NAV_ITEMS`):
- *Command*: Command Center (Dashboard), AI Studio (Generate, "AI" badge), Content Library, Video Lab ("Beta" badge).
- *Publish*: Content Calendar, Insights (Analytics), Credits.
- *System*: Settings, Brand Kit ("NEW" badge + a red dot if the kit isn't configured yet).
- Collapsible (state persisted to `localStorage` as `socialai-sidebar-collapsed`); collapsed mode shows icon-only with tooltips.
- Active route highlighting matches on path prefix, except `/app/settings`, which only highlights on an exact match (so its sub-tabs don't fight the highlight).

---

## 4. Dashboard

File: `src/pages/Dashboard/UserDashboard.jsx`

**What it shows, and where each number comes from** (all queries run in parallel, personal-scoped):

| Widget | Source |
|---|---|
| KPI cards: Posts Published, Scheduled, Clips Ready, Drafts | `posts` (status counts), `video_clips` (`render_status='complete'`) |
| Content Flow chart (Generated / Scheduled / Published / Drafts, last 7 days) | `generations` + `posts`, aggregated client-side |
| Upcoming Posts panel | next 5 `posts` ordered by `scheduled_at` |
| Latest Generations strip | 5 most recent `generations`, thumbnail + status badge |
| Account Health card | `connected_accounts_health_summary` view |
| Onboarding checklist | shown only while `totalGenerated === 0 && connectedAccounts.length === 0` |

**Realtime:** subscribes to Postgres changes on `generations`, `posts`, `connected_accounts`, debounced 800ms, so the dashboard updates live while a generation is running elsewhere in the app.

**States:** skeleton loaders per widget, a retry-capable error state per module (data for one widget failing doesn't blank the page), and empty states with a CTA into Generate or Connected Accounts.

---

## 5. Generate Studio

Files: `src/pages/GeneratePage/GeneratePageV2.jsx`, `src/components/GenerateStudio/**`, state in `src/stores/SessionStore.js`, model config in `src/config/magnificModels.js`.

This is the core personal-workspace feature: turning a prompt into a piece of platform-ready content.

### 5.1 Stage machine

`brief → generating → results → publish → published` (`BrandosseGenerateStudio.jsx`, local state `studioStage`).

1. **Brief** — `StudioComposer`: prompt text, content mode (image / carousel / video / image-to-video / edit), aspect ratio, batch size, resolution, model. Past completed generations from the session render below the composer. An "Enhance" action can rewrite the prompt via an LLM call (`enhancePrompt()`).
2. **Generating** — full-screen `StudioGeneratingView` driven by named stages mapped to progress %, e.g. `Loading brand kit... → Planning content... → Generating content plan... → Quality check... → Generating image...` (`STAGE_PROGRESS` map, `SessionStore.js:673`).
3. **Results** — `StudioCanvas` shows a grid of completed takes. **The moment a generation completes, it is automatically turned into a draft `posts` row** via `ensureDraftForGeneration()` (`SessionStore.js:630`) — this fires from every generation path (`startGeneration`, `startCarouselGeneration`, video generation, etc.). It only inserts a row if no post lifecycle exists yet for that generation, so it never clobbers a draft the user is already editing. This also kicks off asynchronous metadata generation (`scheduleDraftMetadataGeneration`) so a title/caption are usually waiting by the time the user opens the publish step.
4. **Publish** — user clicks "Use for post" on a result, which calls `selectGeneration()` and moves to this stage. `StudioPublishPanel` (right rail) shows:
   - Platform toggles (Instagram, LinkedIn, TikTok, X, Facebook, YouTube), each with its own character limit.
   - Per-platform caption cards, pre-filled from AI-generated copy, independently editable/resettable, with live character counts that warn near the limit.
   - Footer actions: **Save draft**, **Schedule** (see stub note below), **Publish**.
5. **Published** — `StudioPublishedPanel` confirms which platforms the post was queued to and offers "Generate Another."

### 5.2 AI models & cost

`magnificModels.js` defines the model catalog by mode:
- Image: Ideogram V3, Recraft V3, FLUX.2 Pro, Seedream 4.5, several Magnific "Mystic" presets, Editorial Portraits.
- Video (text-to-video): LTX 2.0 Pro.
- Image-to-video: Kling 2.6 Pro, LTX 2.0 Pro I2V.
- Edit: Seedream 4.5 Edit.

`estimateMagnificCost(settings)` computes a credit cost before generation runs (roughly: image 10/18/30 credits at 1k/2k/4k × batch size; carousel = per-slide cost × slide count; video = 40 base + resolution/duration adjustments; edit = 16). The Generate button is disabled with an explicit "needs N credits, you have M" message whenever `availableCredits < cost`. Credit *deduction* is not visible anywhere in the client store — it's assumed to happen server-side inside the generation edge functions; the client only estimates cost and reads the resulting balance off `profile.credits`.

Generation itself is server-side via Supabase Edge Functions: `generateImage`, `editImage`, `generateVideo` (+ `videoStatus` for polling), invoked from `src/services/magnific.service.js`.

### 5.3 Captions, hashtags, SEO

- `generate-post-metadata` edge function produces `title`, `caption`, `hashtags` (`regeneratePostMetadata()`); brand kit context is sanitized and injected (`sanitizeBrandKitForPrompt()`, `SessionStore.js:552`) so copy stays on-voice.
- `optimize-seo` edge function rewrites the copy for a score improvement; `seo-score` edge function scores the *current* copy (0–100) without changing it, breaking the score down by title/caption/hashtags with concrete suggestions.
- `buildFinalCaption()` / `normalizeHashtags()` assemble the caption actually sent for publishing (caption body + normalized, `#`-prefixed hashtags).

### 5.4 Save draft vs. Publish vs. Schedule

`saveDraft()` (`SessionStore.js:2407`) and `publishContent()` (`SessionStore.js:2495`) both:
- Reuse an existing draft/non-terminal post for the same generation if one exists (rather than creating duplicates), otherwise insert a new `posts` row.
- Sync the change into the personal library (`ensureLibraryRowsForPosts()` — mechanics of that destination are out of scope here).

`publishContent()` specifically:
- Requires at least one platform selected.
- Builds one `posts` row per selected platform/account (primary + secondary), each carrying its own resolved `platform` and `account_id`.
- If `postProduction.scheduleDate` is set → status `scheduled`. Otherwise → immediate path, status `publishing` → `published`.
- **Immediate publish is simulated**, not a real platform call: `executeMockPublishAttempts()` (`src/services/platforms/mockPublishWorkflow.js`) fakes the publish attempt per account and reports success/failure. No content actually reaches Instagram/TikTok/etc. today.
- Cleans up any now-redundant draft rows for the same generation after a successful publish/schedule, so a generation never ends up with two contradictory lifecycle rows.

**Known stub:** the **"Schedule" button inside the Publish panel** (`StudioPublishPanel.jsx:606`, wired in `BrandosseGenerateStudio.jsx:606`) does not open a date picker — it just fires a toast: *"Calendar scheduling coming soon."* The backend path (`postProduction.scheduleDate` → status `scheduled`) fully works; there is simply no in-Studio UI yet to set that date. Today, scheduling a date requires leaving Generate (out of this doc's scope).

---

## 6. Brand Kit (personal)

File: `src/pages/Settings/BrandKitPage.jsx`, table `brand_kits`.

A state machine, not a single form: `choice → extracting → conversational → review → dashboard`.
- **Choice**: pick a setup path — upload a document, conversational Q&A, manual entry, or import.
- **Extracting**: an uploaded brand doc is parsed by AI into structured fields.
- **Conversational**: short multi-turn chat fills in whatever the extraction missed.
- **Review**: user edits the structured result before saving.
- **Dashboard**: the completed kit, editable at any time afterward.

Stored fields include brand name, brand voice, tone, messaging pillars, a "do not use" list, approved hashtag sets, and brand assets, plus `setup_completed` / `setup_skipped` flags that gate the onboarding modal described in §2.

This is the single most important upstream input to Generate: a sanitized summary of the kit is injected into every generation and metadata/SEO prompt so output stays on-brand.

---

## 7. Connected Accounts (personal)

Files: `src/pages/Settings/ConnectedAccountsTab.jsx`, `src/services/platforms/connectionService.js`, `src/pages/Settings/components/{MockOAuthScreen,AccountHealthModal,PlatformGrid}.jsx`.

- `PlatformGrid` lists every supported platform (Instagram, Facebook, TikTok, LinkedIn, X, YouTube).
- Clicking a platform opens `MockOAuthScreen` — a simulated connect flow where the user fills in a demo display name, account type, and follower count.
- **This is fully mocked, not real OAuth.** `connectionService.js` stores the resulting row with `is_mock = true`, a `mock_token`, `connection_status = 'active'`, and a starting `health_score` of 100. No real platform credentials are ever exchanged, which is also why §5.4's publish step has nothing real to call.
- **Account health**: `AccountHealthModal` reads `connected_accounts_health_summary` (`health_score`, `consecutive_failure_count`, `last_failure_reason`, `last_successful_publish_at`). For mock accounts this stays permanently healthy since there's no real platform to fail against.
- Existing connections can be reconnected, edited, or removed from the same tab.

---

## 8. Personal Settings

File: `src/pages/Settings/PersonalSettingsFoundationTab.jsx`, table `user_settings`.

- **Profile**: full name (required), avatar URL — saved via `updateUserProfileSettings()`, which updates Supabase auth user metadata.
- **Preferences**: timezone (auto-detected from the browser, overridable), locale (en-US/en-GB/fr-FR/de-DE/es-ES), theme (system/light/dark), and a default landing route (e.g. land on Generate instead of Dashboard) — saved via `saveUserSettings()`.
- **Notifications**: independent toggles for content updates, approvals, tasks, system alerts, and a weekly digest.

---

## 9. Personal Analytics

File: `src/pages/AnalyticsPage/PersonalAnalyticsPage.jsx`.

- Summary tiles: total generations, published/draft/scheduled/failed post counts, connected accounts, and how many of those accounts are currently healthy (`health_score >= 70` or an explicit healthy/active/connected status).
- Platform breakdown table: per platform — account count, healthy count, total/draft/scheduled/published/failed posts, average health score, activity share %, publish rate %.
- Recent posts table (sortable/filterable, capped at 500 rows).
- External engagement totals (views/likes/comments/shares) come from a `platform_analytics` table joined to `posts` — this is genuinely optional; if the table doesn't exist in a given environment the query's `42P01` error is swallowed and totals just show 0, rather than breaking the page.
- For the personal workspace, everything except that optional external-analytics join is real data straight from the user's own `generations`/`posts`/`connected_accounts` — there's no synthetic analytics layer here.

---

## 10. Video Engine

Files: `src/pages/VideoEngine/{VideoEngineLab,VideoSubmitPage,VideoJobsPage,VideoJobDetailPage,CreditsPage}.jsx`.

A distinct surface from Generate Studio's own `video` / `image-to-video` modes, aimed at longer-form video job processing rather than a single text-to-video render.

- **Job lifecycle** (driven from `SessionStore.js`'s video functions): `submitting → processing → completed | failed`. Submission calls a `generateVideo` edge function; if it doesn't return a finished video immediately, the client polls `videoStatus` every 8 seconds until it does.
- A completed job lands in the `generations` table with `media_type = 'video'`, and — same as any other generation — automatically gets a draft `posts` row via `ensureDraftForGeneration()`.
- `CreditsPage.jsx` exists for tracking a separate video credit balance, referenced from the navbar's `videoCredits` state.
- **Known gap:** `VideoEngineLab.jsx` is a dev-only diagnostics page that shows the pipeline's own status — stages 1–3 marked "Implemented" but their readiness checks are all manual rather than automated. Treat Video Engine as functional-but-early relative to the rest of the personal workspace.

---

## 11. Context Selector — the door out of Personal

File: `src/pages/ContextSelector/ContextSelectorPage.jsx`.

This is the only bridge mentioned in this document between Personal and Org — included here because it's the mechanism that *changes* `getActiveOrgScope()` from §1, and therefore changes which workspace every other page in this document is operating in.

- Only shown to users who (a) aren't a Brandosse platform admin and (b) belong to at least one org. Everyone else skips straight to their one workspace.
- Presents one card for "Personal Workspace" and one card per org membership (org name + role).
- Picking a card calls `updateLastUsedContext({ contextType: 'personal' | 'organization', organizationId? })`, which is persisted so the next login returns to the same context automatically, then navigates into that workspace's home.

---

## Consolidated list of mocked / stubbed behavior

For quick reference — everything in this document that is *not* yet doing what it visually appears to do:

1. **Schedule button in Generate's Publish panel** — toast stub, no date picker (§5.4).
2. **All platform connections** — simulated OAuth, no real platform credentials (§7).
3. **Immediate "Publish"** — simulated via `executeMockPublishAttempts()`, nothing actually posts to a real platform (§5.4).
4. **Video Engine pipeline diagnostics** — readiness checks are manual, not automated (§10).
5. **Credit deduction** — not implemented client-side; assumed server-side in edge functions, unverified from this codebase alone (§5.2).
