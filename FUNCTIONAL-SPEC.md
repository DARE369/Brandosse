# Functional Specification — Content & Publishing Platform

**Purpose of this document:** a complete, implementation-free description of what this product does, for a design team rebuilding its interface from scratch. It describes jobs, data, actions, and states — never colors, fonts, spacing, component libraries, or current layouts. Nothing here should be read as a design instruction; everything here should be read as a product fact.

A general note on ground truth: this product's codebase changes quickly, and in a few places old internal documentation disagreed with what's actually shipped. Wherever that happened, this spec describes the **shipped, current behavior**, with a short note where the discrepancy is itself informative (e.g., a feature that looks finished on screen but has no real logic behind it yet).

---

## 1. Product Overview

This is a content-operations platform for people and teams who produce social media content professionally: independent creators, small business owners, in-house marketers, agencies, and the internal staff who operate the platform itself. It combines AI-assisted content generation (images, video, carousels, captions), a shared brand-voice system, a scheduling/publishing calendar, a team review-and-approval workflow for organizations, and an internal operations console for the people who run the service.

**Who uses it, and what job they hire it for:**

- A **solo creator or small business owner** hires this product to stop starting from a blank page every day — describe an idea, get on-brand image/video/caption options fast, and get it scheduled without leaving the app.
- An **organization team** (contributors, reviewers/editors, owners/admins) hires this product to let more than one person touch content safely: contributors draft, reviewers approve or send back revisions, admins control who can publish, what the brand sounds like, and how credits/access are governed.
- An **external client** of an agency hires this product, briefly and without an account, to approve or request changes on one specific piece of content via a private link.
- A **platform operator/administrator** hires this product to keep the service healthy: investigating problem users or organizations, moderating content, triaging support complaints, watching connected-account health, and maintaining an audit trail.

**What a successful session looks like, by user:**
- Creator: opens the app with an idea, leaves with content scheduled, and never wonders whether it actually got queued correctly.
- Org contributor: knows exactly what's expected of them today, submits work, and gets clear, specific feedback if it's sent back.
- Org admin: can tell at a glance whether the team is on track, and can safely delegate without losing control of brand quality or publishing risk.
- External client: approves or requests changes on one piece of content in under two minutes, with no login and no confusion about what they're looking at.
- Platform operator: can find the right user/organization/content/complaint fast, understand why something is flagged, act on it, and trust that the action is logged.

**This is professional, high-stakes tooling, not a casual consumer app.** Every user of this product is doing focused work where precision, speed, and trust matter more than delight. A wrong click that schedules the wrong post, silently fails to notify a teammate, or force-publishes the wrong item to a real audience is a real cost, not an inconvenience. The interface should read as confident and exact rather than playful, without becoming cold or intimidating for the least technical users (solo creators, external clients).

**Where the product is deliberately not "real" yet — and why the design must say so clearly:** social platform connections and all publishing (scheduled or immediate) currently run through a simulated/mock publish mechanism rather than talking to real social networks. This is an intentional, permanent-for-now product decision, not a bug — but the interface must keep this honest and visible everywhere it's relevant (connecting an account, publishing, viewing publish history) rather than letting a redesign accidentally make mock behavior look indistinguishable from a live integration.

---

## 2. Roles & Permissions

There are three separate access "worlds" in this product, plus one link-only external role. A person can belong to more than one world (e.g., a solo creator who is also an organization owner, or a platform operator who is also a personal user).

### 2.1 The seven roles

| Role | World | Core job | Primary screens |
|---|---|---|---|
| **Solo Creator** | Personal workspace | Generate, organize, and schedule content alone | Dashboard, Generate, Calendar, Library, Analytics, Settings, Brand Kit, Help |
| **Small Business Owner** | Personal workspace, then Organization (as owner) | Keep brand content consistent while running a business, usually starting solo and growing into a team | Same as Solo Creator, plus Organization admin screens |
| **Org Contributor** | Organization (member) | Draft content and complete assigned tasks, then submit for review | My Workspace, My Office, Pipeline Board, Org Calendar, Asset Library, Common Room |
| **Org Reviewer** | Organization (member) | Judge submitted content: approve, reject, or request changes | Same as Contributor, with review actions enabled; cannot generate (0 credit allowance by default) |
| **Org Editor** | Organization (member) | Reviews content and can also publish/schedule it (with one extra required approval step) | Same as Contributor/Reviewer, plus scheduling/publishing/library-management/task-management |
| **Org Owner / Org Admin** | Organization (admin) | Configure the organization: people, roles, brand rules, review workflow, shared accounts, credits | Overview, Members, Roles, Pipelines, Credits, Settings, plus every member screen |
| **External Client Reviewer** | Link-only, no account | Approve or request changes on one specific piece of content | The public review page only |
| **Platform Admin / Operator** | Platform admin console | Operate the service: investigate, moderate, resolve complaints, monitor health | Overview, Users, Accounts, Organizations, Moderation, Complaints, Logs, Analytics, Settings |

Two platform-admin identities exist underneath the single "Platform Admin" label above: a **platform-wide operator** with full cross-tenant reach, and an **organization-scoped admin-capable role** whose reach is meant to be limited to their own organization. Which of these two identities is actually allowed to enter the admin console at all is presently inconsistent between the "get in the door" check and the "what do you see once inside" check — this needs a single product decision (see UX Problems, Admin section) before a redesign can assume one behavior.

### 2.2 Organization role capability matrix (defaults for a brand-new organization)

Every organization member has exactly one role, plus optional individual overrides layered on top, plus optional scoping to specific brand/client projects. The table below is the **starting point** for a new organization — every cell is admin-editable per organization (custom role templates) and per person (individual overrides), so real behavior can and will diverge from this table over time.

| Capability | Owner | Admin | Editor | Contributor | Reviewer |
|---|---|---|---|---|---|
| Can publish content | Yes | Yes | Yes | No | No |
| Requires one extra approval before publishing | No | No | **Yes** | n/a | n/a |
| Can schedule content | Yes | Yes | Yes | No | No |
| Can manage the shared asset library | Yes | Yes | Yes | No | No |
| Can approve pending library uploads | Yes | Yes | No | No | No |
| Can manage tasks | Yes | Yes | Yes | No | No |
| Can create collaboration channels | Yes | Yes | Yes | No | No |
| Can invite new members | Yes | Yes | No | No | No |
| Monthly AI generation credit allowance | Unlimited | Unlimited | Unlimited | 200 | **0 (blocked)** |

Practical reading: Contributor and Reviewer start out nearly identical (draft/review only, no scheduling, publishing, library management, task management, channel creation, or invite rights) — the only default difference between them is that a Contributor can personally generate content (200 credits/month) and a Reviewer cannot (0). Reviewers are meant to only judge, not create.

**Route-level access, independent of the table above:**
- Every organization screen requires active membership; a suspended/removed member is fully blocked.
- The admin configuration screens (Overview, Members, Roles, Pipelines, Credits, Settings) require Owner or Admin — Editor/Contributor/Reviewer cannot reach these routes at all, regardless of any individual override.
- **Brand Kit is the one exception:** viewing it only requires membership. Editing it requires either Owner/Admin, or an individual "brand kit editor" grant an admin can hand to anyone — a real capability with no corresponding navigation entry for non-admins, so a granted editor has to already know the page exists.
- Within Org Calendar specifically, Contributor/Reviewer see a reduced set of views (calendar, week, tasks) and are automatically filtered to their own assigned items; Owner/Admin/Editor see every view (including cross-team queue/board/approval/workload views) and can act on any item.
- Nobody can reassign a person's role away from Owner using the ordinary member controls — there is no documented alternate "transfer ownership" flow, which may be a real gap rather than an intentional safety rail.

### 2.3 Platform admin scope

| Screen | Platform-wide operator | Organization-scoped admin |
|---|---|---|
| Admin Overview, User Directory, Content Moderation, Complaints Queue, Analytics | Full/cross-tenant | Same screen, silently narrowed to their own organization |
| Connected Account Maintenance, Organizations List, Organization Detail, Logs | Full | **Hard-blocked** — shown a denied-access screen instead of the real page |
| User Detail, Complaint Detail | Full (subject to record-level backend checks) | Same, scope-checked per record |
| Admin Settings | Full | Full — identical either way, and entirely local to the device |

The choice of which screens get a hard wall versus a silent narrowing does not follow any stated rule today — it is worth deciding, as part of redesign, whether both patterns should remain or be unified into one consistent way of saying "you don't have access to this."

### 2.4 External Client Reviewer

Not a normal account. Reaches the product only via a private link containing a token. Sees a single piece of content, can approve or request changes with optional written feedback, and never sees any other part of the app — no navigation, no login, no workspace concept.

---

## 3. Screen Inventory — Personal Workspace

The personal workspace is where an individual manages their own account, brand identity, content generation, scheduling, asset library, and support. It is the default landing world for anyone without an organization role driving them elsewhere.

### 3.1 Login

**Job:** let a returning individual sign in and land in the correct workspace.

**Shown, most important first:** an inline error/info banner when relevant (computed from an authentication attempt or handed off from another screen); email and password fields (user-entered).

**Actions:** sign in with email/password (primary); sign in with Google (primary); "forgot password" (secondary, goes to a real reset flow); go to registration (secondary). A "remember me" checkbox is present but not currently wired to anything — it should either be implemented or removed in redesign so it doesn't imply a promise the product doesn't keep.

**States:** loading (inputs disabled, button shows progress); error (a specific message for invalid credentials, unconfirmed email, temporary auth outage, or a generic fallback); info/success banner (e.g., arriving fresh from registration). There is no visible account-lockout or throttling state — repeated failed attempts always show the same generic message.

**Entry points:** direct navigation; redirected here from any protected page (original destination is remembered and honored after sign-in); redirected here after registration when email confirmation is required.
**Exit points:** the originally-intended destination; the org/admin/complete-signup flow if one is pending; the personal dashboard by default; registration; password reset.

**Constraints:** no visible rate-limiting or CAPTCHA.

### 3.2 Register

**Job:** create a new account as an individual, an organization, or an agency, and route the person into the correct provisioning path.

**Shown:** account-type choice (three options, most important first-decision on the page); email/password fields; organization name and a workspace address (auto-suggested from the name, editable) shown only for organization/agency signups; a live password-strength hint.

**Actions:** choose account type — Individual (personal workspace only), Organization (one shared brand + team workspace), or Agency (multiple brand projects under one workspace); sign up with Google or email/password (primary); edit the auto-generated workspace address (secondary).

**States:** loading; validation error (missing organization name/address for org signups, password too short); post-submit outcome varies — straight into the app, into a "finish setting up your organization" step, or back to Login with an email-confirmation notice.

**Entry points:** direct navigation; "create one free" link from Login.
**Exit points:** personal dashboard; the organization-finishing step; Login (email confirmation required).

**Constraints:** password minimum is 6 characters at signup — inconsistent with the separate password-reset flow's 8-character minimum (see UX Problems); no live availability check on the workspace address before submit; every new signup is seeded with a starting AI-credit allowance advertised on this screen.

### 3.3 Forgot Password / Reset Password

**Job:** let someone who's locked out request a reset email, then set a new password from that email's link.

**Shown (request step):** an email field. **Shown (reset step):** new-password and confirm-password fields; a computed check of whether the recovery link itself is still valid.

**Actions:** send a reset email (reversible — can be requested repeatedly); set a new password (not reversible in effect — it signs the person out and requires the new password going forward); request a fresh link if the current one is invalid.

**States:** idle/entry form; submitting; success confirmation (request step); checking-link (reset step, fields disabled while validating); invalid/expired link (reset step, fields stay disabled, offers a new-link request); validation errors (password too short, passwords don't match); success, followed by a redirect to Login with a confirmation message.

**Entry points:** "forgot password" link on Login (request step); the emailed recovery link only (reset step — this page cannot be reached any other way).
**Exit points:** Login.

**Constraints:** reset password enforces an 8-character minimum, inconsistent with registration's 6-character minimum.

### 3.4 Auth Callback (automatic, no visible UI of its own)

**Job:** after a Google sign-in completes, finish the session handoff, ensure the person has a usable profile, and forward them to the right place (or into password recovery, if that's what triggered it).

**Shown:** transient progress text only.
**Actions:** none from the user except a "try again" link if something fails.
**States:** loading (multi-step, with a short automatic retry if the session isn't immediately ready); error (with a reason and a way back to Login); silent redirect straight into password recovery when that's the actual trigger.
**Entry points:** only ever reached automatically as an OAuth/email-link redirect target.
**Exit points:** password reset; the organization-finishing step if one is pending; the personal dashboard; Login on failure.
**Constraints:** new-profile creation here is safe to retry; this is the actual moment a new signup's starting credit allowance is granted for Google sign-ups specifically.

### 3.5 Complete Organization Signup (automatic, minimal UI)

**Job:** finish provisioning a brand-new organization/agency workspace right after signup, then drop the person into it.

**Shown:** a progress overlay; no persisted business data of its own.
**Actions:** implicitly, a "skip" path exists that abandons the pending organization and goes to the personal workspace instead — but there is **no way to edit and retry** a rejected organization name/address from this screen; a person would have to restart registration entirely.
**States:** provisioning in progress; silent success (redirect into the new organization); generic failure message with no correction path.
**Entry points:** automatically, only when an organization/agency signup is still pending.
**Exit points:** the new organization's home screen, or the personal dashboard if skipped.
**Constraints:** this entire step depends on browser-local state surviving a sign-in round trip; if that state is cleared too early, an organization can be left partially set up with no visible recovery.

### 3.6 Select Workspace

**Job:** for someone who belongs to more than one workspace (personal plus at least one organization), let them choose where to go.

**Shown, most important first:** one card per available workspace (personal, plus one per organization membership) — each showing its name, the person's role there, and which one was used most recently.

**Actions:** choose the personal workspace (primary); choose a specific organization (primary) — each records the choice for next time.

**States:** loading; this screen is skipped entirely for platform admins (sent straight to the admin console) and for anyone with no organization memberships (sent straight to the personal dashboard) — it is only ever shown to people with a real choice to make. There is no visible error if the "remember my choice" write fails silently.

**Entry points:** automatically, post-sign-in, only for people with more than one workspace.
**Exit points:** the personal dashboard, or the chosen organization's home screen (destination depends on role).

### 3.7 Dashboard

**Job:** the personal home screen — a snapshot of activity plus fast paths into the rest of the app.

**Shown, ranked by importance:**
1. A first-run onboarding checklist (create account / connect a social account / generate a first post) for brand-new users — replaces the rest of the dashboard's assumptions of familiarity.
2. Core activity numbers: posts published (with trend), scheduled count, ready video clips, drafts — live, updating in real time as content changes anywhere in the account.
3. "Next scheduled post" countdown, or a clear "nothing scheduled" state.
4. A searchable list of the most recent generations, with thumbnails, linking straight back into the exact generation.
5. A simple content-flow chart (drafted → scheduled → published, computed from the same live data).
6. Connected-account health summary.
7. Current AI-credit balance — shown as a raw number with **no breakdown of how it was spent** (a real gap; see UX Problems).

**Actions:** search past generations by keyword (secondary, jumps straight to the match); start a new generation (primary); click through any card/list item to its detail (secondary, all read-only navigation — nothing destructive lives on this screen).

**States:** loading (per-section skeletons); a section-level error with its own retry, rather than one page-wide failure; empty-first-use (onboarding checklist plus friendly "nothing yet" messages per section, each with its own call to action); empty-filtered-to-nothing (searching recent generations with no match).

**Entry points:** default landing page after sign-in for personal-context users; the main navigation menu link from anywhere.
**Exit points:** Generate (new, or resuming a specific session); Settings; Analytics.

**Constraints:** the numbers on this page are computed from several independent live data feeds — a redesign should be aware that keeping every number perfectly consistent with what other screens show requires a single shared definition of each metric, which does not fully exist today.

### 3.8 Generate — the Content Studio

**Job:** the core creative workspace: describe what to make, produce image/video/carousel/edit variants, then turn a result into a real post (caption, hashtags, targeting, schedule or publish).

**Shown, ranked by importance:**
1. The generation canvas itself — in-progress placeholders, then result thumbnails, with progress and format details.
2. The prompt (user-entered, up to 2,000 characters), with an optional guided/structured mode (subject, setting, style, mood) and an AI-assisted "enhance my prompt" helper.
3. Mode choice (single image, carousel, text-to-video, image edit, animate-an-image), each with its own model options, cost, and format settings (aspect ratio, resolution, batch size or slide count, video duration/frame rate).
4. A live credit-cost estimate that gates the generate action — a person cannot start a generation they can't afford; the button explains exactly how many credits are needed versus how many are available.
5. Session history — prior sessions and generations, for resuming or reusing earlier work.
6. Once a result exists: a post-production step for title, caption, hashtags, a computed discovery/readiness score across several dimensions (readability, hook strength, hashtag quality, brand consistency, and others), and platform/account targeting.
7. A one-time nudge toward completing the brand identity setup, shown only to people who haven't finished it yet.

**Actions:** generate (primary, gated by credit balance, not reversible in the sense that it spends credits, but re-generating is always available); enhance the prompt (secondary, reversible); edit an existing image with a new instruction (primary, within edit mode); retry a stuck or failed video job (secondary); save as draft, schedule, or publish immediately (primary — publishing is not cleanly undoable the way saving a draft is); resume or repurpose a past post from elsewhere in the app (secondary, prefills the studio).

**States:** actively generating (placeholder cards sized to the chosen format, a progress indicator, and descriptive labels); video specifically runs a longer queued → processing → done/failed lifecycle that survives navigating away, with its own persistent status indicator; there is no visible "blank" first-visit state — a new working session is always created automatically; error (a brief on-screen notice for most failures; a dedicated failure state for video with a clear retry prompt); insufficient credits (the generate action is disabled in advance with an explanation, not failed after the fact).

**Entry points:** the dashboard (recent generation, quick-start); the content library (repurpose/edit hand-off, and — separately — a working hand-off that seeds a prompt from a chosen media item); the calendar (prefill a date, repurpose an existing post); direct link to a specific past session.
**Exit points:** the calendar (once scheduled); the library (once saved or published); the dashboard.

**Constraints:** prompt cap 2,000 characters; image batches of 1–4; carousels of at least 2 slides (default 6); video runs 6–10 seconds depending on model, and the product's own copy tells people to expect **2–4 minutes** of real processing time; eight social platforms are registered as generation/targeting options, not all of which necessarily have a live account connection behind them yet; the search index over past generations only covers the most recent 120.

### 3.9 Calendar

**Job:** the scheduling board — see what's scheduled, published, or failed; manage everything not yet scheduled; move things around in time.

**Shown, ranked by importance:**
1. A month grid or list of posts by day (live), plus a separate rail of unscheduled drafts.
2. A weekly summary strip: scheduled/published/failed counts, busiest day, top platforms, an overall health read (Healthy / Review / Issues / Empty), and one plain-language tip — all computed locally from the currently loaded posts, deliberately not styled as an AI feature.
3. Per-post detail on demand: caption, hashtags, target account, schedule time, and a lock indicator once a post has begun publishing.

**Actions:** compose and schedule/draft something in one step (primary); drag a post to a different day, or use a tap-based "move" mode as a non-drag alternative (primary, reversible); create a blank draft for a specific day (secondary); a natural-language command bar for things like "plan my week," "suggest the best times to post," "check this caption," or "reschedule anything that failed" — each surfaces an explicit confirmation step before anything changes, rather than acting silently (secondary); from a post's detail: edit, reschedule, unschedule back to a draft, duplicate, or delete (delete requires confirmation and is not reversible; the rest are).

**States:** loading; error with a retry; empty (an inviting prompt to drag a draft onto the grid, and a matching message on the empty drafts rail); a scheduling conflict when a chosen time/account is already taken — the person must explicitly choose to schedule anyway, nothing is silently overwritten; a "this changed elsewhere" state if the same post was edited from another tab/device in the meantime — the view refreshes to the latest version and explains that the attempted change was not applied; a locked state for posts already mid-publish or published (cannot be rescheduled/deleted through the normal controls); a blocked-duplicate state when trying to create a second draft of the same asset on the same account (a real, enforced rule, not just a UI nicety).

**Entry points:** the main navigation menu; dashboard deep links; Generate (once scheduled); the library's "schedule" action on any asset.
**Exit points:** Generate (new, edit, or repurpose); Library.

**Constraints:** defaults to a simpler list view on narrow screens; there is no week view today (only month and list); AI-suggested "best time to post" ghost-slots described in older product notes do not exist in the current build at all — if wanted, this needs to be scoped from scratch, not assumed partially built.

### 3.10 Library

**Job:** a single asset store for everything uploaded, generated, or produced as part of a post — with the ability to reuse or schedule any of it.

**Shown, ranked by importance:**
1. An asset grid or table (live), filterable by source (uploads / AI-generated / linked to a post), status (in-use / archived), type, and tag, with free-text search and an option to remember the last filter combination.
2. Per-asset detail on demand: full metadata, which post(s) reference it, and a version chain if it supersedes/is superseded by another upload.
3. A separate Trash view listing soft-deleted assets pending permanent removal.

**Actions:** upload one or more files (primary; images, video, or documents up to 50MB each); bulk-select then archive or delete (secondary; delete is soft/recoverable, archive is reversible); per asset — open detail, hand off to the calendar's compose flow pre-filled with that asset ("Schedule"), archive, or delete with an explicit confirmation explaining a 30-day recovery window; restore from Trash (reversible until that window elapses); link an upload as a new version of an existing asset (offered automatically when a likely duplicate is detected); edit title/description/tags inline. A "duplicate this asset" control is visibly present but not actually implemented yet — clicking it just says so.

**States:** loading; empty-first-use (an inviting prompt to upload or go generate something); empty-filtered-to-nothing; an empty Trash state; load errors surface as a brief notice rather than a full-page failure.

**Entry points:** the main navigation menu.
**Exit points:** Calendar (via schedule); Generate (only via the empty state's "go generate something" link — there's no per-asset "use this in a new generation" action from inside the library itself today, a real gap given how natural that hand-off sounds).

**Constraints:** 50MB per file; 30-day soft-delete recovery window; this screen no longer owns any draft/scheduled/published pipeline concept — that all lives in the calendar now, this is purely an asset store.

### 3.11 Personal Analytics

**Job:** a first read on a person's own app-side content activity, explicitly an early-stage feature ahead of real social-platform analytics.

**Shown, ranked by importance:**
1. Summary numbers: generated (with trend), scheduled, published (with a publish-rate percentage), connected accounts (with a health ratio) — capped internally at the 500 most recent underlying records per number.
2. A publishing funnel (generated → drafted → scheduled → published) with counts and short descriptions.
3. Contextual "next best action" suggestions (e.g., connect a platform, schedule waiting drafts, review failures) driven by simple thresholds on the same data.
4. A per-platform breakdown (post/account counts, an activity share, average account health).
5. A recent-content timeline table.
6. A clearly locked/placeholder panel for native social metrics (views, likes, comments, shares) — explicitly labeled as coming later, not yet real.

**Actions:** refresh (secondary); jump to Generate (primary, shown in the header and again in an empty state).
**States:** loading; error with retry (the page tolerates some missing optional data gracefully rather than failing outright); empty (no platform activity yet, or no tracked posts yet), each with its own prompt to create content.
**Entry points:** dashboard, the main navigation menu.
**Exit points:** Generate.
**Constraints:** each underlying data source is capped at 500 rows; updates arrive in the background without an obvious loading flicker on every refresh.

### 3.12 Settings

**Job:** manage personal identity and preferences, plus connected publishing accounts; provides a read-only view into any organization-owned accounts.

**Shown, ranked by importance (organized into tabs):**
1. **Profile:** display name, avatar.
2. **Preferences:** timezone, locale, theme (system/light/dark), and which screen to land on after sign-in.
3. **Notifications:** five independent toggles — content updates, approval events, task reminders, system alerts, weekly digest — each with a one-line description.
4. **Connected Accounts:** how many accounts are connected; a card per account (platform, name, status, health); the full set of supported platforms with connect/edit actions; explicit labeling of whether a real or simulated connection is active in the current environment.
5. **Organization Accounts** (only if the person belongs to an organization): a read-only pointer to that organization's own account-management screen for each org they're in.

**Actions:** save each tab independently (each save button only becomes active once that tab has an actual change); connect a new platform account; edit or reconnect an existing one (secondary); disconnect an account (secondary, requires a plain confirmation, and is not clearly reversible — reconnecting means starting over); view more detail on an account's health (read-only); jump to the relevant organization's account screen (a generic link that doesn't carry along which specific account or action prompted the click — a real gap).

**States:** loading; a guard state for the (normally unreachable) case of not being signed in; a specific technical error message if the underlying settings storage isn't available in a given environment — this message is developer-facing and should not be what an end user ever actually sees; a confirmation toast for every save/connect/disconnect/reconnect.

**Entry points:** the main navigation menu; the dashboard's account-health card.
**Exit points:** the relevant organization's account settings.

**Constraints:** eight platforms are registered; connecting can go through either a real or a simulated flow depending on environment, and the interface is explicit about which is active.

### 3.13 Brand Kit Settings

**Job:** capture a person's or brand's identity once so every generation reflects it automatically.

**Shown, ranked by importance:**
1. First-run only: a choice between uploading a document to auto-extract a starting kit, a guided conversational setup, a manual form, or importing a previously exported kit.
2. The kit itself, organized into five groups: **Basics** (name, industry, tagline, website, audience); **Voice** (tone, writing style, signature phrases, banned phrases, emoji usage, call-to-action style); **Guardrails** (content restrictions, competitor names, legal disclaimers, caption length/hashtag limits); **Visual Style** (style keywords, palette, typography notes, things to avoid); **Assets** (uploaded brand files).
3. Once complete: a summary dashboard with per-section edit access and an asset count.

**Actions:** upload a document to auto-extract a draft kit (primary — falls back to the guided conversation if extraction can't produce enough); go through the guided conversation instead (primary, alternative); fill the manual form directly (primary, alternative); import an exported kit file (secondary); re-upload a document later to propose updates to an already-saved kit, reviewed through a diff step so nothing is silently overwritten (secondary); edit any section directly (secondary).

**States:** first-run choice; extracting (loading); conversational capture; a review form (always opening on Basics first); the completed dashboard; a diff/merge step for proposed updates; a generic error banner; a sign-in guard.

**Entry points:** the main navigation menu; a one-time nudge inside Generate for anyone without a completed kit.
**Exit points:** implicitly informs every later generation — there is currently no visible trace on an individual generation of which version of the brand kit produced it.

**Constraints:** document upload capped at 20MB (PDF/Word only); the document-extraction step currently returns a placeholder/fallback result rather than real document-derived intelligence — a redesign should not assume extraction quality the product can't currently deliver, and should design the review step accordingly (as something the person is expected to correct, not just confirm).

### 3.14 Help & Support

**Job:** self-serve FAQ plus a support-ticket system with basic status tracking.

**Shown, ranked by importance:**
1. A searchable FAQ across five topics (getting started, content generation, scheduling & calendar, publishing, account & credits).
2. "My Support Tickets": category, status, title, submitted date, and — when a ticket has one — a status/comment timeline (status changes plus any support replies, with author and timestamp).

**Actions:** search the FAQ (secondary); submit a new ticket with category, title, description, and an optional screenshot (primary, not editable/withdrawable once sent); switch between FAQ and ticket views (both deep-linkable); expand a ticket for full detail.

**States:** loading tickets; no FAQ match; no tickets yet; submitting; success (confirmation banner, form resets); error (inline, with the underlying message); a distinct resolved/closed view showing who resolved it and any closing note.

**Entry points:** the main navigation menu; a notification click-through when a ticket is resolved; direct link.
**Exit points:** back to the dashboard; otherwise a leaf screen.

**Constraints:** title capped at 100 characters; description must be 20–1000 characters; screenshot optional, image only, up to 5MB; ticket category is a fixed list (content generation, publishing, scheduling & calendar, account & settings, credits & billing, platform connections, other).

### 3.15 Redirect-only paths

Two addresses exist purely to catch old bookmarks/links and forward straight to the current screen (a personal profile shortcut into Settings, and a legacy generate address into the current Generate screen). No independent design surface.

---

## 4. Screen Inventory — Organization Workspace

The organization workspace is where teams collaborate: contributors draft, reviewers/editors judge, and owners/admins configure the rules. It also includes two public, account-free surfaces (invitation acceptance and external client review).

### 4.1 My Workspace

**Job:** a member's personal execution dashboard — exactly what to act on right now.

**Shown, ranked by importance:** items sent back to this person for revision; items approved and ready to schedule; tasks assigned to them (with overdue/blocked flags); their upcoming scheduled posts; a lightweight "team pulse" summary computed from the same live data; which cards/panels they've previously dismissed.

**Actions:** open a revision item straight into the content generator, pre-loaded (primary); open the schedule step directly from a ready item (primary); open an assigned task (primary, deep-links to the calendar's task view); dismiss or collapse a card/panel (secondary — no visible way to bring back a dismissed card afterward); navigate onward to My Office, Pipeline Board, Org Calendar, or (admins) Overview.

**States:** loading; a genuine "nothing to do" empty state per section (own copy for revisions, ready-to-schedule, tasks, and bottlenecks); a save failure for dismiss/collapse preferences (shown as a brief generic notice); no explanation is given here for *why* a scheduling action might fail elsewhere — a real gap.

**Entry points:** the organization navigation menu; default landing page after invitation acceptance or login for non-admin roles.
**Exit points:** My Office, Pipeline Board, Org Calendar, Overview (admins), the schedule step, the content generator.

**Constraints:** most of this page updates live as posts/tasks/pipeline items change elsewhere; only the dismissed-card preferences are not live (fetched once, saved back explicitly).

### 4.2 My Office

**Job:** the draft workbench — review, edit, delete, and submit drafts into the organization's review process.

**Shown:** a member's own drafts (filterable by brand, if they work across more than one); a draft's prompt/content summary; their recently submitted items with current status/assignee.

**Actions:** create/generate a new draft (primary); edit a draft (primary); delete a draft, with a plain confirmation, not reversible (secondary); submit a draft into review (primary) — blocked with a specific, actionable message if the draft has no brand/project assigned yet; follow a submitted item to the Pipeline Board (secondary).

**States:** loading; no drafts yet; nothing submitted yet; a draft with no summary shows a clear fallback line rather than blank space; a blocked submission explains exactly what's missing; delete/submit both confirm success or failure with a brief notice.

**Entry points:** the organization navigation menu; cards on My Workspace.
**Exit points:** the Pipeline Board (opens the general board, not the specific item just submitted — a real gap); the content generator.

### 4.3 Pipeline Board

**Job:** a status board showing where every submitted piece of content currently sits, grouped by review stage.

**Shown:** content cards grouped into fixed stages — pending, in review, changes requested, approved, rejected, withdrawn.

**Actions:** today, this screen is largely **read-only** — there is no working item-detail view and no stage-action controls (approve/reject/request-changes/schedule) here at all; those live inside Org Calendar's modals instead. From the empty state, a person can jump to My Office to create something.

**States:** loading; empty (nothing submitted yet); otherwise updates live as items move between stages.

**Entry points:** the organization navigation menu; links from My Workspace, My Office, Org Calendar, and notifications — some of which pass along which specific item to focus on, most of which do not.
**Exit points:** My Office (empty state only) — no other links exist from this page today (no link to the calendar, no task drawer, no client-review link generation).

This is one of the thinnest screens in the whole workspace relative to how central "review status" is to the product — worth a real design decision on whether it should gain real actions/detail, be folded entirely into the calendar, or be explicitly repositioned as a pure status overview.

### 4.4 Task Management (inside Org Calendar)

There is no separate "tasks" address today — task management is one of the calendar's view modes plus a creation dialog and a detail drawer, documented here as its own job because it's a distinct concern (assigning and tracking discrete work, separate from content review stage).

**Shown:** a task list/board grouped by an organization's own configurable status names; task detail (title, assignee, due date, linked content/review item, notes); overdue/blocked flags computed from due date and status; the org's custom task-status list, configured elsewhere and consumed here.

**Actions:** create a task (primary); edit details/add notes (primary); move a task's status (primary); open the task's linked review item or scheduling context (secondary). Creating/editing requires the "manage tasks" capability — people without it can view but not change tasks, without a clear explanation of why the controls are missing.

**States:** loading; empty (no tasks yet); task-related events are not shown anywhere as a unified history, and the separate Team Activity feed (below) does not include task activity at all.

**Entry points:** the calendar's task view; a task-specific deep link from My Workspace; task references opened from library asset origin badges.
**Exit points:** the linked review item or scheduling action, both inside the calendar's other views.

### 4.5 Org Calendar

**Job:** the main day-to-day operating surface — schedule and publish approved work, act on review items, manage tasks, and attach assets, all from one place. This is the busiest, most connective screen in the organization workspace.

**Shown, ranked by importance:**
1. Scheduled/published/approved content across several view modes: calendar (month), week, timeline (a rolling 28-day window), a stage-grouped board, a cross-team queue, an approval-focused view, a workload view, and a tasks view. Contributors/Reviewers see a reduced set (calendar, week, tasks) filtered to only their own assigned items; Owner/Admin/Editor see everything and can act on anything.
2. Fixed board stages: **Draft/Idea → In Review → Changes Requested → Approved**, with rejected/withdrawn/failed items handled as a separate archive rather than active columns. (A separate status-filter control on the same page currently uses slightly different wording for the same stages — a live example of copy drift worth fixing.)
3. Tasks and their statuses.
4. Assets attached to a given post.
5. Which destination accounts a given post can go to, and whether the current person is allowed to post to them.
6. Saved view presets (personal, or org-wide if saved by an Owner/Admin).

**Actions:** schedule an approved item (primary); publish immediately (primary, not reversible from here — may require unpublishing on the destination platform itself); batch-schedule several items at once with a preview step first (secondary); drag-and-drop to reschedule or move a task's status (primary, reversible); approve, reject, or request revision on a review item, role- and stage-permitting — rejecting or requesting revision **requires a written comment**, enforced, not just suggested (primary); create/edit/delete a task (primary); save the current view as personal or (Owner/Admin only) shared (secondary); attach an asset from a library picker (secondary); open the content generator directly from calendar context (secondary); generate and copy an external client-review link for an eligible stage (secondary) — this link has **no visible expiry or revoke control** documented anywhere in this workspace once created.

**States:** loading per view; empty (nothing in the selected view yet) versus filtered-to-nothing (e.g., "my queue" legitimately has zero items) — the difference between these two is not always made clear to the person looking at either; when a permission or stage rule blocks an action, the reason is **not consistently explained**, so people can hit a wall without knowing why; there is no audit/history rail showing who changed what and when, and no single view joining a task, its review item, its post, and its attached assets together.

**Entry points:** the organization navigation menu; a task-focused deep link from My Workspace; library/task flows that open the schedule step directly.
**Exit points:** Pipeline Board (inconsistently focused); the library asset picker; the content generator.

**Constraints:** the timeline view is fixed to a rolling 28 days; scheduling and publishing both check whether the acting person is authorized to post to the specific shared destination account, separately from generic publish rights.

### 4.6 Asset Library (organization)

**Job:** the shared media/document library — browse, organize, annotate, and reuse assets, with traceability back to the post/review-item/task they came from.

**Shown, ranked by importance:** an asset grid (with density options) and folder tree; smart-collection/search results; per-asset detail including provenance (which post, review item, or task it links to); who uploaded it.

**Actions:** upload (primary; goes through a dedicated check of folder assignment and permission); create/rename/move a folder (secondary); delete a folder — blocked outright for system folders, and blocked until emptied for any folder with contents (secondary); edit asset metadata/tags (secondary); approve a pending upload, for people with that specific right (secondary); archive/restore (secondary); open the schedule step directly from an asset with post/review origin (secondary); follow an origin badge back to its source — today this lands on the general review or calendar screen, not the specific item (a real gap).

**States:** loading; empty (first-use search/detail prompts); permission-denied (view-only for people without library-management or approval rights); explicit blocked-action states for the folder-deletion rules above; provenance links can be blank even when a real origin exists (a documented sync gap); there is no "attach this to my current draft" action from this screen — attaching only happens from the calendar side.

**Entry points:** the organization navigation menu; the calendar's library picker and the collaboration hub's asset-reference picker both read from this same pool.
**Exit points:** the review/calendar screen (unfocused) from origin badges; the schedule step.

**Constraints:** this screen does not update live — another member's upload requires a manual refresh to appear.

### 4.7 Common Room (team collaboration hub)

**Job:** channel-based team discussion — org-wide, per-brand, and private groups — with inline references to assets and review items, and an optional AI-assisted reply.

**Shown:** a channel list (org, brand, private groups) with unread counts and last-message previews; the message stream; channel membership; inline asset/review-item references embedded in messages.

**Actions:** send a message (primary); ask the AI assistant for a reply in a channel that allows it — this spends a credit and is not reversible, and is blocked outright in channels where it's disabled (secondary); create a channel, for people with that right (secondary); create/edit a private group — a private group must always have a designated admin, and its member cap can't be set below its current size (secondary); archive a channel or group, with a plain confirmation (secondary/rare); leave a private group — blocked if you're its admin until you hand that off first (rare); attach an asset or review-item reference to a message (secondary); follow a reference — today this lands on the general library or review screen, not the specific item (same gap as elsewhere).

**States:** loading; empty (no channels of a given type yet); send/AI-reply failure notices; permission-denied for channel creation or AI replies; there is no threaded-discussion concept tied to a specific review item or task, and no way to see "everywhere this asset was discussed."

**Entry points:** the organization navigation menu; notification links straight into a specific channel.
**Exit points:** the library or review screen (unfocused) via references.

**Constraints:** fully live — channels, messages, and read markers all update in real time; an AI reply is a metered action (checks access and credit balance, logs the session, records usage) — not a free action.

### 4.8 Team Activity

**Job:** intended as a cross-team activity feed; in its current form it is a lightweight, read-only feed of content-review status changes only.

**Shown:** recent review-stage status changes, as cards.
**Actions:** none — passive viewing only, no filters, no links out.
**States:** loading; empty.

This screen materially under-delivers on its name today: it has **no relationship to tasks, scheduling/publishing events, team chat, or notifications** — members may reasonably assume it's a complete activity feed and miss real operational events as a result. Worth deciding, as part of redesign, whether to build it out into what its name promises, or rename/reposition it so its scope is honest.

**Entry points:** the organization navigation menu — visible only to Owner, Admin, and Editor; Contributors/Reviewers don't see this navigation entry at all, for no stated reason.
**Exit points:** none.

### 4.9 Join / Accept Invitation (public page)

**Job:** let an invited person join an organization — validate the invitation, match or create the right account, and finalize membership.

**Shown:** an invitation preview (organization name, invited email, assigned role, invitation state); whether the current session (if any) matches the invited email; whether a brand-new password is needed.

**Actions:** auto-accept, when already signed in with a matching email (automatic); sign in instead, pre-filled with the invited email (secondary); set a new password to finish onboarding as a brand-new account (primary — minimum 10 characters, must be confirmed); sign out, if signed in with the wrong account (secondary).

**States:** checking access; joining; and several distinct terminal states with their own explanation and (mostly) no in-page recovery action: link missing a token, invitation already used, invitation revoked, invitation expired, signed in with the wrong account, a generic failure, or a totally-failed-to-load preview. If an account already exists for the invited email, the person is redirected to sign in instead. **None of the failure states offer an in-page "request a new invite" or "contact your admin" action** — recovery guidance is static text only, a real source of drop-off.

**Entry points:** an invitation link containing a token, generated from the admin Members screen and typically shared manually rather than emailed automatically.
**Exit points:** on success, regular members land on My Workspace, admins/owners land on Overview; on failure, a static terminal screen.

**Constraints:** password minimum 10 characters for new accounts here (yet another different minimum than the 6/8-character rules elsewhere — see UX Problems); a signed-in session must match the invited email exactly to auto-accept, by design.

### 4.10 Client Review (public, tokenized page)

**Job:** let someone outside the organization — a client — approve or request changes on one specific piece of content using a private link, with no login.

**Shown:** a content preview (media, title, caption); whether this link has already been used.

**Actions:** **Approve** (primary, commits immediately, not reversible from this page, no second confirmation step); **Request Changes** (primary, same immediacy and lack of confirmation), each with an optional written feedback field.

**States:** loading; token invalid/errored; already completed (shown identically whether from a prior visit or the action that was just taken); success confirmation; a generic action-failure notice.

There is no second confirmation before either irreversible action, no visibility into stage metadata/due dates/brand instructions, and no structured identity capture for who the external reviewer actually is — only that they hold a valid token.

**Entry points:** a link containing a private review token. **A real gap:** the capability to generate this link exists on the backend, but no reliable button for creating it could be found anywhere in the member-facing screens — meaning a member may currently need to obtain this link some other way entirely.
**Exit points:** none — a standalone action page; the outcome feeds back into the organization's internal review state invisibly to the external person.

**Constraints:** no login/session required — access is entirely "possession of a valid, unused token"; one token = one use, with no visible link-lifecycle status (active/expired/used) shown to internal members and no documented revoke control.

---

## 5. Screen Inventory — Organization Admin

Everything below additionally requires the Owner or Admin role.

### 5.1 Overview

**Job:** the admin's operational pulse for the whole organization in one place.

**Shown, ranked by importance:** member activity; upcoming schedule; review bottlenecks (which stage/role has a backlog, computed); recent asset activity; shared connected-account health; task counts.

**Actions:** jump to Calendar, Library, or Settings (an account-health "manage" shortcut) — nothing is mutated directly from this screen, it is purely a summary and dispatch surface.

**States:** loading; empty (a brand-new organization with no activity yet).

Cards here deep-link to broad destination screens rather than the specific filtered view a person would expect (clicking a bottleneck doesn't open a pre-filtered board; clicking an upcoming post doesn't open that post). There's no historical/trend view of these numbers over time, and the figures shown here are not guaranteed to use the exact same definitions as the destination screens they link to — so counts can appear to disagree between this screen and, say, the calendar.

**Entry points:** default landing screen for Owner/Admin; the organization navigation menu.
**Exit points:** Calendar, Library, Settings.

### 5.2 Brand Kit (organization)

**Job:** define the brand rules a given brand/client project should follow, so AI-generated and human-made output both stay on-brand.

**Shown, ranked by importance:** identity (tagline etc.); voice guidance (tone, voice description, content pillars, target audience); AI prompt guidance (prompt prefix, extended instructions, banned phrases); approved hashtag sets; visual identity (logo choice, palette, typography notes, style notes); who besides admins is allowed to edit this kit; a computed completeness indicator.

**Actions:** edit and save any section independently (reversible only in the sense that you can edit again — **there is no version history; a save simply overwrites the previous value with no diff or undo**); choose a primary/secondary logo from the asset library; grant or revoke "brand kit editor" status to specific members, admin-only.

**States:** loading; a distinct, specific empty message per field rather than one blank-page state; a save success/error notice; view is open to any member, but editing is blocked unless Owner/Admin or an individually granted editor — the page does not clearly signal "you can view but not edit" as its own state.

**Entry points:** the admin navigation menu (an admin-only navigation entry, even though non-admin editors can also use the page once they know its address — a real discoverability gap); scoped by whichever brand project is currently active.
**Exit points:** the asset library, for managing underlying logo/brand files.

**Constraints:** membership alone is enough to load this page; edit rights are checked separately, in the page and again on the server; each section saves independently rather than as one combined form.

### 5.3 Members

**Job:** manage who's in the organization — invite, assign role, scope brand-project access, and apply individual permission overrides.

**Shown, ranked by importance:** the member table (identity, role, project scope, effective permissions); active pending invite links; invite history (revoked/expired/accepted); a per-member override panel showing individual permission changes layered on their role.

**Actions:** invite a new member, choosing a role template and optional brand-project scope — creates a shareable onboarding link, default delivery is a manually-shared link rather than automatic email (primary); copy the onboarding link; regenerate it, which invalidates the old one (secondary, not reversible for the old link); revoke a pending invite (secondary, reversible only by re-inviting); delete an invitation record, only once it's already revoked or expired (rare, not reversible); change a member's role template (primary); apply individual permission overrides (secondary); adjust brand-project scope — must choose at least one project or explicitly grant all (secondary).

**States:** loading; empty (no members beyond the owner yet; no active invites yet; no invite history yet); errors for each action, each with its own specific notice.

**A real, named gap:** there is **no way anywhere on this screen to suspend, reactivate, or remove an existing member**, even though the underlying data model supports that state — member lifecycle today stops at "invite" and "edit permissions." There's also no bulk editing (one member at a time only) and no "preview what this actually changes" step before saving an override.

**Entry points:** the admin navigation menu.
**Exit points:** feeds the onboarding link into the public Join page; role templates are sourced from the Roles screen.

**Constraints:** does not update live — the list refreshes after an action completes, not via a live push; the Owner role cannot be reassigned away from anyone using this screen's controls, with no documented alternate path.

### 5.4 Roles & Permissions

**Job:** define reusable role templates that set default permissions for everyone assigned that role.

**Shown:** the list of role templates (the five system roles, plus any custom ones); a permission editor per template across the capability groups in Section 2.2; how many members are currently on each template.

**Actions:** edit a system role's permissions and display name (its underlying identity cannot be changed, though the editor doesn't make this obvious) (primary); create a custom role, blocked if unnamed (secondary); duplicate a role (secondary); delete a custom role — blocked while anyone is still assigned to it, confirmed with a plain dialog naming the role, not reversible once confirmed (rare); system roles cannot be deleted at all.

**States:** loading; empty (essentially only possible before system roles exist, i.e. never in practice); a role with nobody on it shows its own "no members yet" note; save/duplicate/delete errors.

**A real, named risk:** the "is anyone still using this role" check reads a count at page-load time rather than guaranteeing it at the moment of deletion — someone could theoretically be assigned to a role in between, a genuine (if rare) race condition. There is also no "here's what changes for the N people on this role" preview before saving a permission edit, and no history of role-template changes over time.

**Entry points:** the admin navigation menu.
**Exit points:** none direct — actual member-to-role assignment happens on the Members screen.

### 5.5 Pipelines (review workflow configuration)

**Job:** design the organization's content-review workflow — stages, ownership, timing expectations, and defaults.

**Shown:** the list of pipeline configurations; an ordered stage list per configuration, each carrying an assignment (a role or a specific person), an expected turnaround time, an escalation contact, whether the stage is optional, whether rejecting there requires a comment, and whether reaching it should generate an external client-review link; which configuration is the organization's current default; a gallery of starter templates.

**Actions:** create a pipeline from scratch or a template, blocked if unnamed (primary); edit stages — add, reorder, configure each one's rules (primary); duplicate a pipeline (secondary); delete one, confirmed with a plain dialog naming it, not reversible (rare); set a configuration as the organization default (secondary).

**States:** loading; empty (no configurations yet); no stage selected in the editor; save/duplicate/delete/set-default errors.

**A real, named gap:** there is **no visibility anywhere on this screen into how many active review items are currently using a given configuration** — an admin can edit or even delete a configuration's shape without knowing it will affect in-flight work, and an edit to the active default applies immediately with no rollback.

**Entry points:** the admin navigation menu, scoped to whichever brand project is active.
**Exit points:** none direct — its output (stage rules, the default choice) is consumed passively by the draft-submission flow and by review actions elsewhere.

### 5.6 Credits

**Job:** the organization's AI-generation credit pool, usage, and outstanding member requests for more allowance.

**Shown:** monthly credit pool total; credits used this period; pending request count; a request table (requester, amount requested, status) — the requester is shown by a raw internal identifier rather than a resolved name in at least one place, a real usability gap.

**Actions:** approve a request (full or a typed-in partial amount), deny it, or partially approve it, each requiring a positive amount and each optionally taking an admin note — none of these has an explicit "undo," only a subsequent adjustment.

**States:** loading; empty (no requests yet); an error notice for a failed decision; a distinct success notice per action (approved / partially approved / denied).

**Entry points:** the admin navigation menu; a credit-count indicator elsewhere in the shell.
**Exit points:** none direct.

**Constraints:** does not update live — relies on an explicit refresh after an action; a member's individual monthly cap (set on the Members screen) and the organization-wide pool shown here are two different, related levers worth keeping conceptually distinct in any redesign.

### 5.7 Organization Settings

**Job:** operational settings for the organization's shared publishing accounts and its custom task-status list — currently bundled with a read-only organization-identity summary and no sub-navigation between the three.

**Sub-area — Connected Accounts (organization):**
- **Shown:** the organization's connected accounts (platform, name, health); recent connection events; who can publish through each account; the supported platform list.
- **Actions:** connect a new shared account (primary); edit details (secondary); reconnect after an auth/health issue (secondary); disconnect, with a plain confirmation and no clear reversibility beyond reconnecting from scratch (rare); grant or revoke which specific members can publish to a given account, limited to people who otherwise have publish rights (secondary).
- **States:** empty (no accounts connected yet); action-specific success/error notices. Account connections in this environment use simulated rather than live third-party authentication — this should be confirmed with engineering as either an intentional interim state or something materially affecting what "connect" should feel like in a redesign.

**Sub-area — Task Status Manager:**
- **Shown:** the organization's ordered, custom list of task statuses.
- **Actions:** create, edit (name/order/grouping), or delete a status — deletion has **no documented check for how many tasks currently use that status**, and no described migration path for what happens to them.

**Sub-area — Organization summary:** read-only cards (name, plan, current default pipeline, task-status count) — **none of these are editable from this screen**, and there is no general "edit organization name/logo/plan" surface documented anywhere in this admin scope; the default-pipeline value shown here has no direct edit action (that lives on the Pipelines screen).

**Entry points:** the admin navigation menu; the Overview account-health card's "manage" shortcut.
**Exit points:** none direct — task-status changes propagate automatically into the calendar's task view; account-access changes affect who can publish, enforced elsewhere.

---

## 6. Screen Inventory — Platform Admin (Internal Operations Console)

Twelve screens, all behind an "admin required" gate, reached from a persistent admin navigation shell that also carries a notification center and an admin account menu. See Section 2.3 for which of the two admin identities can reach each one.

### 6.1 Admin Overview

**Job:** a live health snapshot of the whole platform in one landing view.

**Shown, ranked by importance:** risk alerts and risk-category counts (real-time, with a dedicated real-time feed specifically for the most severe tier); a list of "at-risk" users (**not currently clickable through to their record** — a real gap); connected-account severity alerts (real-time); a generation-activity trend chart over a selectable time range; user volume, queued publishing work, and complaint counts; a moderation-pressure indicator.

**Actions:** change the trend chart's time range (view-only, affects nothing else on the page, and is not remembered between visits) (secondary); acknowledge a high-severity risk notification via a dedicated step (rare) — this has no documented protection against firing twice if several alerts arrive in a burst; jump to Logs from risk/health cards, or to a specific complaint from the complaint list (secondary).

**States:** loading; partial (several independent data sources resolve separately); an org-scoped admin sees the same layout with numbers silently narrowed to their organization; no documented empty/first-use treatment for a brand-new platform with no data yet.

**Entry points:** default landing screen for the admin console.
**Exit points:** Logs; a specific complaint's detail screen. Not currently possible: clicking from the at-risk-users list to that user's record.

### 6.2 User Directory

**Job:** the searchable roster of every platform user, for at-a-glance activity/usage checks and quick account operations.

**Shown:** identity; organization; connected-account, generation, and post counts; an activity-status read; suspension state.

**Actions:** search (with a short deliberate delay before it takes effect) and filter by activity/organization (primary); select one or many rows for bulk action (secondary); suspend a user, singly or in bulk, with a confirmation step (secondary, high-impact, reversible via a separate unsuspend); unsuspend — **only available one at a time, with no bulk-unsuspend counterpart to bulk-suspend**, a real asymmetry; send a password-reset email (not reversible, though it can be re-sent); export the current view (or just a selection) to a spreadsheet file; open a user's full record (primary).

**States:** loading; empty (no users yet); empty-filtered-to-nothing; partial (per-user counts can lag the base roster); an org-scoped admin sees only their organization's users, silently narrowed.

**A real gap:** there's no documented behavior for a partial failure inside a bulk suspend (e.g. 8 of 10 succeed), and no shortcut from a user row directly into their complaints or moderation history filtered to them — both would be natural but don't exist today.

**Entry points:** admin navigation.
**Exit points:** a specific user's detail record; a downloaded export file.

**Constraints:** the roster is paginated, not a single unbounded list; it updates live as underlying records change; export supports two distinct modes ("everything currently filtered" vs. "just what I selected") that must stay distinguishable; a page-size preference exists conceptually in Admin Settings but is **not actually wired** to this screen.

### 6.3 User Detail

**Job:** the single-user investigation workspace — profile, connected accounts, content, calendar, complaints, internal notes, and security actions, all in one place.

**Shown, organized into tabs (**Overview, Platforms, Posts, Calendar, Activity, Complaints, Analytics, Security**):** profile fields; this person's connected platform accounts; their posts/generations (through an embedded, person-scoped version of the moderation workspace) with quality scores; their scheduling/calendar data; an activity-log filtered to them; complaint history involving them; internal admin-only notes; risk/quality badges; basic analytics for this person specifically.

**Actions:** add/edit/delete an internal note — private to admins, and every write is itself logged (primary, core to investigation); suspend/unsuspend (secondary, high-impact, reversible as a pair); send a password-reset email (not reversible); send this person a direct notification via a composer (not reversible — a message can't be unsent); **request user deletion** — does not delete immediately, submits an approval request and requires typed confirmation before it can be sent; **there is currently no screen anywhere that approves or executes these requests**, making this a dead end beyond submission (rare, the highest-impact action on this screen); quick-update a complaint's status or add a comment from the Complaints tab — **a known defect: if this person has more than one complaint, a quick comment always attaches to their newest one regardless of which is actually under investigation**, with no selector to choose the right one; a "revoke publishing access" control is present but is a **non-functional placeholder today**; edit a scheduled post from the Calendar tab; view/edit/force-publish/force-schedule/archive/request-deletion of a specific post via the embedded moderation view (same action set and caveats as the full Moderation Workspace, Section 6.5).

**States:** loading (an aggregate fetch across many sources); empty per tab (a person with no posts/complaints/notes yet); tabs load somewhat independently, so one can be ready while another is still loading; permission-denied for a person outside the admin's scope; editing in one tab (calendar or moderation) does not reliably refresh what other open tabs show — a real staleness risk during a long investigation.

**Entry points:** a row in the User Directory; an admin notification referencing this person.
**Exit points:** the embedded moderation actions; complaint quick-actions (with the newest-complaint caveat above). Not currently possible: jumping from a connected-account card here straight into the Account Maintenance console for that same account — an investigator has to leave and manually re-find it.

**Constraints:** no documented row caps on any tab's lists — treat as unbounded.

### 6.4 Connected Account Maintenance ("Accounts")

**Job:** the platform-operator-only console for monitoring every connected social-platform account's health, triaging severity alerts, and intervening directly. Organization-scoped admins see a hard-blocked screen instead of this page entirely.

**Shown:** a health summary strip; the full account table with per-account health; unresolved severity alerts; per-account connection-event history; per-account admin-action history; support notes attached to an account; organization/person labels for context; filter state (status, scope, platform, health tier, search).

**Actions, all through one shared execution pathway:** force reconnect (primary/secondary); clear accumulated failure counters (secondary, not reversible — history is cleared, not archived); reset the computed health tier to a baseline (secondary); **force disconnect** — the most destructive action here, and **no confirmation step is documented for it** (rare, flagged as a likely missing safeguard); resolve an alert (secondary, no documented "reopen"); add a support note (secondary); manage which members can use/manage a given account (secondary, reversible, flagged as high-risk if organization-scope checks are weak); navigate to the related user or organization record.

**States:** loading; empty (no accounts or alerts — a genuinely healthy platform); filtered-to-nothing; a busy/in-progress state while an action executes; **no documented success/confirmation for any action, including the destructive ones**; org-scoped admins never reach this page (hard block).

**A real gap:** no automatic re-check after an action completes to confirm an intervention actually worked.

**Entry points:** admin navigation (operator only); investigate-style links from alerts surfaced elsewhere.
**Exit points:** the related user or organization record. Not currently possible: a direct/shareable link into one specific account's detail; this console's own activity is not merged into the platform's main Logs timeline.

**Constraints:** **this screen does not update in real time at all** — two operators working it simultaneously will not see each other's changes without a manual refresh or taking their own action.

### 6.5 Organizations List

**Job:** where operators provision new organizations and track owner-onboarding progress before drilling into a specific one.

**Shown:** organization rows (identity, plan); owner identity per organization; onboarding/invitation status.

**Actions:** create a new organization, which immediately requests an owner-onboarding invitation (primary, this screen's core purpose, no documented delete/undo); generate or regenerate an owner onboarding link, replacing any prior one (primary/secondary, reversible by regenerating again).

**States:** loading; empty (no organizations yet); **there is no search, filter, or sort control on this screen at all**, so "filtered to nothing" cannot currently occur — a named scale gap, since the entire list loads at once regardless of how many tenants exist; org-scoped admins see a hard-blocked screen.

**Entry points:** admin navigation (operator only).
**Exit points:** a specific organization's detail screen; generated onboarding links lead an invited owner to an external join flow outside this console.

**Constraints:** no pagination/search/sort exists today — this will not scale gracefully as tenant count grows.

### 6.6 Organization Detail

**Job:** a focused, read-only snapshot of one tenant: owner, onboarding state, members, recent complaints.

**Shown:** owner snapshot; onboarding/provisioning status; member list; recent complaints tied to this organization.

**Actions: none.** This screen is explicitly read-only today — no suspend, no owner reassignment, no member edits, no status changes of any kind. This is a documented current limitation, not an intentional minimalist design.

**States:** loading; empty (no members or complaints yet); org-scoped admins see a hard-blocked screen.

**Entry points:** a row on the Organizations List.
**Exit points:** **none today** — member and complaint rows are display-only and do not link to their corresponding detail screens, even though the underlying IDs exist. A genuine dead end as currently built, and real design latitude exists here for redesign (add actions and cross-navigation, or keep it deliberately minimal — this is an open product question, not a constraint).

### 6.7 Content Moderation Workspace

**Job:** the cross-user queue where operators review, edit, schedule, force-publish, archive, delete, and regenerate content platform-wide (or within their scope).

**Shown:** queue rows across users, grouped (e.g. by date); quality-review scores; connected-account/platform context; media references; organization/role labels; a full detail/edit view for a selected item; filter options.

**Actions:** save edits to a draft (primary); **force publish / force schedule** — pushes content live or onto the schedule immediately, bypassing the normal flow; a readiness check runs first, but **no confirmation dialog is documented**, and once actually published externally this cannot be recalled through this tool (rare, the highest-impact action on this screen); archive an item (secondary, presumably recoverable though not explicitly documented); submit a deletion request — does not delete immediately, and, as with User Detail, **there is no visible screen anywhere that approves or executes these requests** (rare, currently a dead end); bulk-approve multiple items (secondary); rescore quality (secondary, rerunnable); regenerate content or promote a prior version to canonical, or analyze uploaded media — three optional capabilities that only work where the supporting backend is deployed in a given environment, otherwise showing some fallback/unavailable messaging; an "assign reviewer" control is visible but **permanently disabled and not backed by any real data model today**.

**States:** loading; empty (nothing in queue); filtered-to-nothing; a degraded-capability state when an optional backend feature isn't deployed in the current environment (real, not hypothetical); org-scoped admins see only their organization's items, silently; **no documented success/confirmation for any action, including force-publish** — a genuine open design question.

**Entry points:** admin navigation (full queue); deep-linked from a complaint pointing at a specific post/generation; embedded inside a user's own Posts tab; from a user's calendar tab with a specific post pre-selected; an old, separate content-review address now simply redirects here.
**Exit points:** "view user" → User Detail; actions feed the audit trail and, for deletion requests, the currently-dead-end approval queue.

**Constraints:** paginated, not unbounded; **updates live**, so the list can shift under an operator's cursor mid-review; a documented risk of duplicate actions from retries if requests aren't deduplicated.

### 6.8 Complaints Queue

**Job:** the platform-wide support-ticket queue — filter, quickly flag as being worked, and jump into full casework.

**Shown:** rows (submitter, subject, status, priority, assigned admin); status tabs (All, Pending, Under Review, Resolved, Closed); search and priority filter state.

**Actions:** filter/search/switch tabs (primary); mark a ticket "Under Review" directly from the list, with **no confirmation step** (primary/secondary); open full detail (primary).

**States:** loading; empty (no complaints yet); filtered-to-nothing (e.g. the Resolved tab before anything's been resolved); partial (profile-label enrichment can lag); org-scoped admins see only their organization's complaints, silently narrowed; **this list does not update live — the only way to see another admin's change is a manual reload**, so it can be silently stale.

**Entry points:** admin navigation; notification links referencing a complaint.
**Exit points:** a specific complaint's detail screen — **no other row-level shortcuts exist** (no "view this complaint's user" or "view the related content" from the queue row itself; those only exist once inside detail).

**Constraints:** **hard-capped at the latest 100 rows, with no pagination at all** — any organization/platform with more than 100 complaints in view will have older ones silently invisible today; a per-complaint due-by value exists in the data but is **not surfaced anywhere on this screen**.

### 6.9 Complaint Detail

**Job:** full casework for one complaint — context, ownership, status/resolution, history, and internal discussion.

**Shown:** complaint summary (subject, description, submitter, organization); an attached screenshot, if any, accessed via a temporary time-limited link rather than a permanent one; a status-change history timeline; an internal discussion thread (admin- and user-authored comments); a list of admins eligible for reassignment, **with no workload/availability information attached**.

**Actions:** update status — submitted/under review/resolved/closed (primary); reassign to a different admin (secondary); add resolution notes as part of a status update (primary); add an internal comment, not documented as editable/deletable afterward (primary); navigate to the related user, post, or generation ("View User" / "View Post" / "View Generation"). All status/assignment/resolution changes go through one shared action that also writes a history entry, an admin notification, an audit-log entry, and — specifically when the new status is "resolved" — a notification to the person who submitted it.

**States:** loading; empty (a brand-new complaint with no comments/history yet); page access and the ability to actually perform a specific mutation are **not guaranteed to be the same gate** — a page can load while a given action is still denied by backend policy; **a real, named conflict gap: if two admins have the same complaint open, the second save can silently overwrite the first, with no warning to either admin and no live refresh to reveal the record changed underneath them.**

**Entry points:** the Complaints Queue; admin notifications referencing this complaint; quick links elsewhere.
**Exit points:** the related user's or content's screen, via the three "View" actions above.

**Constraints:** no version/conflict guard on saves (the silent-overwrite risk above is real, not hypothetical); no live refresh while the page is open.

### 6.10 Logs

**Job:** the forensic timeline for platform operations — audit events and connection events — filterable and groupable, for incident investigation. Organization-scoped admins see a hard-blocked screen; this is operator-only.

**Shown:** two switchable domains — platform audit events, and connected-account connection events; enrichment with related user/account/organization labels; grouping modes (flat, by user, by account); filter state, including filters arriving via links from other screens.

**Actions:** switch log source; filter/search/group (primary). **No row-level navigation exists** — clicking a row does not lead anywhere, even when it clearly references a specific user/complaint/post/organization with a real identifier.

**States:** loading; empty (a quiet platform); filtered-to-nothing; partial (label enrichment can lag).

**A real, documented near-bug:** other screens pass a "severity" scope into this screen's link (e.g., "show me the errors"), but this screen **does not actually apply that filter on arrival** — an admin following such a link silently sees the unfiltered view instead of what was implied.

**Entry points:** admin navigation; deep-linked from Overview's risk/health cards and from the account-severity panel, each implying a different starting scope that (per the near-bug above) doesn't always actually apply.
**Exit points:** a "clear scope" action resets the view — **no exits to any entity detail screen exist**; this is a fully dead-end page in terms of forward navigation.

**Constraints:** **each source is hard-capped at 200 rows, with no pagination and no export capability** — a named, explicit gap for a page whose entire purpose is investigation; a third relevant event stream (admin actions taken on connected accounts) exists in the data but is **not merged into this timeline** — a complete operational history today requires checking two separate places.

### 6.11 Analytics (platform admin)

**Job:** operational reporting for admin teams — active-user bands, generation/publish throughput, quality-score distribution, connected-account mix, organization-level output.

**Shown — mixed real and placeholder data, and this distinction matters enormously for the redesign:**
- Real/live/computed: KPI cards; an activity-bands chart (a modeled estimate, not a raw measured figure, when explicit activity data is missing); a quality-score distribution; platform/connected-account mix; an organization leaderboard (a **present-moment snapshot only** — it does not reflect historical membership changes, so it cannot represent true historical ranking).
- **Fully mock/placeholder: a set of "platform API" metric cards showing hard-coded values with no live data behind them at all.** These do not read from the real analytics-ingestion data that otherwise exists in the system. **This is the single most important data-provenance fact on this screen** — these cards must be visually and functionally distinguished as illustrative-only, and today there is no such distinction at all.

**Actions:** none beyond passive viewing — no date-range control, no filter, and no click-through from any chart into another screen.

**States:** loading; empty (a brand-new platform/organization with no activity yet); an org-scoped admin sees the same layout restricted to their organization's users, silently; **there is no way to change the reporting window at all** — everything shown is an implicit, all-time aggregate.

**Entry points:** admin navigation.
**Exit points:** none — no chart, KPI, or row leads anywhere else.

### 6.12 Admin Settings (platform)

**Job:** the operator's own workspace preferences and personal security actions — not organizational or platform configuration.

**Shown, in four tabs (**Profile, Security, Preferences, Notifications**):** profile identity; a computed role/scope label; local preference values; notification-type toggles.

**Actions:** trigger a password-reset email (Security, not reversible once sent, can be retriggered); toggle preferences (Preferences) — **reversible, but does not change any actual behavior anywhere else in the workspace today**; toggle notification-type settings (Notifications) — same caveat, **does not actually filter or change what notifications are delivered**; an avatar-upload control and a two-factor-authentication control are both present as **non-functional placeholders**; there is **no active-session management at all** (no session list, no revoke capability).

**States:** loading; an error state for a failed password-reset send; no permission-denied state (identical for both admin identities); no empty/filtered states (a fixed set of fields, not a list).

**Entry points:** admin navigation and the admin account menu; a specific tab is directly linkable.
**Exit points:** none — a terminal screen; the only "exit" is the password-reset email flow, which continues outside the console entirely.

**Constraints:** preferences are stored on a single device/browser only — an operator using two machines will see different, unreconciled preference states on each; nothing configured here currently affects live behavior anywhere else in the console (e.g., turning off a notification type here does not suppress it in the Overview screen or the notification center).

---

## 7. User Flows

### Flow 1 — A new individual signs up and completes first setup

1. Person registers, choosing Individual, Organization, or Agency. Organization/Agency additionally requires a name and an auto-suggested, editable workspace address.
2. Submits via email/password or Google. Email signups requiring confirmation are bounced to Login with a "check your email" notice. Google signups pass through the automatic callback step, which creates a profile and grants a starting credit allowance if one doesn't exist yet.
3. **Decision point:** was this an organization/agency signup? If yes, an automatic provisioning step runs next. **Failure path:** if the organization name/address is rejected, there is no way to correct it from this step — the person must abandon and re-register from scratch.
4. If the person belongs to more than one workspace, they choose one; otherwise they land directly on the personal dashboard.
5. First-time dashboard shows an onboarding checklist: account created (done), connect a social account, generate a first post.
6. Person connects a platform account (real or simulated, depending on environment) or skips straight to Generate.
7. On first visit to Generate, if brand identity setup isn't complete, a one-time nudge points toward Brand Kit Settings.
8. Person completes their brand kit via document upload (fast, though extraction quality is currently a placeholder), guided conversation, or manual form — landing on a review step they must explicitly save.
9. The brand kit now informs every later generation; the person proceeds into Flow 2.

### Flow 2 — A person generates content and gets it scheduled or published

1. Opens Generate, which automatically starts or resumes a working session.
2. Picks a mode, model, and format settings; writes or refines a prompt (optionally guided, optionally AI-enhanced).
3. The generate action is gated by a live credit-cost estimate versus their balance — if short, the button is disabled in advance with a clear explanation, not failed after the fact.
4. Generation runs. Images/carousels complete inline; video runs a longer, separately-tracked queued → processing (2–4 real minutes) → done/failed lifecycle that survives navigating elsewhere. **Failure path:** video failures show a clear retry prompt; other failures surface as a brief notice.
5. Person opens the post-production step on a finished result: writes/edits title, caption, hashtags, reviews a computed readiness score, picks target platform account(s).
6. Chooses to save as a draft, schedule it (opens a date/time picker, lands it on the calendar as scheduled), or publish immediately (moves through a publishing state to published/failed per account). **Conflict path:** if the chosen time/account is already taken, the person must explicitly confirm scheduling anyway — nothing is silently overwritten. **Multi-account path:** each destination account gets its own outcome, summarized together.
7. The result is now visible and manageable from the Calendar (if scheduled/published) and the Library (if it produced new media).

### Flow 3 — A person investigates why something failed

**Failed generation:** the person sees an immediate notice (or, for video, a dedicated failure prompt). There is no dedicated failure log screen — the main recourse is retrying from the same session, or, if that keeps failing, manually opening Help and describing what happened (nothing pre-fills from the failure itself — a real gap).

**Failed post/publish:** the Calendar shows a clear "failed" status and reflects it in its weekly health summary. A suggested command offers to reschedule failed posts to the next open slot in one step. Opening the post's detail lets the person manually reschedule, duplicate, or delete it. As with generation failures, there is no direct link from a failed post into a pre-filled support ticket.

**Account/connection health issue:** Settings shows a health indicator per connected account with a detail view; available fixes are reconnect or disconnect-and-reconnect. The dashboard's account-health card links to this same place — there is no separate diagnostic surface beyond it.

### Flow 4 — A person submits a help/support ticket

1. Opens Help, switches to "My Support Tickets."
2. Starts a new ticket: category, title (under 100 characters), description (20–1000 characters), optional screenshot (image only, under 5MB).
3. On submit, the app records the ticket and notifies admins (with a fallback path if that notification itself fails, so the report isn't silently lost).
4. Person sees a success confirmation; the new ticket appears with status "Submitted."
5. As support works it, status can move to "Under Review," then "Resolved" (with a resolution note and who closed it) or "Closed." If the ticket has any timeline entries, expanding it shows the status history and any support replies with timestamps.
6. When resolved/closed, the person gets a notification; opening it clears the unread state.

### Flow 5 — A new team member accepts an invitation and completes onboarding

1. Receives an invitation link (typically shared manually, not auto-emailed) and opens it.
2. **Failure paths, each a static dead end with no in-page recovery today:** the link has no token; the invitation was already used; it was revoked; it expired.
3. If the invitation is valid: already signed in with a matching email auto-accepts with no further input; signed in with the wrong email requires signing out and reopening the link; not signed in with an existing account for that email redirects to a pre-filled sign-in; not signed in with no existing account shows a password-setup step (minimum 10 characters, must confirm-match).
4. On success, ordinary members land on My Workspace; admins/owners land on Overview. **No first-run tour, checklist, or role-specific orientation exists after this point** — a real gap.

### Flow 6 — A contributor drafts, submits, and gets content approved and scheduled

1. Drafts content in My Office (or starts from My Workspace); it's saved privately, fully editable, visible to no one else yet.
2. Submits it into review. **Failure path:** blocked with a specific, actionable message if no brand/project is assigned yet.
3. On success, it becomes a review item at the organization's applicable first stage, and disappears from the draft list. It now shows on the Pipeline Board (status only) and in the relevant Org Calendar review views.
4. A reviewer/editor/admin acts on it (see Flow 7 for the revision branch). Once approved, it becomes schedulable.
5. Whoever has scheduling rights and can act on the item opens the schedule step from the calendar and sets a time, or publishes immediately. **Failure path:** can fail if the destination account isn't one they're authorized to post to, or on an internal scheduling-context problem.
6. Once scheduled/published, it shows as such on the calendar — there is no explicit "notify the original drafter it went live" step documented.

### Flow 7 — A reviewer/editor sends content back for changes, and the contributor resubmits

1. Reviewer/editor sees the item in a review view, scoped to what they're allowed to act on (everything for Editor/Admin/Owner, only their own assignments for a Reviewer).
2. Chooses to reject or request changes. **A hard, enforced constraint:** this cannot proceed without a written comment.
3. On request-changes, the item's stage becomes "changes requested" and should reappear as an actionable item for the original contributor — though the same comment isn't guaranteed to look and feel consistent everywhere it resurfaces (My Workspace's card vs. the generator's edit state vs. My Office).
4. On reject, the item moves to a rejected/archived state; whether it can ever be revived or must be fully redone is not clearly documented — worth confirming with engineering.
5. Contributor opens the flagged item, makes changes, and resubmits. **A real gap:** navigating away to fix something and back doesn't reliably preserve exactly which item was being worked on.
6. The item re-enters review at the appropriate stage, and the cycle repeats until approved or rejected outright.

### Flow 8 — An org admin invites a member, assigns a role, and configures the review pipeline

1. Opens Members, chooses a role template (optionally scoping the invite to specific brand projects). Any prior pending invite for that same email is automatically revoked first. Delivery is typically a manually-shared link.
2. Can copy, regenerate, revoke, or delete the invite while it's outstanding — deletion only once it's already revoked or expired.
3. Separately, visits Roles & Permissions to review or customize what that role grants, or creates a custom template. **Constraint:** a role's underlying identity can't change once created, only its name/permissions; a custom role can't be deleted while anyone's assigned to it; system roles can never be deleted.
4. Visits Pipelines to define the review workflow: ordered stages, each with an assignment rule, an expected turnaround time, an escalation contact, whether it's optional, whether rejecting there needs a comment, and whether it should generate a client-review link. **Failure/edge case:** no warning is given about how many live items already use a configuration before it's edited or deleted, and changes to the active default apply immediately with no rollback.
5. Once the invited person accepts (Flow 5), their effective permissions become: role defaults → any organization-specific template edits → any individual override the admin applies directly, which can happen at any time, independent of re-inviting.

### Flow 9 — An external client reviews content via a tokenized link

1. Receives a link containing a private review token (how they got it is not clearly documented on the internal side — see Section 8, UX Problems).
2. Opens it with no login required. The token's associated content preview loads. **Failure path:** an invalid/expired/bad token shows a plain "unavailable" state, dead end. **Already-used path:** shown a "this review has been completed" state, identical whether just-completed or revisited later.
3. Reviews the preview, optionally types feedback, and chooses Approve or Request Changes. **No confirmation step exists before this commits** — the click is the commitment, with no undo.
4. On submit, the token is marked used, the internal review state updates accordingly, and the client sees a completed confirmation. **Failure path:** a generic failure notice if the submission itself errors, with no further documented recovery guidance.
5. The outcome feeds back into the organization's internal review state, but nothing tells the client what happens next, and no documented internal notification confirms to the team that a client decision just landed.

### Flow 10 — An operator investigates a user (from an alert or complaint to resolution)

1. **Trigger:** a high-severity risk notification naming a user, a complaint naming a user, or a direct directory search.
2. Opens that user's detail record and reviews across tabs: profile, connected accounts, content and its quality scores, complaint history, existing notes.
3. **Decision point:** is this a content problem, an account/security problem, or a support/behavior problem?
4. If content-related, acts through the embedded, person-scoped moderation view (edit, force action, archive, request deletion — see Flow 11 for the force-action sub-path).
5. If account-related, would ideally jump straight to that account in the accounts console — **no such direct link exists today**; the operator must leave and manually re-find it.
6. If complaint-related, can quick-update status or comment from the Complaints tab — **known failure path:** a quick comment always lands on the person's *newest* complaint, not necessarily the one under investigation, so operators should instead open that specific complaint's own detail screen directly (Flow-adjacent) to avoid misfiling.
7. Records findings as an internal note (itself logged). Takes a resolving action: direct notification, password reset, suspend/unsuspend, or — rare and highest-impact — a deletion request with typed confirmation. **Failure path:** that request has no documented approval screen anywhere, making it a dead end beyond submission if scope or workflow requires one.

### Flow 11 — An operator moderates content through to a force action

1. Opens the moderation workspace (directly, embedded in a user's Posts tab, or deep-linked from a complaint pointing at specific content).
2. Reviews the item: content, quality score, platform/account context, prior versions.
3. **Decision point:** does it need edits first, or is it ready? If edits are needed, edits and saves; it stays in queue.
4. If ready, proceeds toward a force action. A readiness check runs first — what exactly is shown if it fails is not documented, an open design question.
5. Executes: force publish, force schedule, archive, or submits a deletion request instead. **Reversibility:** a successful force-publish cannot be undone through this tool once content is actually live externally; a deletion request does not delete immediately and, per known gaps, has no visible approval screen anywhere.
6. **Optional side path:** regenerate, promote a different version, or analyze media — each depends on an optional backend capability that may not be deployed in every environment, in which case a fallback/unavailable message should appear (exact wording not yet defined).
7. **Resolution:** content ends published, scheduled, archived, or pending-deletion (with no documented downstream approval); the action and actor are captured in the audit trail regardless of outcome.

---

## 8. Real Content Samples

Real, verbatim product copy — not placeholder text — so the design team can see the product's actual voice and real string lengths.

### 8.1 Status labels (exact display strings used today)

- **Generation:** Queued, Processing, Completed, Failed
- **Post:** Draft, Scheduled, Publishing, Published, Failed, Archived
- **Review item:** Pending, In Review, Revision Requested, Approved, Rejected, Withdrawn, Scheduled, Published
- **Support ticket:** Submitted ("We've received your report and it's in the queue."), Under Review ("Our team is actively looking into this."), Resolved ("This issue has been fixed or addressed."), Closed ("This ticket has been closed.")
- **Risk level:** None, Low, Medium, High, Very High, Critical
- **Credit request:** pending, approved, denied, partial
- **Complaint/ticket category:** Content Generation, Publishing, Scheduling & Calendar, Account & Settings, Credits & Billing, Platform Connections, Other

### 8.2 Real FAQ content (verbatim, representative sample across all five sections)

- **"Why did my generation fail?"** — "Generation failures are usually temporary processing issues, unsupported input, or a missing media result. Retry from the same session first. If the problem keeps happening, submit a ticket with the time and prompt used."
- **"What happens after I schedule a post?"** — "The post is stored with a scheduled state and remains visible in Calendar and related user/admin views. A full automated publishing worker is still part of the roadmap, so some scheduling flows are demo-ready rather than fully production-complete."
- **"Why can't I publish to a platform right now?"** — "This build still treats some platform connections and publishing paths as incomplete or mock-mode. Check your connected account status in Settings first, then raise a support ticket if the account looks healthy but publishing still fails."
- **"How do credits work in this build?"** — "Your profile stores a credits value that is surfaced in the user experience, but credit accounting is still evolving. If credits look incorrect, include a screenshot and the affected workflow in a support ticket."
- **"What can I track in Analytics?"** — "Analytics shows personal app-side platform activity today: generated content, drafts, scheduled posts, published posts, connected account health, and platform mix. Native social media metrics such as views, likes, comments, shares, and audience growth are coming soon."
- **"Do I need to connect a platform before using the product?"** — "No. You can generate content before connecting any accounts. You only need a connected account when you want to schedule or publish to a specific platform."

### 8.3 Example realistic account/content data (good stand-ins for mockups)

Realistic connected-account examples spanning consumer, creator, and B2B account types:
- Instagram — "Nike Official" (@nikeofficial), Business profile, 285,000 followers, category "Brand," personal scope.
- Threads — "Creator Lab" (@creatorlab), Creator profile, 32,000 followers, personal scope.
- LinkedIn — "Acme B2B" (@acmeb2b), Business profile, 12,000 followers, category "Technology," organization scope.

Realistic post/caption examples:
- Instagram, caption "Exploring the beauty of Lagos ✨", hashtags "#travel #lagoslife", status "Pending Review."
- TikTok, caption "My morning routine — no filter 😅", hashtags "#morningvibes #selfcare", status "Needs Modification."
- A post with no title/caption yet displays as "Untitled" alongside its scheduled time (e.g., "12:00 AM / Untitled").

Realistic platform-mix example (for a leaderboard/distribution chart): Instagram 46%, TikTok 30%, YouTube 14%, Facebook 10%.

### 8.4 Real error messages and toasts, by scenario

**Generation:**
- "Invalid prompt: prompt cannot be empty"
- "LLM returned invalid JSON"

**Publishing / scheduling:**
- "Reconnect this account before publishing to it"
- "Select an approval workflow first."
- "Select at least one platform"
- "Title is required before publishing to YouTube"
- "Caption exceeds the {character limit} character limit"
- "Sent for approval. Track progress in Pipeline." (success)
- "Published posts can't be rescheduled" (business-rule error)
- "You do not have posting access to this shared organization account."
- "This content requires final approval before publishing."

**Connected accounts:**
- "{Platform name} is coming soon" (attempting to connect an unsupported platform)
- "Sign in again before connecting a real platform account."

**Library / assets:**
- "You must be signed in to use the Library."
- "A folder with that path already exists."

**Support / admin:**
- "Password reset email sent to {email}." / "Failed to send password reset."
- "Type DELETE {name} to submit the request." (typed-confirmation gate for a user-deletion request)
- "Deletion request submitted for approval."
- "Choose a reviewer before assigning." / "Reviewer assigned to selected content."
- "Content force published." / "Content force scheduled." / "Force action failed."

**Organization admin:**
- "Give this role a name first." / "Move members off this role before deleting it."
- "Give this pipeline a name first."
- "Choose at least one brand project or grant access to all projects."
- "Enter a positive approved amount before continuing." (credit approval)
- "A private group must have a group admin."
- "Add a reviewer comment before rejecting or requesting revision." (enforced, not just suggested)

**Invitations / onboarding:**
- "Invitation link is incomplete" / "This join link does not include a valid token."
- "Invitation already completed" / "This workspace invitation has already been accepted."
- "Invitation has been revoked" / "Ask the platform team to send you a fresh invitation."
- "Invitation has expired" / "This invite is no longer active. Ask the platform team to resend it."
- "Signed in with the wrong account" / "This invitation is for {email}. Sign out, then continue with that account."
- "Choose a password with at least 10 characters." / "The password confirmation does not match."
- "An account already exists for {email}. Sign in to continue with this invitation."

**Client review page:**
- "Loading review..." / "Review unavailable" / "This review has been completed. Thank you for your time."
- "Content approved" / "Feedback submitted" / "Review action failed"

### 8.5 Notification and email content (real subject lines and body text)

**Organization invitation email:**
- Subject (new account): "Complete your {organization name} onboarding" — Subject (existing account): "Accept your invitation to {organization name}"
- Body (new account): "Use the onboarding link below to create your password and enter {organization name} as {role}."
- Call-to-action labels: "Open onboarding" / "Accept invitation"

**Automated risk/ops alerts (admin-facing):**
- "Risk Alert: {domain} failures detected" — e.g. "Risk Alert: Post Publishing failures detected"
- "{count} failures in the last 2 hours"
- "Support tickets need review" — "{count} complaint(s) have been waiting for more than 24 hours"
- Domain names used in these alerts: Content Generation, Post Publishing, Post Scheduling, Platform Connections, User Onboarding, Moderation Actions, Admin Authentication, Backend Functions, Real-time Updates, File Uploads

---

## 9. Honest UX Problem List

These are open questions for the product and design team to resolve — not silent fixes to make during redesign, since some may reflect intentional phasing rather than oversight. Grouped by theme; each is phrased as a question.

### Consistency and terminology
1. **The same underlying object is called by at least four different names depending on where you are:** "generation" while being produced, "draft" once saved, "post" once it has scheduling state, and "content" in moderation/review contexts — one continuum, several names. Should the redesign commit to one consistent word across the whole lifecycle?
2. **"Complaint" (used throughout the data model and much of the internal language) vs. "ticket"/"support request" (used in the language shown to end users)** — even the ticket-status descriptions themselves say "ticket" while the category is called "complaint." Which word should be the one the product uses everywhere?
3. **The word "admin" means different things in different places** — sometimes only the platform-wide operator, sometimes both the platform operator and an organization admin. This isn't just a copy issue; it affects who can enter the admin console at all (see Access, below).
4. **The same review stage is described with different wording in different parts of the same calendar screen** (e.g. one description of the "draft" stage versus another, slightly different one, in a nearby filter control on the same page) — worth a full terminology pass across every surface that shows review/task state.
5. **Cross-page references use different identifier concepts for what is, to the user, "the same thing I was just looking at"** (a post address, a review-item address, a task address, an asset address) with no single shared "here's what I was looking at" concept — this is why so many deep links land on a general screen instead of the specific item (see below).
6. Is a name like **"Generate"** (the product's own navigation label) or an alternate name used in a couple of places in its own empty-state copy the one the product should commit to?

### Deep links and navigation
7. **Deep links routinely lose their destination.** Clicking through from team-chat references, library origin badges, draft-to-review links, and several admin cross-references mostly lands on the *general* destination screen rather than the *specific item* the person came from — this is the single most repeated gap across the whole organization workspace, and it also appears in the admin console (e.g., organization members/complaints don't link to their own detail screens; log rows don't link anywhere). Should every cross-page reference be expected to open a focused item, with a consistent "return to where I came from" pattern designed once?
8. **The Pipeline Board shows status but currently has no working detail view or stage-action controls** — all real review actions happen inside the calendar's own modals instead. Should this screen gain real functionality, be folded into the calendar entirely, or be explicitly repositioned as a pure status overview?
9. **"Team Activity" doesn't do what its name promises** — it shows only review-stage status changes, with nothing about tasks, scheduling, publishing, or team chat. Should it become a true cross-domain feed, or be renamed/repositioned so its scope is honest?
10. **The external client-review link has no clear "generate/share" entry point anywhere a team member would naturally look**, even though the underlying capability exists. Where should "share this for client approval" live, and should members see the link's status (active/used/revoked) afterward?

### Confirmations and destructive actions
11. **Destructive and high-impact actions are guarded inconsistently.** Some (user deletion requests, some org-admin deletions) require typed or plain confirmation; others of comparable or greater consequence — force-disconnecting a shared account, force-publishing content externally, quick-transitioning a complaint's status, approving/rejecting external client-review actions — currently have **no confirmation step at all**. Was this a deliberate risk tradeoff, or should confirmation weight be redesigned deliberately, action by action?
12. **Several "approval request" workflows (user deletion, content deletion) can be submitted but have no visible screen anywhere that approves or executes them** — a real dead end for anyone relying on that governance path today. Should these gain an approval queue, or should the submit action be removed/reframed until they do?
13. **Two safety checks that matter (deleting a role template still in use; deleting a pipeline still in active use) rely on a count read at the moment the page loaded, not a guarantee enforced at the moment of deletion** — a real, if narrow, risk under concurrent admin use.

### Trust, honesty, and mock-vs-real data
14. **Social publishing (scheduled or immediate) is fully simulated today, not connected to real social networks**, and this is a permanent, intentional near-term decision rather than a bug — but nothing today visually or functionally distinguishes a simulated connection/publish from what a live one would look like. How should the redesign keep this honest without it reading as broken or unfinished?
15. **The platform-admin Analytics screen mixes fully real, computed numbers with fully fabricated placeholder cards on the same screen, with no visual distinction between them today.** This is explicitly flagged as a decision-making risk. What is the honest, deliberate treatment for "this card is illustrative, not real"?
16. **Settings toggles (notification types, some preferences, both in personal and platform-admin settings) can be switched and appear to persist, but do not change any actual delivered behavior anywhere in the product today.** Should these be built out to actually do something, or reframed so they don't imply control that doesn't exist?
17. **A brand document upload appears to "extract" a brand kit, but the extraction step currently returns a placeholder/fallback result rather than genuinely reading the document.** The experience looks finished; the intelligence behind it is not. Should the review step that follows be redesigned to visibly invite correction rather than imply the result is already accurate?
18. Calendar "ghost slot" / suggested-posting-time settings exist in some form but **nothing on the backend actually generates them today** — if this is still a wanted feature, does it need to be scoped as new work rather than assumed partially built?

### Access and permissions
19. **Whether an organization-scoped admin can enter the platform admin console at all is currently decided inconsistently** — the "let you in the door" rule and the "what do you see once inside" rule recognize different sets of people as admins. This needs one clear product decision before a redesign can safely assume either behavior.
20. **The same underlying idea — "you don't have access to this" — is shown two completely different ways** depending on which admin screen you're on: a hard wall on some screens, invisible silent data-narrowing on others, with no stated rule for which pattern applies where. Should these be unified?
21. **When an action is blocked by a permission or workflow rule, the interface frequently doesn't explain why** — across the calendar, the library, and elsewhere, people can hit a disabled control or a failed action with no explanation of whether they lack permission, need approval, or are in the wrong context. A consistent "here's why this is unavailable" pattern is a real, recurring gap.
22. **There is no way today to suspend, reactivate, or remove an existing organization member** from the Members screen, even though the underlying account-state concept supports it — member lifecycle currently stops at "invite" and "edit permissions." Is this an intentional near-term scope limit, or should the redesign plan real estate for it?
23. **Notification "read" state is tracked inconsistently across sources** (standard notifications vs. team-chat unread signals use different mechanisms to mark as read), which can make unread counts less trustworthy than they appear.

### Half-built or dead affordances (visible controls that don't work)
24. **"Assign Reviewer" (in content moderation) and "Revoke publishing access" (on a user's security tab) are both visible controls that currently do nothing** — no supporting data model exists behind either. Each needs an explicit decision: build for real, or remove the affordance so it stops implying a capability that isn't there.
25. **A "duplicate this asset" control in the personal library is visible but explicitly unimplemented** ("coming soon"), a small but real instance of the same problem.
26. **A parallel, older set of admin-style screens/components appears to exist in the codebase alongside the current, in-use admin screens** — worth confirming with engineering whether any of it is still reachable before assuming it's fully retired, since it may represent a previous generation of the same idea.

### Scale and volume
27. **Two investigation-critical admin screens (the support-complaint queue and the operations log) are hard-capped at a fixed number of rows with no pagination** — older records become silently invisible once that cap is exceeded, directly undermining the "find the truth" job both screens exist to do.
28. **The organizations list has no search, filter, or sort at all** — the entire list loads at once regardless of how many tenants exist, which will not scale as the platform grows.

### Miscellaneous inconsistencies worth resolving
29. **Password minimum length is different in three different places** — general account registration, the password-reset flow, and the new-account path inside organization invitation acceptance all enforce different minimums. Worth standardizing to one rule.
30. **There is no credits breakdown or history anywhere in the personal workspace** — both the dashboard and settings show a raw balance number, with no explanation of how or why it changed, even though the product's own help content admits credit accounting "is still evolving."
31. **No error state anywhere (failed generation, failed post, unhealthy connected account) offers a direct hand-off into a pre-filled support ticket** — a person experiencing any of these has to manually navigate to Help and re-describe, from scratch, details the product already has on hand.
32. **A quick-comment action on a user's complaint history always attaches to that person's newest complaint, with no way to choose which one** — a real risk of a note landing on the wrong case when someone has more than one open ticket.

---

## 10. Technical Constraints That Bind Design

These are not design decisions — they are real limits and timings the interface must be designed around, regardless of visual direction.

**Volume and pagination**
- The organization-wide support complaint queue (platform admin) is hard-capped at the latest 100 rows with no pagination — anything beyond that is invisible today.
- The platform operations log is hard-capped at 200 rows per source, with no pagination and no export.
- The personal analytics screen caps each of its underlying data sources (posts, generations, accounts) at 500 rows.
- Generation search only covers the 120 most recent generations.
- The organizations list, user directory, and moderation queue are otherwise paginated (not single unbounded lists) — design should assume "more exists below" as the default, not the exception.

**Timing and latency the interface must communicate honestly**
- Video generation takes roughly 2–4 real minutes, and must be designed as a persistent, backgroundable process rather than a blocking wait — people are expected to navigate elsewhere while it finishes.
- Image and carousel generation complete inline, without the same queued lifecycle.
- Search fields (e.g., the admin user directory) apply a short deliberate delay before filtering — results should not be designed to feel instant on every keystroke.
- Several admin consoles (connected-account maintenance, the complaints queue, complaint detail) do **not** update live — two people working the same screen will not see each other's changes without a manual refresh or their own next action. Other screens (most of the organization workspace, the admin overview, and moderation) **do** update live and can shift under a person's cursor mid-task — both patterns exist today and the design should acknowledge each explicitly rather than assuming uniform behavior.

**Size and format limits (user-facing, worth stating in the interface itself)**
- Personal library uploads: images/video/documents up to 50MB each.
- Brand-kit document upload: PDF or Word, up to 20MB.
- Support-ticket screenshot attachment: image only, up to 5MB.
- Support-ticket title: up to 100 characters. Description: 20–1000 characters required.
- Generation prompt: up to 2,000 characters.
- Image generation batch size: 1–4 per request. Carousels: minimum 2 slides (default 6).

**Credits and gating**
- Every generation has a real, upfront, visible cost in credits, checked against balance before the action is allowed to start — this is a core gating mechanic the interface must always surface before commitment, not after failure.
- A monthly per-person AI-credit allowance (organization context) can be set to exactly zero, which fully blocks that person from generating anything — distinct from the organization-wide credit pool, which is a separate, related lever.

**Soft-delete and recovery windows**
- Personal library deletions are recoverable for 30 days before being considered permanently gone.
- Organization asset library deletions are archive/restore based, without a stated expiry.

**Mixed real/placeholder data — must be labeled, not hidden**
- The platform-admin analytics screen's "platform API" cards are entirely hard-coded placeholders with zero live data behind them; every other number on that screen is real. This distinction currently has no visual or functional treatment and must get one.
- Native social-platform metrics (views/likes/comments/shares) in personal analytics are explicitly a future feature, shown locked/placeholder today — this should read as "coming soon," not "broken."
- Social platform connections and all publishing (personal and organization) run through a simulated mechanism rather than live social-network APIs, by permanent product decision — this must stay honestly and consistently labeled everywhere it's relevant, not polished away as if it were live.

**Multi-tenancy and scoping**
- Nearly every screen in the organization and platform-admin worlds is scoped to a tenant (an organization) or a person's specific access — the interface must be designed to gracefully show "zero because you don't have access" versus "zero because there's genuinely nothing here" as two different situations, even in the many places today where that distinction isn't made clear to the user.




