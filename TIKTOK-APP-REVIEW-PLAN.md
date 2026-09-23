# TikTok App Review — Submission Plan

**Date:** 2026-09-05
**Companion to:** [`FUNCTIONAL-SPECIFICATION-PUBLISHING.md`](FUNCTIONAL-SPECIFICATION-PUBLISHING.md) §7.1
**Status:** pre-submission. Compose panel and TikTok analytics are built; analytics
is not yet deployed; no real TikTok account has connected yet (§6).

---

## 0. Read this first

The demo video is not a marketing asset. It is **evidence**, and the reviewer
checks it against two things: the scopes you selected, and the Content Sharing
Guidelines. Everything follows from that:

- **Every scope you leave selected must appear in the footage.** An unused
  scope is not neutral — it is a claim the video fails to support.
- **Every guideline point must be visibly demonstrated.** Not described, not
  implied. On screen, in the user interface, as an interaction.
- **The description you wrote must match what the video shows.** A mismatch
  between the two is a rejection, not a request for changes.

So the order is fixed and cannot be shortcut:

```
1. Freeze the scope list          (§1)  — DECIDED 2026-09-22: all five, analytics in
2. Build the compose panel        (§2)  — DONE, all ten rows met and guarded
2b. Build TikTok analytics        (§1)  — BUILT 2026-09-22, not yet deployed
3. Set up the sandbox             (§3)  — founder-side, in progress
4. First real connect + one private post — never done; do it BEFORE filming
5. Record, following the shot list (§4)
6. Self-review against the checklist (§5)
7. Submit
```

Step 4 was not in the original list. It is the first time the adapter, chunked
upload, token refresh and revoke touch TikTok at all, and discovering a defect
on camera costs a full recording.

---

## 1. Freeze the scope list

> **Decided 2026-09-22 (founder): TikTok analytics goes into this application.**
> The scope list is frozen at the five the code requests, plus the one the
> portal adds on its own. Earlier drafts of this section recommended removing
> the analytics scopes; that recommendation is withdrawn.

### The scopes, and where each one is used

| Scope | Product | Used by | Visible in the demo at |
|---|---|---|---|
| `user.info.basic` | Login Kit | Connect: open_id, display name, avatar | Shot 2 — account card |
| `user.info.profile` | Login Kit | @username, verified badge, bio, "Open on TikTok" link — read at connect (`callback/route.js`, `discoverTikTok`) and refreshed every 6h | Shot 2 — account card |
| `user.info.stats` | Login Kit | Followers, following, total likes, video count | Shot 2 (followers on the card) and Shot 5 (analytics page) |
| `video.publish` | Content Posting API, **Direct Post ON** | Posting | Shots 3–4 |
| `video.list` | Login Kit | Per-video views, likes, comments, shares; titles and links | Shot 5 — analytics page |
| `video.upload` | Content Posting API | **Nothing.** The portal adds it automatically with the Content Posting API and it cannot be removed | Not shown — explained in the application text instead |

The code requests exactly the first five (`app/api/_lib/socialProviders.js`,
TikTok `scopes`). It never requests `video.upload`, so users are never asked
for it. **Say so in the application's scope explanation**, e.g. *"video.upload
is included automatically with the Content Posting API; Brandosse does not
request it and posts directly with video.publish."* That answers "every
selected scope must appear in the footage" for the one scope that cannot.

**The portal and the code must match.** If a scope the code requests is not
enabled on the app, TikTok fails the whole authorization, and the error reads
like a bad client key. Portal state per the founder's screenshot 2026-09-22:
Login Kit + Content Posting API added; `user.info.basic`, `user.info.profile`,
`user.info.stats`, `video.publish`, `video.upload` present — **`video.list`
still to be added** via "+ Add scopes".

### What the analytics code does — built 2026-09-22, NOT yet deployed

- `supabase/functions/_shared/tiktok.analytics.service.ts` — user/info,
  video/list (paginated, 20/page, 10-page budget), publish-status lookup.
  15 unit tests (`tiktok.analytics.service.test.ts`).
- `supabase/functions/ingest-social-analytics/tiktok.ts` — runs in the existing
  6-hourly `ingest-social-analytics` cron, isolated from the YouTube pass.
- `supabase/migrations/20260922120000_tiktok_analytics.sql` — account snapshot
  table, platform post catalogue, `social_snapshot_summary()`, the
  `tiktok/analytics` meter, and removal of a false claim that TikTok reports
  saves (its Video object has no such field).
- Analytics page (`PlatformPerformance.jsx`) and account card
  (`ConnectedAccountCard.jsx`) render it.


### Photo posts — built 2026-09-23, and what they require

Founder decision: photo posting ships and goes into this submission.

TikTok photos are a DIFFERENT API from video, not a variant:
`/v2/post/publish/content/init/` with `media_type: PHOTO` and
**`PULL_FROM_URL` as the exclusive source** — TikTok fetches the image itself,
and the docs require that the developer "verify the ownership of the URL prefix
or domain". Our media lives on `<project>.supabase.co`, which we can never
verify, so photos are served from OUR domain:

  `https://www.brandosse.com/api/media/tiktok/<signed-token>`

That route (`app/api/media/tiktok/[token]/route.js`) is the product's only
PUBLIC media endpoint — TikTok presents no credential — so it is contained by an
HMAC token naming ONE generation, expiring in 30 minutes, minted by the publish
adapter and verified by the route. Images only, size-capped, no redirects, and
it resolves media through the generation row rather than fetching any URL it is
handed.

**Founder steps before a photo post can work:**

1. Generate a secret:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. Set `MEDIA_PROXY_SECRET` to that value in **Vercel** and in **Supabase**
   (`npx supabase secrets set MEDIA_PROXY_SECRET=…`). The SAME value in both, or
   every photo post 403s against our own proxy.
3. Redeploy `publish-post`.
4. TikTok portal → **URL properties** → verify the prefix
   `https://www.brandosse.com/api/media/`. Without it TikTok refuses to fetch,
   and the adapter reports exactly that.

**Interaction settings differ, and the panel already matches:** TikTok states
"Duet and Stitch features are not applicable to photo posts. So, for Photo
Posts, only 'Allow Comment' can be displayed in the UX." The panel hides both
for photos; the adapter sends only `disable_comment`.

**Limits differ too:** title 90 runes, description 4000 (video has one 2200
field). One image per post today — TikTok accepts up to 35, so carousels need
multi-asset posts, which is a composer change, not an adapter one.

### The constraint that shapes the demo: `video.list` is public videos only

TikTok's docs: video.list returns *"the given user's **public** TikTok video
posts"*. An unaudited app can only post as *Only me* to a private account
(§3). So the post made in Shot 4 will **not** appear in the analytics list, and
whether a private account's videos appear at all is `UNVERIFIED` until the
first real connect. The analytics page says this in words when the list is
empty rather than showing zeros — but the demo still needs `video.list`
visibly returning data. Plan for Shot 5, in order of preference:

1. **If the first real connect shows the private account's videos are
   returned** — record Shot 5 as-is.
2. **If not** — after Shot 4, switch the TikTok account to public in the TikTok
   app, wait for the next collection (or have it triggered), and record Shot 5
   showing its public videos. Switching visibility between shots is honest:
   it is the user's own setting, and the demo says why.

Test this at the first real connect (§6), before recording anything.

### Also required before submission

- **Redirect URI** — must equal what the code sends, byte for byte. The connect
  route builds it as `NEXT_PUBLIC_APP_URL` (falling back to the request origin)
  + `/api/auth/social/tiktok/callback`. The canonical production host is
  **`https://www.brandosse.com`** — the earlier `https://brandosse.com/...` value
  here omitted `www` and would not have matched. Register **both**, since the
  portal accepts several and it removes the dependency on which host a user
  arrived on:
  - `https://www.brandosse.com/api/auth/social/tiktok/callback`
  - `https://brandosse.com/api/auth/social/tiktok/callback`

  Confirm Vercel's production `NEXT_PUBLIC_APP_URL` is `https://www.brandosse.com`
  (`UNVERIFIED` from here). Web platform must be ticked. TikTok rejects `localhost`.
- **App icon**, 1024×1024, JPEG/PNG, under 5MB.
- **Terms of Service URL** and **Privacy Policy URL** — must return a real page,
  not a 404. Both live on `brandosse.com`.
- **Domain verification** (DNS TXT) — **live on `brandosse.com`**, verified
  2026-09-22 (`tiktok-developers-site-verification=…`). Only strictly required
  for `PULL_FROM_URL`: video posting via `FILE_UPLOAD` works without it. Photo
  posting is pull-from-URL only, and our media lives in Supabase storage, not on
  the verified domain — so photos also need a proxy route on `brandosse.com`
  before they can work. Not built.

---

## 2. What must exist before filming

Every item below is a documented rejection cause. Sources: TikTok's Content
Sharing Guidelines, and a verbatim rejection email for a comparable integration
quoting *"Point 2)b. Privacy Status. Users must manually select the privacy
status from a dropdown and there should be no default value."*

| # | Requirement | The failure it prevents |
|---|---|---|
| 1 | Creator **nickname and avatar** shown on the compose panel, fetched fresh from `creator_info` when the panel opens | "Creator identity missing" |
| 2 | **Privacy dropdown with NO default.** Options rendered from `privacy_level_options` in the `creator_info` response. Publish stays disabled until the user actively chooses | The explicitly quoted rejection. Hardcoding `PUBLIC_TO_EVERYONE` fails |
| 3 | **Comment / Duet / Stitch toggles OFF by default**, and greyed out where `creator_info` says the creator disabled them. Duet and Stitch omitted entirely for photo posts | "Interaction settings checked by default" |
| 4 | **Commercial content disclosure OFF by default.** Enabling reveals *Your brand* and *Branded content*; at least one must be chosen | Missing disclosure |
| 5 | **Declaration text PERSISTENTLY visible** above the publish button — never revealed only on a toggle. Default: *"By posting, you agree to TikTok's Music Usage Confirmation."* With branded content: *"…Branded Content Policy and Music Usage Confirmation."* Both linked. **Verbatim** | "Music disclosure shown conditionally, not persistently". Paraphrasing also fails |
| 6 | **`max_video_post_duration_sec` enforced in the UI.** Over-length video blocked at compose time with the real number shown | "Max duration not enforced in UI" |
| 7 | **Content preview** of what will be posted | Missing preview |
| 8 | **Express consent before upload.** TikTok defines the mechanism: §5c *"API Clients must only start sending content materials to TikTok after the user has expressly consent to the upload"*, and §2 *"there should be a declaration asking for a user's consent before the publish button."* So: declaration first, then the user presses Publish. No separate dialog is required | Missing consent |
| 9 | **No promotional watermarks** on the media | Prohibited outright |
| 10 | **Processing notice** — "TikTok can take a few minutes to process your video." | Missing notice |

**Point 2 deserves emphasis.** It is the single most-cited rejection in the
wild, it blocks approval indefinitely, and it is trivially visible in a video:
a reviewer just looks at whether the dropdown starts empty. Ours must open
reading "Select who can see this" with the publish button disabled.

---

## 3. Sandbox setup

TikTok requires a sandbox for a first-time approval — production data is not
accepted as evidence.

1. Developer Portal → your app → **Sandbox** → create one
2. Add your own TikTok handle as a **target user**
3. **Set that TikTok account to private** before recording. While unaudited,
   posting to a public account returns
   `403 unaudited_client_can_only_post_to_private_accounts` — which would put a
   visible failure in your demo video
4. Point local `.env.local` at the sandbox credentials
5. Serve over the tunnel so the URL is HTTPS and matches `brandosse.com`
   where the guidelines require it

---

## 4. Shot list

**Format:** MP4 or MOV, under 50MB, up to 5 files. Screen recording at
1080p. No cuts within the flow — a continuous take is more convincing and
harder to read as staged. Narration is optional; on-screen action is what is
assessed.

**Before you hit record:** browser at 100% zoom, no other tabs, no personal
data on screen, no browser extensions visible, and the URL bar showing your
real domain.

---

### Shot 1 — Establish the product (~10s)

Open the app at `brandosse.com` (or the tunnel host), signed in, on the
dashboard.

**Must be visible:** the URL bar, showing the same domain as the Website URL
in your app config. A mismatch here is called out in the guidelines.

---

### Shot 2 — Connect TikTok · Login Kit + `user.info.basic` / `.profile` / `.stats` (~40s)

1. Navigate to **Settings → Connected accounts**. Pause so the page reads.
2. Click the **TikTok** tile.
3. On the heads-up screen, pause ~3 seconds on the permissions list — this
   is your consent disclosure and the reviewer should see it.
4. Click **Continue to TikTok**.
5. Let the real TikTok authorization screen render fully. **Do not cut here.**
   The reviewer needs to see the genuine consent screen and the scopes it lists.
6. Approve.
7. Land back in Brandosse. Pause on the connected account card showing your
   **TikTok nickname and avatar** (`user.info.basic`), your **@username, verified
   badge if you have one, and bio** (`user.info.profile`), and your **follower
   count** (`user.info.stats`).
8. Click **Open on TikTok** on the card — it opens your profile from
   `profile_deep_link` — then come back.

**Proves:** Login Kit and all three `user.info.*` scopes, each used for
something the user can see.

---

### Shot 3 — The compose panel · the audit centrepiece (~90s)

This is the shot the approval turns on. Slow down. Every element from §2 must
be visible and *interacted with*.

1. Go to the composer. Select the connected TikTok account as the target.
2. Add a short video.
3. Open the TikTok options panel. **Pause 3 seconds on the whole panel** so
   every control is legible in one frame.
4. **Point at creator identity** — hover or briefly highlight the nickname and
   avatar. Proves it is fetched fresh, not cached from connect time.
5. **The privacy dropdown.** Show it in its initial state: **empty, no
   selection**. Then show the **publish button is disabled**. Open the dropdown
   so the options from `creator_info` are visible. Select one.
   *This single sequence answers the most common rejection.*
6. **Interaction toggles.** Show Comment / Duet / Stitch all **off**. Toggle one
   on, then off again. If any are greyed out, hover to show the reason.
7. **Commercial content disclosure.** Show it **off**. Turn it on. Show
   *Your brand* and *Branded content* appearing. Select one.
8. **The declaration text.** Show it was **already visible before** the
   disclosure toggle, and that its wording **changed** when branded content was
   selected. Hover the links.
9. **Duration limit.** Briefly show the limit text derived from
   `max_video_post_duration_sec`. If you can, attempt an over-length file and
   show it blocked — a rejection you demonstrate is stronger than one you claim.
10. **Content preview.** Pause on it.

---

### Shot 4 — Publish and confirm (~30s)

1. With the declaration visible above it (§2 row 8), click **Publish**. That
   press is the express consent TikTok's guidelines define — no separate dialog.
2. Show the processing notice.
3. Show the per-target status moving to published.
4. **Cut to the TikTok app or web**, and show the post actually present on the
   account — as *Only me*, which is correct and expected while unaudited.

**Do not hide the `SELF_ONLY` result.** It is the correct behaviour for an
unaudited client, and showing it demonstrates you implemented the restriction
rather than ignored it.

---

### Shot 5 — Analytics · `video.list` + `user.info.stats` (~40s)

Must come BEFORE the disconnect: disconnecting deletes the account's analytics.
Read §1 "public videos only" first — record this against an account whose
videos TikTok returns.

1. Go to **Analytics**. Scroll to the TikTok card.
2. Pause on the account tiles: **Followers, Following, Total likes, Videos
   published**, each marked "as of" the last check (`user.info.stats`).
3. Pause on **Per post**: each public video by its TikTok title, with **views,
   likes, comments and shares** and "lifetime totals" (`video.list`).
4. Click one title — it opens the video on TikTok. Come back.
5. Point at the freshness chip ("Checked … ago"): the figures are collected on a
   schedule, not invented.

**Proves:** `video.list` and `user.info.stats` are read and shown to the user
who granted them, and nowhere else.

---

### Shot 6 — Disconnect (~15s)

Settings → the TikTok account → **Disconnect**. Show it removed.

**Proves** data deletion on user request — a requirement in the Developer
Guidelines that most submissions omit entirely.

---

## 5. Self-review checklist

Watch your own recording and tick every line. Any unticked line is a probable
rejection.

**Scope coverage**
- [ ] Every selected scope appears in the footage
- [ ] No scope is selected that the footage does not show
- [ ] The written explanation matches what the video shows

**The ten UI requirements**
- [ ] Creator nickname + avatar visible on the compose panel
- [ ] Privacy dropdown starts with **no selection**
- [ ] Publish disabled until a privacy level is chosen
- [ ] Privacy options match what `creator_info` returned
- [ ] Comment / Duet / Stitch all start **off**
- [ ] Disabled toggles are visibly disabled, with a reason
- [ ] Commercial disclosure starts **off**
- [ ] Enabling it reveals both brand options
- [ ] Declaration text visible **before** any toggle is touched
- [ ] Declaration wording changes with branded content, verbatim
- [ ] Duration limit shown and enforced
- [ ] Content preview shown
- [ ] Declaration visible before Publish is pressed (express consent)
- [ ] Processing notice shown

**Analytics**
- [ ] Account card shows @username, bio/verified, and followers
- [ ] Analytics page shows TikTok account totals, each "as of" a time
- [ ] At least one public video listed with views/likes/comments/shares
- [ ] Analytics shot recorded BEFORE the disconnect shot

**Production**
- [ ] URL bar shows the domain registered in the app config
- [ ] Real TikTok authorization screen shown, uncut
- [ ] The post is shown existing on TikTok afterwards
- [ ] No personal data, no other tabs, no extensions
- [ ] Under 50MB, MP4 or MOV
- [ ] Recorded against the **sandbox**

---

## 6. Honest status

**Re-verified 2026-09-22.** The 2026-09-05 version of this table said the compose
panel was not built and named it the critical path. That was already false on
2026-09-19 and is corrected here.

| | Status | Evidence |
|---|---|---|
| Compose panel | **Built — all ten §2 rows met and guarded** | `src/components/Publishing/TikTokOptionsPanel.jsx`, mounted at `QuickPostComposer.jsx:820` and `components/Generate/PostProductionPanel.jsx:1259`. `node scripts/check-tiktok-ux-compliance.cjs` → PASS, **26** requirements (was 17: five rows were met in code but asserted by nothing, and the check read the panel alone, so it would have passed with the panel unmounted). Every new assertion mutation-tested 2026-09-22 |
| Scope list | **Decided 2026-09-22** — all five + `video.upload` (automatic) | §1. Portal still needs `video.list` added (founder screenshot 2026-09-22) |
| TikTok analytics | **Built, tested, not deployed** | 15 adapter tests; `check-metric-aggregation` covers snapshots. Needs migration `20260922120000` applied and `ingest-social-analytics` redeployed |
| `video.list` on a private account | `UNVERIFIED` | Decides how Shot 5 is recorded (§1) |
| Redirect URI | Portal value `UNVERIFIED` | Must be the `www` host (§1); register both |
| ToS / Privacy pages | **Live** | `https://www.brandosse.com/terms` and `/privacy` → 200 |
| Domain TXT | **Live** on `brandosse.com` | DNS TXT present |
| App icon | `UNVERIFIED` | Founder-side |
| Sandbox credentials | Present locally | Client key prefix `sbaw` in `.env.local` = sandbox |
| Sandbox target user (private account) | Not configured | Founder-side |
| Vercel `TIKTOK_CLIENT_KEY` / `SECRET` | `UNVERIFIED` | Connect route 401s before reading env |
| First real connect + one private post | **Never done** | All TikTok `connected_accounts` rows are `is_mock` |
| Video | Blocked on the row above | |
| TikTok photo posting | **Built 2026-09-23, not yet configured** | Needs MEDIA_PROXY_SECRET in Vercel + Supabase, publish-post redeployed, and the URL prefix verified in the portal. Never run against TikTok |

**The critical path is:** apply the migration and deploy analytics → add
`video.list` in the portal → configure a private sandbox target user → the
first real connect and one private post (and check what `video.list` returns). That first live run is the first time the
adapter, chunked upload, token refresh and revoke will ever touch TikTok, so it
should happen before filming, not during it.
