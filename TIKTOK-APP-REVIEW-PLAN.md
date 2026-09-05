# TikTok App Review — Submission Plan

**Date:** 2026-09-05
**Companion to:** [`FUNCTIONAL-SPECIFICATION-PUBLISHING.md`](FUNCTIONAL-SPECIFICATION-PUBLISHING.md) §7.1
**Status:** pre-submission. The compose panel this describes is **not built yet.**

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
1. Freeze the scope list          (§1)
2. Build the compose panel        (§2 — the real work)
3. Set up the sandbox             (§3)
4. Record, following the shot list (§4)
5. Self-review against the checklist (§5)
6. Submit
```

Recording before step 2 is wasted effort: the footage would show a panel that
does not satisfy the guidelines, which is the single most common rejection.

---

## 1. Freeze the scope list

### Current state — will be rejected

Selected: `user.info.basic`, `user.info.profile`, `user.info.stats`,
`video.list`, `video.upload`
Products: Login Kit, Content Posting API, **Share Kit**

The written explanation describes `user.info.basic` and `video.publish`. So:

- **`video.publish` is not selected at all.** It only appears after the
  **Direct Post** toggle under Content Posting API is switched on. Without it,
  the application requests draft-upload while the explanation describes direct
  posting.
- **Four scopes and one product are selected that the explanation never
  mentions.** The video would have to show Brandosse reading follower counts,
  bios, verified status, and listing the user's public TikTok videos.

### Target state

| Keep | Why |
|---|---|
| **Login Kit** | The connect flow |
| `user.info.basic` | open_id, nickname, avatar — required to show which account receives the post |
| **Content Posting API** with **Direct Post ON** | The posting flow |
| `video.publish` | Direct posting. Appears only once Direct Post is toggled on |

| Remove | Why |
|---|---|
| `user.info.profile` | Bio, verified status, profile links — unused |
| `user.info.stats` | Follower/like/video counts — unused |
| `video.list` | Reading the user's public videos — unused |
| `video.upload` | Draft-to-inbox. A different flow; keeping it means demoing it too |
| **Share Kit** | Not used at all |
| **Local Service API** + its three `local.*` scopes | Shop/product/voucher management. Nothing to do with this product |

### Also required before submission

- **Redirect URI** (currently empty, flagged required):
  `https://brandosse.com/api/auth/social/tiktok/callback`
  Web platform must be ticked. TikTok rejects `localhost`.
- **App icon**, 1024×1024, JPEG/PNG, under 5MB.
- **Terms of Service URL** and **Privacy Policy URL** — must return a real page,
  not a 404. Both live on `brandosse.com`.
- **Domain verification** (DNS TXT) — only strictly required for `PULL_FROM_URL`.
  Video posting via `FILE_UPLOAD` works without it; **photo posting does not**.

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
| 8 | **Explicit confirmation** before upload | Missing consent |
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

### Shot 2 — Connect TikTok · Login Kit + `user.info.basic` (~30s)

1. Navigate to **Settings → Connected accounts**. Pause so the page reads.
2. Click the **TikTok** tile.
3. On the heads-up screen, pause ~3 seconds on the permissions list — this
   is your consent disclosure and the reviewer should see it.
4. Click **Continue to TikTok**.
5. Let the real TikTok authorization screen render fully. **Do not cut here.**
   The reviewer needs to see the genuine consent screen and the scopes it lists.
6. Approve.
7. Land back in Brandosse. Pause on the connected account card showing your
   **TikTok nickname and avatar**.

**Proves:** Login Kit, `user.info.basic`, and that the app reads only profile
basics.

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

1. Click **Publish**. Show the confirmation step and confirm explicitly.
2. Show the processing notice.
3. Show the per-target status moving to published.
4. **Cut to the TikTok app or web**, and show the post actually present on the
   account — as *Only me*, which is correct and expected while unaudited.

**Do not hide the `SELF_ONLY` result.** It is the correct behaviour for an
unaudited client, and showing it demonstrates you implemented the restriction
rather than ignored it.

---

### Shot 5 — Disconnect (~15s)

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
- [ ] Explicit confirmation before upload
- [ ] Processing notice shown

**Production**
- [ ] URL bar shows the domain registered in the app config
- [ ] Real TikTok authorization screen shown, uncut
- [ ] The post is shown existing on TikTok afterwards
- [ ] No personal data, no other tabs, no extensions
- [ ] Under 50MB, MP4 or MOV
- [ ] Recorded against the **sandbox**

---

## 6. Honest status

| | |
|---|---|
| Scope list | **Wrong** — see §1 |
| Redirect URI | Missing |
| Compose panel | **Not built** — §2 is the work |
| App icon | Not supplied |
| ToS / Privacy pages live on the domain | Unverified |
| Domain TXT verification | Pending a third party |
| Sandbox | Not created |
| Video | Cannot be recorded until §2 exists |

The critical path is **§2**. Everything else is configuration or waiting; the
panel is the only part that is engineering, and nothing downstream can start
without it.
