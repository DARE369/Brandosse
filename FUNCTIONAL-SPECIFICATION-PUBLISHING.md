# Functional Specification — Account Connection & Publishing

**Status:** Draft for design. Not a current-state document.
**Date:** 2026-09-03
**Supersedes:** the Zernio publishing path (`ZERNIO_API_KEY`, `provider = 'zernio'`, `profiles.zernio_profile_id`), which is removed in full by this work.
**Audience:** Claude Design (frontend generation), plus the engineers wiring the routes behind it.

> **Read this first.** Per CLAUDE.md Law 2, this file is a *claim about intended behaviour*, not a description of what the code does today. Section 1 is the only part that describes reality, and every line of it carries `file:line`. Everything after Section 1 is unbuilt.

---

## 0. What this document is for

The user generates screens in Claude Design from this spec. So this spec defines **states, transitions, data shown, and copy** — not visual styling. Where copy is legally or contractually mandated (TikTok's disclosures), the exact string is given and **must not be paraphrased**; TikTok rejects audits for paraphrasing.

The design deliverable list is Section 12.

---

## 1. Ground truth — what already exists

Verified 2026-09-03 by reading the files named.

### 1.1 Reusable without change

| Asset | Location | Note |
|---|---|---|
| Signed OAuth state | `app/api/_lib/oauthState.js` | HMAC-SHA256, 10-min TTL, nonce, constant-time compare, fails closed on missing `OAUTH_STATE_SECRET`. Provider-agnostic. |
| **Its guard** | `scripts/security/oauth-state.test.mjs` | 8 tests, already green, already provider-agnostic — including the exact forged-state-naming-another-user attack. **Survives Zernio removal untouched**; extend it for `returnTo` (3.3) rather than writing a new one. |
| Publish dispatcher | `supabase/functions/publish-post/index.ts` | Ownership + org-scope + platform-match assertions, double-publish guard, retry accounting in `workflow_state.publish`, health updates. Provider switch at `:161-171`. |
| Account health model | `supabase/migrations/20260328000000_connected_accounts_foundation.sql` | `connection_events`, `account_severity_alerts`, `admin_account_actions`, and an `AFTER UPDATE` trigger that raises a warning at 3 consecutive failures and critical at 5. |
| Capability view | `supabase/migrations/20260821220000_account_publish_capability.sql` | `connected_accounts_health_summary` exposes `can_publish` + `publish_block_reason`. Correct pattern; wrong constant (see 1.3). |
| Scheduler | `supabase/migrations/20260601000000_scheduled_publish_worker.sql` | pg_cron every minute → `process_scheduled_posts()` → `dispatch_scheduled_post()` → pg_net → `publish-post`. 50/run cap, race-guarded status flip. |
| Stuck-record reaper | `supabase/migrations/20260821160000_reap_stuck_records.sql` | Provider-agnostic — only its header comment names Zernio. **Keep.** See the warning it carries, 2.4. |
| Caption specs | `supabase/functions/_shared/platformCaptionSpecs.ts` + `src/services/platforms/platformCaptionSpecs.js` | Per-platform caption/title limits and field targets. **Field targets are Zernio-shaped and must be re-pointed at native APIs.** Limits themselves stay valid. |
| Platform registry | `platform_registry` table, seeded in the foundation migration | 8 platforms with brand colour, content types, character limit, capability booleans. |

### 1.2 Existing UI to upgrade, not rebuild

- `src/pages/Settings/ConnectedAccountsTab.jsx` (199 lines) — list, reconnect, disconnect, health modal.
- `src/pages/Settings/components/` — `PlatformGrid`, `ConnectedAccountCard`, `AccountHealthModal`, `AccountConnectionForm`, `MockOAuthScreen`.
- `src/pages/ConnectAccount/ConnectAccountFlow.jsx` (382 lines) — a 6-step flow already exists: platform → heads-up → OAuth → permissions → profile picker → success. It already declares `MULTI_PROFILE_PLATFORMS = {facebook, linkedin, youtube}` and already branches to real OAuth at step 2 when configured. **The step skeleton this spec needs is largely present; steps 3–5 are mock and get replaced.**
- `src/org/admin/ConnectedAccountsAdmin.jsx`, `src/org/components/OrgAccountCard.jsx`, `OrgAccountHealthCard.jsx` — org-scope equivalents.

### 1.3 Defects this work must close

| # | Defect | Evidence | Consequence if ignored |
|---|---|---|---|
| **D1** | Platform tokens stored plaintext, readable by the browser | `20260321113000_...sql:46-48` adds bare `text` columns; `20260712150000_...sql` runs `GRANT SELECT ON public.connected_accounts TO authenticated, anon`. RLS filters *rows*, never *columns*. | Any logged-in user reads their own long-lived Meta/Google refresh token from devtools. Any XSS harvests every token it can reach. Currently latent only because Zernio never handed us tokens. |
| **D2** | Sub-account selection unimplemented | `app/api/auth/zernio/callback/route.js:169` throws `page_selection_not_yet_supported`. | Facebook, Instagram, LinkedIn and YouTube cannot connect at all. That is 3 of the 4 target platforms. |
| **D3** | `can_publish` hard-codes `provider = 'zernio'` | `20260821220000_...sql`, the `can_publish` expression and its post-condition block. | Deleting Zernio makes every real account report `can_publish = false`. The post-condition `DO` block will also fail on re-run. |
| **D4** | Scheduler joins accounts on `ca.user_id = p.user_id` | `20260601000000_...sql`, the `FOR r IN SELECT` join. | Fine today. Once one post fans out to several accounts, this join picks arbitrary rows. Section 10 requires a per-target row. |
| **D5** | Stale comment references a deleted route | `app/api/auth/zernio/connect/route.js` header says it mirrors app/api/auth/oauth/route.js (unbackticked deliberately: naming it as a live citation would assert it exists, which is the very defect this row records); that file does not exist. | Misleads the next reader into thinking a direct path exists. Delete with the rest. |
| **D6** | `posts` lacks per-target columns | `publish-post/index.ts` comments record that `platform_post_url`, `consecutive_failure_count` and `last_failure_at` do **not** exist on `posts`; URL and retry count are stuffed into `workflow_state` jsonb. | Multi-target publishing has nowhere to record per-target outcome. Section 10. |

### 1.4 What does not exist

No direct-OAuth route, no platform credentials in `.env.example` (only `ZERNIO_API_KEY` and `OAUTH_STATE_SECRET`), no token refresh worker, no `publish_targets` table, no webhook receiver for platform-side revocation.

---

## 2. The idea the whole design hangs on

### 2.1 Connected ≠ capable

Every competitor renders one green dot meaning "connected". That is a lie in at least four situations we will hit on day one, and Law 3 forbids it.

Model **three independent booleans** per account, and design for all eight combinations:

| Signal | Meaning | False when |
|---|---|---|
| `connected` | We hold a token that authenticates as this account | Token expired, user revoked in platform settings, password change, permission removed |
| `publishable` | We can successfully call the platform's publish endpoint | Missing scope, app not approved for the scope, quota exhausted, account type wrong (IG Personal not Business/Creator) |
| `public_reach` | Content we publish will be visible to that account's audience | **App not yet audited** — see 2.2 |

`public_reach = false` is the state nobody builds and the one that will define whether this product feels honest. It is not an error. It is a correct, expected state that lasts until app review completes, and the user must understand it *before* they schedule a week of content into it.

### 2.2 The pre-review capability matrix

Sourced from platform docs, 2026-09-03. This is temporary — it changes as each review passes — so **it must be data, not hard-coded UI**. Store it per platform in `platform_registry` and let the UI render whatever it says.

| Platform | Connect works pre-review? | Publish works? | Publicly visible? | Who can connect | Gate to lift it |
|---|---|---|---|---|---|
| **Facebook Page** | Yes | Yes | **Yes — fully public** | Only users with an app role (Admin/Developer/Tester) | App Review + Business Verification → Live mode |
| **Instagram** (Business/Creator) | Yes | Yes | **Yes — fully public** | Same as above | Same as above |
| **LinkedIn — personal** | Yes | Yes | **Yes — fully public** | Anyone | None. `w_member_social` is an Open Permission, self-serve |
| **LinkedIn — company page** | Yes | Yes | Yes | Anyone, dev tier | Community Management API, 5k calls/day dev tier; registered legal org |
| **TikTok** | Sandbox only | Yes | **No — `SELF_ONLY` forced** | 10 target users per sandbox, 5 sandboxes per app | Scope approval, then a *separate* content audit |
| **YouTube** | Yes | Yes | **No — locked private, permanently** | 100 test users, unverified-app consent warning | Compliance audit. **The private lock on already-uploaded videos is not appealable — the video must be re-uploaded after the audit passes.** |

Two consequences the design must carry:

- **YouTube pre-audit is destructive to user intent.** A user who uploads their launch video before we pass the audit has permanently lost that upload — re-uploading is the only fix, and it loses the URL, the view count and any shares. The UI must block or very loudly gate YouTube publishing while `public_reach = false`. A toast is not enough.
- **TikTok pre-audit requires the target account to be private *at the moment of posting*.** Otherwise the API returns `403 unaudited_client_can_only_post_to_private_accounts`. We must detect the account's public/private state at compose time and explain it, not fail at dispatch.

### 2.3 Token custody — the rule the design inherits

The browser must never receive a platform token. This is a backend rule, but it constrains the UI in one visible way: **every action that touches a token is a server round-trip**, so connect, reconnect, refresh and disconnect all need real async states — spinners, disabled buttons, optimistic-then-reconciled rows. No local-only state changes.

Implementation (for the engineers, not the designer): move tokens out of `connected_accounts` into a `connected_account_secrets` table with **no grant to `authenticated`/`anon` at all**, encrypted at rest, reachable only by service-role edge functions. Then `REVOKE`, then re-`GRANT SELECT` on an explicit non-secret column list, then prove it with `scripts/security/cross-tenant-probe.mjs`.

### 2.4 The failure mode this feature has already caused once

`20260821160000_reap_stuck_records.sql` records what happened last time this code path shipped without timeouts:

> `zernio.service.ts` has four outbound calls and **ZERO timeouts** (finding P10q-005), so a hung provider request is a direct route into this state.
> Live state 2026-08-21: `posts.status = 'publishing'` — **20 rows, oldest 2026-04-04 (4+ months)**.

Twenty posts sat frozen mid-publish for four months. From the user's side the content simply vanished — no error, no notification. The reaper now exists, and it stays.

**Two requirements fall out of this, and they are not negotiable:**

- **Every platform adapter call carries an explicit timeout.** Four platforms × several calls each is far more outbound surface than Zernio had. This is already a CLAUDE.md non-negotiable; it is repeated here because this exact feature is the one that broke it.
- **`publishing` is a non-terminal state and the reaper must cover every new one.** If `publish_targets` (10.1) introduces its own in-flight statuses, they need reaping too — otherwise we rebuild the same silent-freeze bug one table over.

**UI consequence:** the per-target status list (8.2) must render a **timed-out** state distinctly from *failed* and from *still processing*. "Still uploading…" forever is the exact lie this reaper was written to stop.

---

## 3. Redirect architecture — what the frontend must respect

Platforms match redirect URIs **exactly** against an allowlist registered in their dashboard. That produces hard constraints on navigation.

### 3.1 Route shape

```
GET  /api/auth/social/[platform]/connect     → 302 to the platform's authorize URL
GET  /api/auth/social/[platform]/callback    → handles ?code&state, 302 back into the app
POST /api/auth/social/[platform]/finalize    → completes sub-account selection (D2)
POST /api/auth/social/[platform]/disconnect  → revokes at the platform, then locally
GET  /api/auth/social/available              → which platforms are configured
```

**One registered redirect URI per platform**, always `/api/auth/social/[platform]/callback`. Never per-user, never per-environment-suffix, never a preview URL.

### 3.2 Full-page redirect, not a popup

Use a top-level navigation. Popups are blocked by default on mobile Safari, break inside in-app browsers (Instagram, LinkedIn, Slack), and fail `postMessage` across the origin change. The cost is that we leave the app and must return the user to exactly where they were.

### 3.3 `returnTo` travels inside the signed state

The user can start a connect from at least five places (Section 4.1). They must land back at the one they left, with their work intact.

Extend the existing `createOAuthState({ userId, platform, scope })` payload with `returnTo`. It must be **signed** and **validated as a same-origin relative path** on the way back — an unsigned or unvalidated `returnTo` is an open-redirect, and this repo already took one hit from trusting a callback query parameter (LOCK L1.6, documented in `oauthState.js`).

**Draft-safety rule:** if the user starts a connect from inside an unsaved composer, persist the draft server-side *before* redirecting and restore it on return. Losing a composed post to an OAuth round-trip violates Law 3 ("nothing may lose user content").

### 3.4 The callback interstitial

The callback route does real work — token exchange, account discovery, sometimes 2–4 platform API calls. That is 1–5 seconds where the browser is on our origin with nothing rendered.

Design a dedicated `/app/connecting` interstitial: platform logo, "Finishing your {Platform} connection…", indeterminate progress, and after 8 seconds a "Still working — this can take a moment" line. It must never be a blank white page, and it must never look like the app crashed.

---

## 4. Flow A — Connect an account

Six steps. Steps 1, 2 and 6 exist in `ConnectAccountFlow.jsx` and get upgraded; 3–5 are replaced.

### 4.1 Entry points

Each carries its own `returnTo` and, where relevant, a pre-selected platform.

| Entry | Trigger | Pre-selects | Returns to |
|---|---|---|---|
| Settings → Connected Accounts | "Connect account" button | Nothing — show picker | Settings |
| Onboarding | Step N of first-run | Nothing | Next onboarding step |
| Composer target bar | "＋ Add account" | Nothing | Composer, draft intact |
| Composer platform chip | User picks a platform with no account | That platform | Composer, draft intact, new account auto-selected as a target |
| Calendar empty state | "Connect an account to start scheduling" | Nothing | Calendar |
| Failed-post recovery | "Reconnect" on a post that failed with `auth_expired` | That account's platform, reconnect mode | The failed post, with retry offered |

### 4.2 Step 1 — Platform picker

**Shown:** every row of `platform_registry` where `is_active`, ordered by `display_order`.

**Per tile:** logo, display name, and a capability line derived from 2.2 — *not* invented in the component.

Tile states:
- **Available** — connectable now.
- **Available, limited** — connectable, but `public_reach = false`. Amber chip: *"Posts stay private until review"*. Tapping the chip opens the explainer sheet (4.3).
- **Already connected** — show the connected handle and avatar; primary action becomes "Add another account", secondary "Manage".
- **Not configured** — credentials absent for this environment. Greyed, cursor default, tooltip *"Coming soon"*. Never a dead-looking enabled button.
- **Unsupported for this workspace** — e.g. org scope where the platform has no org concept. Greyed with a reason.

**Multi-account is a first-class case.** A user may connect three Instagram accounts. The picker must not imply one-per-platform, and the connected state must never *replace* the tile.

### 4.3 Step 2 — Heads-up / pre-flight

The trust moment. Skipping it costs conversions; over-writing it also costs conversions. Keep it to one screen, no scrolling on a 375px viewport.

**Contents:**

1. **What we will ask for** — plain-language scope list, one line each, derived from the actual scopes requested. Not marketing copy.
   - "Post content to your account — only when you tell us to."
   - "Read your profile name and picture — so you can tell your accounts apart."
   - "Read post performance — so we can show you how content did."
2. **What we will never do** — "We never post without your instruction. We never read your DMs. We never follow, like, or comment on your behalf."
3. **The capability disclosure, when `public_reach = false`.** This is the important one and must be impossible to miss. See exact copy below.
4. **Primary CTA** — "Continue to {Platform}". Secondary — "Cancel".

**Capability disclosure copy, TikTok:**

> **Your TikTok posts will be private for now.**
> Our TikTok integration is still in review. Until it's approved, anything published here uploads to your account as **Only me** — you'll see it, nobody else will. Your TikTok account also has to be set to private while it's in review.
> You can make each post public yourself in the TikTok app afterwards. We'll tell you when review is done.

**Capability disclosure copy, YouTube — stronger, because the damage is permanent:**

> **Don't upload anything you care about yet.**
> Our YouTube integration is still in review. Videos uploaded before it's approved are **locked to private by YouTube, permanently** — that can't be undone by us or by you, and the only fix is uploading the video again once we're approved.
> Connect now if you want to get set up. We'd suggest waiting to publish.

Both need a "Why?" affordance opening a short sheet explaining app review in two sentences. Users do not know what app review is and will assume we are broken.

### 4.4 Step 3 — Platform authorization (external)

We leave the app. Nothing to design except the departure: disable the CTA and show an inline spinner with "Taking you to {Platform}…" so a slow 302 doesn't read as a dead button.

### 4.5 Step 4 — Return interstitial

Per 3.4. Also handles immediate failure: if the platform bounced us back with `error=access_denied`, do not render the interstitial at all — go straight to 4.8.

### 4.6 Step 5 — Sub-account selection (**closes D2**)

Mandatory for Facebook, Instagram, LinkedIn and YouTube. Skipped for TikTok.

**Screen:** "Which {Page / account / channel} should we post to?"

| Platform | What we list | Source |
|---|---|---|
| Facebook | Pages the user administers | Pages the token grants `MANAGE`/`CREATE_CONTENT` on |
| Instagram | IG professional accounts linked to those Pages | Per-Page IG business account |
| LinkedIn | Personal profile **plus** each organization the user administers | Personal is always present; orgs need Community Management |
| YouTube | Channels on the Google account, including brand accounts | Channel list for the granted account |

**Per row:** avatar, name, secondary identifier (`@handle`, follower count, or channel subscriber count), and a per-row capability chip where it differs from the platform default.

**Interaction:**
- **Multi-select.** A user with four Pages wants all four. Checkbox rows, "Select all", and a live count on the CTA: "Connect 3 accounts".
- **Already-connected rows** show as checked-and-locked with a "Connected" chip, so the screen doubles as "add the ones I missed".
- **Ineligible rows stay visible with a reason** — never silently filtered out. An Instagram Personal account must appear, greyed, saying *"Personal accounts can't be posted to via the API. Switch to a Business or Creator account in Instagram, then reconnect."* Hiding it produces the single most common support ticket in this category: "my account isn't showing up".
- **Zero eligible rows** is a designed screen, not an error toast. See 4.8 `no_eligible_targets`.

**Nothing is written to `connected_accounts` until this step is confirmed.** The callback holds discovery results in a short-lived server-side record keyed by the signed state. A user who abandons here leaves no half-connected row behind.

### 4.7 Step 6 — Success

**Shown:** the connected account(s) with avatar and handle, a green "Connected" state, and — if `public_reach = false` — the capability chip repeated. Confirmation must never overstate: an account in review shows "Connected · Posts stay private", not "Connected".

**Primary CTA is contextual, from `returnTo`:**
- From composer → "Back to your post" (and the account is pre-selected as a target)
- From onboarding → "Next"
- From settings → "Done", plus a secondary "Connect another"
- From failed-post recovery → "Retry publishing"

**Micro-interaction:** the newly connected row animates in on the destination screen. Users returning from an external redirect need to see *what changed*.

### 4.8 Failure states — all of them

Every one needs its own screen or inline state with a **specific cause and a specific next action**. A generic "Something went wrong" is a defect here, because the recovery differs in every row.

| Code | Cause | User-facing message | Action |
|---|---|---|---|
| `user_denied` | Declined on the platform's consent screen | "You didn't approve the connection. Nothing was changed." | "Try again" / "Cancel" |
| `missing_scopes` | Approved, but unchecked a required permission | "Almost — {Platform} needs permission to post for this to work. You can approve just that one." | "Try again" — re-request only the missing scopes |
| `wrong_account_type` | IG Personal, or a YouTube account with no channel | Platform-specific fix instructions, with a link to the relevant platform setting | "I've fixed it — retry" |
| `no_eligible_targets` | No Pages / no channel / no admin orgs | "We couldn't find a {Page} on this {Platform} account." Explain what's needed. | "Create one on {Platform}" (external) / "Use a different account" |
| `oauth_state_expired` | Took longer than 10 minutes | "That took a while and the link expired — no harm done." | "Start again" |
| `oauth_state_bad_signature` | Tampered or forged | Generic security message. **Do not explain.** Log at high severity. | "Start again" |
| `already_connected_elsewhere` | This platform account is on another workspace | "This {Platform} account is already connected to another workspace. Disconnect it there first." | "Got it" |
| `platform_unavailable` | 5xx or timeout from the platform | "{Platform} isn't responding right now. This is on their side." | "Try again" |
| `app_not_configured` | Credentials missing in this environment | "{Platform} isn't available yet." | Back to picker |
| `rate_limited` | Too many attempts | "Too many attempts. Try again in {n} minutes." | Countdown, disabled CTA |

**Universal rule:** a failed connect leaves **no row** in `connected_accounts`. Partial rows are how "my account shows as connected but nothing publishes" happens, and this repo has already been bitten by exactly that class of defect.

---

## 5. Flow B — Account management & health

Lives in Settings → Connected Accounts, upgrading `ConnectedAccountsTab.jsx`.

### 5.1 Account card

**Always shown:** avatar, display name, `@handle`, platform badge, status chip, last-published relative time.

**Status chips — drive from `connection_status` + the three booleans in 2.1, never from `connection_status` alone.** The existing dashboard bug (`useDashboardData.js:126-140` defaulting unknown values to a green "Healthy") is precisely what a fail-open default in the UI produces, and the capability view was built to stop it. Consume `can_publish` and `publish_block_reason`; do not re-derive.

| Chip | Condition | Tone | Card action |
|---|---|---|---|
| **Connected** | All three booleans true | Success | — |
| **In review** | `public_reach = false` | Info | "What does this mean?" |
| **Expiring soon** | `token_expires_at` within 7 days and no refresh token | Warning | "Reconnect" |
| **Reconnect needed** | Token expired or revoked | Error | "Reconnect" (primary) |
| **Publishing paused** | `consecutive_failure_count >= 3` | Warning | "See what happened" |
| **Action needed** | `can_publish = false` with a reason | Error | Reason-specific fix |
| **Disconnected** | User-initiated | Neutral | "Reconnect" |

**Never render a status the data doesn't support.** If `publish_block_reason` is a value the UI doesn't recognise, show "Action needed" plus the raw reason — not "Healthy".

### 5.2 Health detail

Upgrades `AccountHealthModal.jsx`. Reads `connection_events`.

- Plain-language current status, with the actual `last_failure_reason` — mapped to human copy where we have a mapping, shown verbatim where we don't. Never swallowed.
- Recent activity timeline from `connection_events`: connected, published, failed, token refreshed, reconnected. Timestamps relative with absolute on hover.
- Publish stats: `total_posts_published`, `last_successful_publish_at`.
- Token expiry, when known.
- Actions: Reconnect, Disconnect, Retry failed posts.

### 5.3 Reconnect

Same OAuth round-trip as connect, but: pre-selected platform, skipped heads-up (they've seen it), and on return it **matches to the existing row by platform account id** rather than creating a new one. Preserves history, stats and scheduled posts.

If the returning account is a *different* platform account than the row being reconnected, do not silently rebind — that is the account-swap hazard `oauthState.js` was written to prevent. Show: "That's a different account than the one you're reconnecting. Connect it as a new account instead?"

### 5.4 Disconnect — must state consequences

A destructive action with non-obvious blast radius. The confirm dialog must name the actual counts, queried before it opens:

> **Disconnect @handle?**
> **{N} scheduled posts** are set to publish to this account. They will not publish.
> Posts already published stay on {Platform} — we don't delete anything.
>
> [ Cancel ] [ Disconnect ]

If `N > 0`, offer a third path: "Move them to another account" with a picker of compatible accounts on the same platform.

Disconnect must **revoke at the platform** where the API supports it, not merely delete our row. A local-only delete leaves a live grant the user believes they cancelled — a privacy-policy claim we would be breaking.

---

## 6. Flow C — Compose & target

### 6.1 Target selector

Sits at the top of the composer. Avatar chips, multi-select.

- Grouped by platform when more than ~6 accounts.
- Ineligible targets stay visible and greyed with a reason chip: "Reconnect needed", "Video only", "In review".
- Selecting an ineligible target is blocked, and the tap surfaces the reason plus its fix.
- "Add account" chip at the end → Flow A with `returnTo` = composer.
- **Selection persists in the draft.** A user who selects four targets, leaves, and comes back must find four targets selected.

### 6.2 Per-platform content divergence

One post, N platforms, N sets of rules. Two modes:

**Unified mode (default):** one caption, applied everywhere. Show the *most restrictive* limit as the live counter, with a note: "280 characters (X's limit)". As the count passes each platform's limit, that platform's chip goes amber — the user sees exactly who they're about to break.

**Per-platform mode:** tabs across the selected targets. Each tab holds its own caption, media selection and options. An "unedited" tab inherits from the unified caption until touched; once touched it detaches and shows a "Customised" dot. Offer "Reset to unified".

Do not force per-platform mode on users who don't want it, and do not hide it from users who do. Most tools get this wrong in one direction or the other.

### 6.3 Validation — before publish, never after

Live per-target validation. Blocking errors disable publish; warnings do not.

| Check | Type | Example |
|---|---|---|
| Caption over limit | Blocking | "42 characters over X's limit" |
| Missing required media | Blocking | "TikTok posts need a video or photo" |
| Wrong media type | Blocking | "TikTok doesn't accept GIFs" |
| Video too long / too short | Blocking | Per platform |
| Aspect ratio outside supported range | Warning | "This will be cropped on Instagram" |
| File too large | Blocking | Per platform |
| Too many hashtags | Warning | Per platform convention |
| Missing required field | Blocking | YouTube title, Pinterest board |
| Account can't publish | Blocking | "Reconnect Instagram to post here" |
| Account in review | Warning, acknowledged | See 6.4 |

Validation runs against a **shared source of truth**, not per-component constants. `platformCaptionSpecs` already exists in two mirrored copies (`src/services/platforms/` and `supabase/functions/_shared/`) with a comment instructing they be kept in sync — a drift hazard that should be collapsed into one shared module during this work.

### 6.4 The in-review acknowledgement

When a selected target has `public_reach = false`, the publish button does **not** silently proceed.

- **TikTok:** an inline amber panel above the publish button — "This will upload to TikTok as *Only me*." No extra click. Informative, not obstructive.
- **YouTube:** a blocking confirmation with a typed or explicit acknowledgement, because the outcome is irreversible:

> **This video will be locked to private, permanently.**
> YouTube locks uploads from apps that haven't completed review. We can't unlock it and neither can you — you'd need to upload the video again after we're approved.
>
> [ Cancel ] [ Upload anyway ]

`Upload anyway` is the secondary, `Cancel` the primary.

---

## 7. Flow D — Per-platform option panels

Each selected target gets a collapsible options panel. Defaults are sane, so most users never open it.

### 7.1 TikTok — the mandated one

TikTok's Content Sharing Guidelines make specific UI elements **conditions of audit approval**. Apps are rejected for missing or paraphrasing them. Every item below is required, and the wording of the declaration is fixed.

1. **Creator info, freshly fetched.** Call `creator_info` when the panel renders — not cached from connect time — and display the creator's **nickname**, so the user can see which account this goes to.
2. **Privacy selector — a dropdown with no default value.** The user must actively choose. Options come from `privacy_level_options` in the `creator_info` response and vary by account:
   - Public account: `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `SELF_ONLY`
   - Private account: `FOLLOWER_OF_CREATOR`, `MUTUAL_FOLLOW_FRIENDS`, `SELF_ONLY`
   Render the options the API returns. Do not hard-code the list. While unaudited, `SELF_ONLY` is the only one that will succeed — show the others disabled with the reason rather than hiding them.
3. **Interaction toggles** — Comments, Duet, Stitch. **Unchecked by default.** Greyed out when the creator's own TikTok settings disable them (the `creator_info` response says which). Duet and Stitch are omitted entirely for photo posts.
4. **Commercial content disclosure** — off by default. Turning it on reveals two sub-options, and at least one must be chosen:
   - *Your brand* — "You are promoting yourself or your own business."
   - *Branded content* — "You are promoting another brand or a third party."
   Both may be selected.
5. **The declaration line**, immediately above the publish button, with live links:
   - Default: *"By posting, you agree to TikTok's Music Usage Confirmation."*
   - With branded content on: *"By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation."*
   Exact strings. TikTok checks for them.
   **It must be PERSISTENTLY visible — never revealed conditionally.** Showing
   it only when a disclosure toggle is on is a documented rejection cause. The
   default line is always on screen; branded content only changes its wording.
6. **Enforce `max_video_post_duration_sec` from `creator_info` in the UI.**
   The limit is per-creator and comes back in the same response as the privacy
   options. A video over it must be blocked at compose time with the actual
   number shown — not accepted and rejected later by the API. Also a documented
   rejection cause.
7. **Content preview** — required.
8. **No promotional watermarks** on the media. Prohibited outright.
9. **Processing notice** — "TikTok can take a few minutes to process your video."

> **Grounded in a real rejection, not inference.** TikTok's rejection email for
> a comparable integration quoted: *"Your application did not follow our UX
> Guidelines. Point 2)b. Privacy Status. Users must manually select the privacy
> status from a dropdown and there should be no default value."* The five faults
> documented in that case were: creator nickname/avatar not shown; privacy
> hardcoded to `PUBLIC_TO_EVERYONE`; interaction toggles checked by default;
> the music declaration shown conditionally rather than persistently; and
> `max_video_post_duration_sec` not enforced in the UI. Items 1–6 above exist to
> close exactly those.

### 7.2 YouTube

Title (required, ≤100), description (≤5000), privacy (Public / Unlisted / Private — **forced to Private and locked, with the reason, while unaudited**), category, tags, thumbnail, made-for-kids declaration (legally required by YouTube), and a Shorts indicator when the media qualifies.

### 7.3 Instagram

Post type — Feed / Reel / Story / Carousel — driving different validation. Caption ≤2200. First comment (a common convention for hashtag dumps). Location tag. Cover-frame selection for Reels. Collaborator tags.

### 7.4 Facebook

Target Page (when several are connected). Caption. Link preview toggle. Scheduled-vs-now is handled by our scheduler, not theirs.

### 7.5 LinkedIn

Post as — personal profile or one of the connected organizations. Caption ≤3000. Document/carousel support. Visibility — Public / Connections only.

---

## 8. Flow E — Publish, status, results

### 8.1 Publish action

- **Publish now** — primary.
- **Schedule** — opens the date/time picker (`ScheduleModal.jsx` exists).
- **Save draft** — always available, always.

On submit, the composer does **not** clear until the server has accepted the job. Optimistic clearing loses user content on a failed request.

### 8.2 In-flight

Publishing is not instantaneous — TikTok processes for minutes, YouTube uploads take as long as the file needs. Blocking the UI on it is wrong.

- Submit → immediate transition to a **per-target status list**, one row per target.
- Row states: Queued → Uploading (with % where the platform reports it) → Processing → Published / Failed / **Timed out**.
- **Timed out is its own state**, distinct from Failed and from Processing (2.4). Copy: "We lost contact with {Platform} — we don't know if this published. Check your account before retrying." Actions: "Open {Platform}" and "Retry". Never let a row spin indefinitely; the reaper's job is to force this transition, and the UI's job is to show it.
- The user can navigate away. Status continues in the background and surfaces in notifications.
- Never a single global spinner for a multi-target publish.

### 8.3 Results — per target, honestly

**Success:** green check, "View on {Platform}" deep link to the live post, timestamp.

**Success with reduced reach** — the state that matters:

> ✓ Uploaded to TikTok — **visible to you only**
> Our TikTok integration is still in review. [Why?] · [Open in TikTok]

Not a green "Published". Not a red error. Its own visual treatment — success tone, informational chip. Getting this wrong in either direction is the single biggest honesty risk in the feature.

**Failure:** red state, plain-language cause, and a **specific** action:

| Failure | Message | Action |
|---|---|---|
| Token expired | "Instagram signed you out." | "Reconnect" → Flow A reconnect, then auto-retry |
| Rate limited | "{Platform} limit reached. We'll retry at {time}." | Auto-retry; "Cancel" available |
| Media rejected | Platform's own reason, verbatim | "Edit post" |
| Duplicate content | "{Platform} rejected this as a duplicate." | "Edit post" |
| Unaudited-client block | "TikTok needs your account set to private while we're in review." | Link to the TikTok setting; "Retry" |
| Platform down | "{Platform} is having problems. We'll keep trying." | Auto-retry with backoff |
| Quota exhausted | "We've hit today's {Platform} upload limit. Resumes at {time}." | Auto-reschedule |

**Partial success is the normal case for multi-target.** Never collapse it into one verdict. Header reads "Published to 2 of 4", with per-row detail and a "Retry failed" action that retries only the failures.

### 8.4 Notifications

Because the user may have navigated away: in-app notification on completion, and a digest for scheduled posts that failed overnight. `useUserNotifications.js` exists.

---

## 9. Flow F — Scheduling & queue

### 9.1 Queue view

A dedicated list, distinct from the calendar: everything scheduled, grouped by day, with per-target chips.

Row states: Scheduled, Publishing, Published, Failed, Paused (account disconnected).

### 9.2 Undispatchable posts

`20260716140000_fail_undispatchable_scheduled_posts.sql` already exists, so the backend surfaces this. The UI must too: a post scheduled to an account that has since disconnected shows **before** its scheduled time as "Won't publish — account disconnected", with "Reconnect" and "Change account" actions. Discovering it after the slot passed is a silent content loss.

### 9.3 Bulk recovery

After a reconnect, offer: "3 posts failed while Instagram was disconnected. Retry them?" One action, not three.

---

## 10. Backend contract the UI depends on

Not the designer's concern, but the UI above is undeliverable without these. Listed so the design isn't specified against a backend that can't feed it.

1. **`publish_targets` table** (closes D4, D6). One row per `(post_id, connected_account_id)` with its own `status`, `external_post_id`, `platform_post_url`, `error_code`, `error_message`, `retry_count`, `visibility_achieved`. Per-target status in 8.2/8.3 is impossible without it, and `workflow_state` jsonb cannot carry it.
2. **`connected_account_secrets`** (closes D1). Tokens out of the client-readable table, encrypted, service-role only. Then re-`GRANT` on an explicit non-secret column list and re-run `cross-tenant-probe.mjs`.
3. **Rewrite `can_publish`** (closes D3) to key off per-platform capability data rather than `provider = 'zernio'`, including its post-condition block.
4. **Token refresh worker** — a reaper for expiring tokens, per the non-negotiable that every non-terminal state needs one. Meta long-lived tokens last ~60 days; Google refresh tokens can be revoked silently.
5. **`platform_capabilities`** — the 2.2 matrix as data on `platform_registry`, so lifting a restriction after an audit passes is a data change, not a deploy.
6. **Per-platform adapters** behind the existing `provider` switch at `publish-post/index.ts:161-171`.
7. **Delete the Zernio path.** Verified inventory — everything else matching `zernio` is `.next/` build output.
   - **Delete:** `app/api/auth/zernio/{connect,callback,available}/route.js`, `supabase/functions/_shared/zernio.service.ts`, `ZERNIO_API_KEY` from `.env.example` and `scripts/check-env-contract.cjs`, `profiles.zernio_profile_id`, the `provider` CHECK constraint's `'zernio'` value.
   - **Edit, don't delete:** `src/hooks/useDashboardData.js` (also fix its fail-open "Healthy" default at `:126-140`), `src/services/platforms/{connectionService,mockPublishService,platformCaptionSpecs}.js`, `supabase/functions/_shared/platformCaptionSpecs.ts`, `supabase/functions/publish-post/index.ts`.
   - **Keep untouched:** `app/api/_lib/oauthState.js`, `scripts/security/oauth-state.test.mjs`, `20260821160000_reap_stuck_records.sql` — all three are provider-agnostic; only comments mention Zernio.
   - Also fix the stale comment in D5.
8. **Guards** (Law 1 — no change is done without one):
   - Extend `scripts/security/oauth-state.test.mjs` (already green, 8 tests) with: `returnTo` rejects absolute URLs, protocol-relative `//evil.com`, and non-same-origin paths.
   - New probe: no client role can read any token column — run via `cross-tenant-probe.mjs`, since service-role reads bypass RLS and prove nothing.
   - New test: a failed connect at any step leaves zero `connected_accounts` rows.
   - New test: every platform adapter call has a timeout (2.4).
   - New detector: the two `platformCaptionSpecs` copies have not drifted — or better, collapse them into one shared module and delete the need.

---

## 11. Cross-cutting UX requirements

**Loading.** Skeletons matching final layout, never spinners-on-blank. Account lists, target selectors and status lists all have skeleton states.

**Empty.** Every list gets a designed empty state with a single clear action: no accounts, no scheduled posts, no publish history, no eligible sub-accounts.

**Mobile-first** (standing rule in memory). The connect flow especially — OAuth on mobile is a full page-context switch, and the return must not lose scroll position or draft state. Target chips must be thumb-reachable; the composer's per-platform tabs need horizontal scroll with an edge-fade affordance.

**Accessibility.** Status is never colour-only — every chip pairs an icon or text with its tone. OAuth redirects announce via live region. The TikTok privacy dropdown must be keyboard-operable with a real `<select>` or a fully ARIA-correct listbox, given it is audit-visible.

**Copy tone.** Plain, specific, non-apologetic. Name the cause, give the fix. Never "Something went wrong". Never blame the user for a platform restriction.

**Honesty rule (Law 3).** No screen may render a state more positive than the data supports. "Published" means publicly visible. Anything less says what it actually is.

---

## 12. Deliverables for Claude Design

Screens to generate, in build order:

**Connect flow**
1. Platform picker — all five tile states
2. Heads-up / pre-flight — standard, TikTok-disclosure, YouTube-disclosure variants
3. Connecting interstitial — normal and slow
4. Sub-account selection — multi-select, mixed-eligibility, zero-eligible
5. Success — from-settings, from-composer, in-review variants
6. Failure — one per row of 4.8

**Account management**
7. Connected accounts list — populated, empty, mixed-health
8. Account card — all seven status chips
9. Health detail with event timeline
10. Disconnect confirmation — with and without scheduled posts

**Compose & publish**
11. Composer with target selector — 1, 4 and 12 accounts
12. Unified vs per-platform caption modes
13. Validation states — blocking and warning
14. TikTok options panel (all mandated elements — highest-fidelity screen in the set)
15. YouTube, Instagram, Facebook, LinkedIn options panels
16. YouTube irreversibility confirmation
17. Publish-in-flight, per-target status list — including the **timed-out** row state (2.4)
18. Results — all-success, partial, all-failed, success-with-reduced-reach

**Queue**
19. Scheduled queue grouped by day
20. Undispatchable-post warning state
21. Bulk retry after reconnect

Every screen at mobile (375px) and desktop, in both themes, per the standing build rules.
