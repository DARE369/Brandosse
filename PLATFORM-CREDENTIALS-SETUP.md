# Platform Credentials — Setup & Multi-User Ceilings

**Date:** 2026-09-03
**Companion to:** [`FUNCTIONAL-SPECIFICATION-PUBLISHING.md`](FUNCTIONAL-SPECIFICATION-PUBLISHING.md)
**Env contract:** `.env.example` Section 7

This is an operations runbook, not a current-state claim. Nothing here is wired
yet — it tells you what to create, what to paste where, and what each platform
will and will not let you do before app review.

---

## 0. The number that governs this phase

**How many people can publish through your app today, before any review passes:**

| Platform | Ceiling | How a user gets added | Publicly visible? |
|---|---|---|---|
| **LinkedIn** — personal profile | **Unlimited** | Nothing. Self-serve, open permission. | **Yes** |
| **Meta** — FB Pages + Instagram | App-role holders only | You invite them as Admin/Developer/Tester in the App Dashboard; they must accept | **Yes** |
| **TikTok** | **50** (10 target users × 5 sandboxes) | You add their TikTok handle to a sandbox | No — `SELF_ONLY` |
| **YouTube** | **100** test users | You add their Google address to the OAuth consent screen | No — locked private, permanently |

**Read this correctly.** These are not architecture limits and no amount of code
moves them. They are the platforms' review gates. The multi-tenancy you build
now serves unlimited users the day each review clears.

**What actually got unblocked.** The Zernio free tier capped you at *2 connected
accounts across the entire API key* — not per user. That was a hard product
blocker: no real user could ever be onboarded. Direct OAuth is genuinely
per-user, so that ceiling is gone. The remaining gates are external and have a
known clearing path.

**LinkedIn is the one to prove the loop on.** It is the only platform where an
arbitrary user can connect and publish something genuinely public today, with
no review, no invite list, and no private-lock. Wire it first — it is the only
end-to-end public proof available before review.

---

## 1. Before you touch any dashboard

Three decisions, in this order, because each one is expensive to change later.

### 1.1 Get the domain first if you can

Redirect URIs are matched **exactly** against an allowlist you register in each
platform's dashboard. Changing your origin later means re-registering in four
places, and on Google it means **re-verification**, which restarts a multi-week
clock.

Also settled by research: Google's OAuth verification requires you to verify
ownership of every authorized domain in Search Console, and rejects
`*.vercel.app`. Meta and TikTok technically accept it but weigh it against you.
A domain is ~$10–15/year and Vercel attaches custom domains free.

**If you don't have it yet:** register localhost redirect URIs now (§1.2), build
against those, and register the production URI once the domain lands. Local
development is not blocked.

### 1.2 Localhost support is not uniform

| Platform | `http://localhost:3000` works? | Local workaround if not |
|---|---|---|
| Google / YouTube | **Yes** — explicitly exempt from the HTTPS rule | — |
| LinkedIn | **Yes** | — |
| Meta | **Yes**, but prefers `https://localhost:...` with Strict Mode on | Add localhost to App Domains too |
| **TikTok** | **No** — HTTPS only, and URL properties must be domain-verified | A tunnel (`ngrok`, `cloudflared`) giving a stable HTTPS hostname you can verify |

TikTok is the one that forces a tunnel or the real domain. Plan for it rather
than discovering it at the dashboard.

### 1.3 Register every URI you will ever use, now

Each platform accepts a list. Register all of them up front — localhost, the
tunnel hostname, and production — so you never block on a dashboard round trip
mid-debug.

```
http://localhost:3000/api/auth/social/{platform}/callback
https://{your-tunnel}/api/auth/social/{platform}/callback     # TikTok at minimum
https://{your-domain}/api/auth/social/{platform}/callback
```

`{platform}` is one of: `meta`, `tiktok`, `linkedin`, `youtube`.

---

## 2. Meta — Facebook Pages + Instagram

**One app serves both.** Instagram professional accounts are reached *through*
Facebook Login, so there is one OAuth client and one redirect URI. The two tiles
in the connect UI both start the same Meta flow; the sub-account step decides
whether you are listing Pages or IG accounts.

### Create it

1. developers.facebook.com → **My Apps** → **Create App**
2. App type: **Business**
3. Add products: **Facebook Login** and **Instagram**
4. Facebook Login → Settings → **Valid OAuth Redirect URIs** → add all of §1.3
5. Settings → Basic → copy **App ID** and **App Secret**

### Paste

```
META_APP_ID="..."
META_APP_SECRET="..."
META_GRAPH_VERSION="v21.0"
```

Pin the version. Meta deprecates on a ~2-year clock, and an unversioned call
silently follows the default forward — the same defect class as a `-latest`
model alias.

### Permissions to request

`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
`business_management`, `instagram_basic`, `instagram_content_publish`.

### Gotchas

- **Business Verification must pass before App Review**, not alongside it.
  Attempting review first is the most common sequencing mistake and costs a
  full cycle.
- Instagram **Personal** accounts cannot be published to at all. Only Business
  and Creator, and they must be linked to a Page. Surface this as a fixable
  reason in the sub-account step, never as a hidden row.
- An IG account is limited to **100 API-published posts per rolling 24h**.
- Testers must **accept** the invite before they can authorize. An invited-but-
  not-accepted user gets an opaque failure.

---

## 3. TikTok — Content Posting API

### Create it

1. developers.tiktok.com → **Manage apps** → create an app
2. Add the **Content Posting API** product
3. Request scopes: `user.info.basic`, `video.publish`
4. **Configure URL properties** — verify ownership of your ToS URL, Privacy
   Policy URL, and Web URL, by DNS TXT record or by serving a signature file.
   Required for any app created after 2024-09-09.
5. Add a **Sandbox**, and add target users by TikTok handle
6. Copy **Client key** and **Client secret**

### Paste

```
TIKTOK_CLIENT_KEY="..."
TIKTOK_CLIENT_SECRET="..."
```

### Gotchas

- **Two separate gates.** Scope approval, and *then* a distinct content audit.
  Passing the first does not lift the `SELF_ONLY` cap.
- **The target account must be set to private at the moment of posting** while
  unaudited, or the API returns `403 unaudited_client_can_only_post_to_private_accounts`.
  Detect this at compose time — failing at dispatch is a silent content loss.
- 5 users per 24h while unaudited.
- **The audit checks your UI.** Creator nickname freshly fetched, a privacy
  dropdown with no default, interaction toggles off by default, and two
  declaration strings reproduced verbatim. See spec §7.1 — apps are rejected
  for paraphrasing. Build it right the first time; a rejection restarts weeks.
- Sandbox is where you record the demo video the production audit requires, and
  it must cover **every** scope you request.

---

## 4. LinkedIn

### Create it

1. linkedin.com/developers → **Create app** — requires an associated LinkedIn
   **Company Page** you administer (create one first if needed)
2. **Products** tab → request **Share on LinkedIn** and **Sign In with LinkedIn
   using OpenID Connect** — both are self-serve and grant instantly
3. Auth tab → add redirect URLs from §1.3
4. Copy **Client ID** and **Client Secret**

### Paste

```
LINKEDIN_CLIENT_ID="..."
LINKEDIN_CLIENT_SECRET="..."
```

### Scopes

`openid`, `profile`, `w_member_social`. Company-page posting additionally needs
the **Community Management API** — dev tier is self-serve at 5k calls/day but
requires a registered legal organization.

### Gotcha

Access tokens are ~60 days and **LinkedIn does not issue refresh tokens on the
standard tier**. Every user must re-authorize every 60 days. The "Expiring soon"
account state in spec §5.1 is not decorative here — it is the only thing
standing between a user and a silently dead integration.

---

## 5. YouTube — Google Cloud

### Create it

1. console.cloud.google.com → create or select a project
2. **APIs & Services → Library** → enable **YouTube Data API v3**
3. **OAuth consent screen** → External → fill in app name, support email,
   **Privacy Policy URL**, **Terms of Service URL**, and authorized domains
4. Add test users (up to 100) while unverified
5. **Credentials → Create Credentials → OAuth client ID → Web application** →
   add redirect URIs from §1.3
6. Copy **Client ID** and **Client Secret**

### Paste

```
GOOGLE_OAUTH_CLIENT_ID="..."
GOOGLE_OAUTH_CLIENT_SECRET="..."
```

Not to be confused with `GOOGLE_FONTS_API_KEY` in Section 4 — that is an API key
for a public endpoint, this is an OAuth client acting on a user's behalf.

### Scopes

`https://www.googleapis.com/auth/youtube.upload`,
`https://www.googleapis.com/auth/youtube.readonly`

### Gotchas — the worst of the four

- **Uploads before the compliance audit are locked private, permanently, and
  the lock is not appealable.** Not by us, not by the user. The only remedy is
  re-uploading after approval, which loses the URL, the views and any shares.
  Test with throwaway content on a throwaway channel.
- Default quota is **10,000 units/day** and one upload costs ~1,600 → **about
  six uploads per day** before you are throttled.
- Unverified apps show a full-page "Google hasn't verified this app" warning.
  Test users can click through; it looks alarming and will generate support
  questions.
- Verification requires **Search Console ownership of every authorized domain**,
  and the privacy policy must sit on the same domain as the homepage. This is
  the hard blocker that `*.vercel.app` fails.

---

## 6. Order of operations

Parallelise where the gates are independent — they mostly are.

**Do immediately (no dependencies):**
1. Create all four apps and collect credentials into `.env.local`
2. Mirror every value to Supabase secrets — `npx supabase secrets set KEY=value`
3. Generate `TOKEN_ENCRYPTION_KEY` and `OAUTH_STATE_SECRET`
4. Start **Meta Business Verification** — longest pole, gates everything on Meta
5. Register the domain

**Then, in build order:**
6. Token custody migration — must land **before the first real token is stored**
   (spec §10.2 / defect D1). Non-negotiable sequencing.
7. LinkedIn adapter — the only genuinely public end-to-end proof available now
8. Meta adapter — proves multi-account fan-out, since one user commonly has
   several Pages
9. TikTok adapter + the mandated UI — build the UI to audit spec first time
10. YouTube adapter — last, and gated behind the block/warn decision

**Submit for review when:** the UI is complete enough to record the demo video
each platform requires. All four want a screencast of the real OAuth flow and
the real publish path. That is the actual gating artefact, not the code.

---

## 7. Verifying multi-tenancy, concretely

"More than one user can publish" is proven by these checks, not by two accounts
appearing to work.

| Check | Why it matters | How |
|---|---|---|
| User A cannot read User B's tokens | The whole point of §10.2 | `node scripts/security/cross-tenant-probe.mjs` — service-role reads bypass RLS and prove nothing |
| Two users connecting the same platform concurrently don't collide | Signed state carries the user id; a shared nonce store would cross them | Two browsers, two accounts, interleaved connect flows |
| User A's scheduled post never dispatches to User B's account | The scheduler currently joins on `ca.user_id = p.user_id` (defect D4) | Seed posts for both, run `process_scheduled_posts()`, assert each landed on its owner |
| One post fanning out to N accounts records N outcomes | Needs `publish_targets` (defect D6); `workflow_state` jsonb cannot hold it | Publish to 3 targets, force 1 to fail, assert "Published to 2 of 3" |
| A revoked token surfaces as "Reconnect needed", not a green dot | The fail-open "Healthy" default at `useDashboardData.js:126-140` | Revoke in the platform's own settings, reload |

Each of these needs a guard that runs continuously, not a one-time manual pass.
A fix without a detector has a demonstrated half-life in this repo.
