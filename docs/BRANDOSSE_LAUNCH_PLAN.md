# Brandosse — Page-by-Page Overhaul & Launch Plan
> **Superseded — verify against code before trusting anything here.**
> Written before the 2026-08 launch audit. Known wrong as of 2026-08-22:
> media generation is **fal.ai only** (Freepik, Magnific, Pollinations, Replicate
> and Grok are gone, keys deleted from every environment); text generation is
> Anthropic-first with a Groq fallback, model IDs pinned; and several files cited
> here no longer exist — `src/services/freepik.service.js`,
> `_shared/freepik.service.ts`, `src/config/magnificModels.js`,
> `supabase/functions/start-generation`, `src/app/`, `src/api/`.
> Current provider truth: [`TECHNICAL_CONSTRAINTS.md` §11](TECHNICAL_CONSTRAINTS.md).
> This file has NOT been line-by-line verified — it is flagged, not fixed.


_Synthesized from a 5-agent deep audit (Generate, Calendar, Library, Settings/BrandKit/Billing, Analytics/Video Lab), the dashboard rebuild, and the live QA screenshot verification. Last updated 2026-06-18._

## 0. Where we are (done & verified)

- **Design system locked & live:** "Midnight Studio" (dark) / "Solar Paper" (light) blend with accent swap, ported into the 3-tier tokens (`src/styles/tokens.css`) + fonts. Build-verified.
- **Personal dashboard rebuilt** to the system: performant (one 9-query batch, no waterfalls/dupes), mobile-native (2×2 KPIs, decluttered top bar, summary chart), thumbnails wired.
- **Mobile bottom nav fixed app-wide** (root cause: admin/user shared global class `.sidebar-nav` collision) — verified on the real render (all 5 tabs).
- **Real testing apparatus:** QA Supabase account + Playwright screenshot harness (`scripts/qa-screenshot.cjs`) — we verify pixels, not code. Delete the QA user before prod.
- **Persistent agent personas:** `devils-advocate`, `technical-cofounder`, `mobile-ux-specialist`, `frontend-visual-qa` in `.claude/agents/`.

## 1. Headline decision

**Every remaining page = TARGETED UPGRADE, not a rebuild.** Each has sound logic/state/routing but desktop-first CSS with broken/absent mobile and token-compliance gaps. Rebuilding would risk regressions (realtime subs, lifecycle guards, route handoffs) for no desktop payoff. **No stack/infra change is needed** — Next.js + Supabase + Vercel is the right stack; the problems are fixable code.

## 1.5 The audit team (personas + models)

Senior dev (me, Opus) orchestrates; specialist personas in `.claude/agents/` audit each surface, I synthesize → fix → verify. **Every page is audited through 5 lenses — Security · Performance · Scalability · Functionality · UX/UI/Mobile — not just mobile.** The dashboard already went through this; each subsequent page repeats it.

| Persona | Lens | Model |
|---|---|---|
| Cybersecurity Auditor (`security-auditor`) | RLS, data isolation, secrets, input/XSS/SSRF, abuse, scale-safety | Opus |
| DevOps / Scalability (`devops-scalability`) | load-time, N+1, pagination, caching, realtime cost, 100→30M scale | Opus |
| Backend / Functionality (`backend-functionality`) | end-to-end correctness, state/lifecycle, error states, data integrity | Sonnet |
| UX / Product Critic (`ux-product-critic`) | real-user flow (social media manager), polish, consistency, unstyled buttons | Sonnet |
| Mobile UX Specialist (`mobile-ux-specialist`) | mobile-native vs reflow | Opus |
| Frontend Visual QA (`frontend-visual-qa`) | real screenshots, what's actually rendered | Sonnet |
| Devil's Advocate (`devils-advocate`) | challenge every decision | Opus |
| Technical Co-founder (`technical-cofounder`) | direction, tradeoffs, push back | Opus |
| Mechanical Refactor Bot | token sweeps, hex→token, dead-code | Haiku |

## 2. Cross-cutting work FIRST (one effort → every page benefits)

> **STATUS (2026-06-20): cross-cutting work DONE & build-verified.**
> - Performance core (auth-gate de-block + optimistic paint + CSS-per-route + auth N+1 collapse) ✅ — see `docs/PERFORMANCE_KILL.md` (~2s dev, was 5–15s).
> - Shared primitives ✅ — `UiBottomSheet`, `UiStickySaveBar`, `UiOverflowMenu` in `src/components/Shared/ui/UiMobilePrimitives.jsx`.
> - Token/CSS sweep ✅ — video-engine (43 hex → tokens, `SCORE_BAR_COLORS` centralized), Brand Kit (21 values + `100vh→100dvh` keyboard fix), Library (theme-adaptive shadows, token fixes, 3-pass override collapse).
> - Namespace cleanup ✅ (effectively) — CSS-per-route removed admin/org sheets from user pages, eliminating the `.sidebar-nav` collision at source.
> - Dead-code purge ✅ — 14 orphaned files removed (Generate orphans + the whole unrouted CalendarV2 tree). Library remains on `useState` fetches (React Query folds in per-page).
> - Folded into per-page: route within-page code-splitting + React Query adoption (see PERFORMANCE_KILL §4/§5). Agenda/list pattern lands with the Calendar upgrade.

### 2a. Performance & Load-Time — SYSTEMIC, #1 PRIORITY (answers "why 5–15s loads")

The stack is not the cause; fixable code is. **Target: <2s perceived load per page** (parity with Hootsuite/Buffer/Higgsfield). The "3-step, 15-second" load is the items below stacking:
1. **Global auth gate blocks ALL render** ([src/next/NextAppProviders.jsx](src/next/NextAppProviders.jsx)) until auth **and** workspace-access resolve, with **10–15s timeouts** — affects EVERY page. → render the shell immediately, stream/skeleton the access-gated parts, cut timeouts to ~5s, parallelize + cache resolved access.
2. **No route-level code-splitting** → a giant JS bundle on every page. → `dynamic()`/lazy-load page components + heavy deps (Chakra, Recharts, Framer, dnd-kit); split vendor chunks.
3. **~50 CSS files (incl. all admin) loaded upfront** via `app-entry.css`. → scope CSS per route; never ship admin CSS to end users.
4. **Per-page query waterfalls** (the exact pattern fixed on the dashboard, repeated). → batch into one round-trip, nested selects, kill the org-membership N+1 in `authService.js`.
5. **No query caching** → every navigation refetches. → adopt React Query (already a dependency) consistently; tune `staleTime`; prefetch on hover/nav.
Measure before/after with Lighthouse + Navigation Timing on staging. This is the workstream the owner feels most — do it first.

### 2b. Shared mobile primitives (build once, reuse everywhere)
- **`UiBottomSheet`** — slide-up sheet (used by: Generate post-production, Library filters, Video Lab clip detail, mobile pickers).
- **`UiStickySaveBar`** — appears when a form is dirty, sticks to bottom, clears the bottom tab bar (Settings, Brand Kit).
- **`UiOverflowMenu`** — `…` menu collapsing multi-button rows (Library cards, Calendar posts).
- **Agenda/list pattern** — date-grouped card list replacing grids on phone (Calendar, Library list view, Analytics table→cards).
- **Mobile tab switcher** — scrollable pill row replacing hidden side-tabs (Brand Kit review form, Settings).
- **Skeleton shimmer** — reuse the dashboard's `bd-skel` everywhere (Library, Brand Kit, etc.).

### 2b. Token & CSS hygiene sweep (systemic)
- **Kill hardcoded hex:** Video-engine components (**51 instances**), Brand Kit (`rgba(99,102,241,…)`, `#fff`), Library (`--public-dark-text`, `--ink-950`, raw `rgba(15,23,42)` shadows), Generate goal-icon hexes.
- **Theme-adaptive shadows:** replace dark-biased `rgba(…)` shadows with `color-mix(in srgb, var(--color-text-primary) X%, transparent)` so light mode is correct.
- **Fix wrong/undefined tokens:** `--color-bg-secondary/-tertiary` (undefined → leak Tailwind blue `#3b82f6`); centralize Video Lab score colors in `clip-utils.js` to `--color-success/warning/danger`.
- **`100vh` → `100dvh`** + `env(safe-area-inset-*)` across full-height panels (Brand Kit conversation, Generate, Library).
- **Touch targets ≥44px** + `touch-action: manipulation` on all interactive controls.

### 2c. Structural cleanup
- **Namespace the shell** (real fix for the admin/user class collision): scope admin styles under `.admin-shell` or rename `.sidebar-nav`→`.app-sidebar-nav`. (Bottom-nav already works via a scoped override; this removes the underlying fragility.)
- **Dead-code purge:** legacy `GenerateV2.css` blocks, `CalendarV2.*` + V2 component tree, Library 3-pass override blocks, orphaned `src/components/Generate/*`.
- **Standardize buttons:** migrate `bk-btn-*`, `ve-primary-btn`, raw `btn-*` to `UiButton` variants over time.

## 3. Per-page upgrade specs

**Every page below also gets the full 5-lens audit before/while fixing**, not only the UI/mobile items listed:
- 🔐 **Security:** RLS enforced server-side for this surface; no data leakage across users/orgs; input validation; user content (captions/prompts/brand kit) escaped.
- ⚡ **Performance:** eliminate this page's own fetch waterfalls; lazy-load its heavy children; batch queries; cache.
- 📈 **Scalability:** no unpaginated/unindexed list queries; realtime sub cost bounded; no N+1.
- 🧪 **Functionality:** works end-to-end with proper loading/empty/error states; lifecycle guards.
- 🎨 **UX/UI/Mobile:** real-user flow, token/button consistency (no unstyled/mismatched buttons), mobile-native (per below).

The items under each page are the page-specific findings already surfaced; the lenses above are applied uniformly.

### AI Studio / Generate — `BrandosseGenerateStudio` (M)
- **Mobile-native = bottom-sheet progression**: full-screen canvas; fix fixed-element `left: var(--personal-sidebar-width)` offset → `left:0` ≤768px (unbreaks prompt bar, advanced drawer, session rail); post-production drawer → **bottom sheet** (88dvh) with drag handle; prompt chips → horizontal scroll row; intent goal grid 6-col→2-col; lightbox padding fix; hover-only card actions → visible on `@media (hover:none)`.
- Token cleanup (goal hexes, radius tokens, `--font-display`); remove `MOCK_STUDIO_CREDIT_FLOOR` masking real balance; purge dead `GenerateV2.css`.

### Calendar — `CalendarPageV3` (L)
- **Mobile-native = Agenda view**: new `AgendaView.jsx` (date-grouped full-width post cards, tap→PostPanel, stacked drafts with tap-to-schedule) replaces the week grid ≤599px; **3-day strip** at 600–899px via a `dayCount` prop on `WeekGrid`; header collapses; safe-area padding.
- **Bug:** add lifecycle guard in `handleDragEnd` (block rescheduling `published`/`publishing` — silent data corruption today).
- Restore dropped V2 value: ghost slots, bulk schedule, platform/status filters. Align local `--cal3-radius/shadow` to canonical tokens. (Month view = later phase, desktop-only.)

### Library — `LibraryPageV2` (M)
- Collapse 3-pass CSS into one block; fix token violations + theme-adaptive shadows.
- **Card actions:** 1 primary CTA + `UiOverflowMenu` (styles already exist, just wire them).
- **Mobile:** search-first bar; filters in `UiBottomSheet`; section tabs as horizontal scroll strip; 1-col cards; bottom-nav clearance; suppress list/table view on phone; skeletons; section-aware empty-state CTAs.

### Settings — `Settings.jsx` (M)
- `UiStickySaveBar` on mobile; tab bar → dropdown/segmented on phone (bottom nav already covers primary nav); timezone `<select>` (IANA); avatar upload→Supabase storage (replace URL field); styled toggle switches; `UiButton` for saves.

### Brand Kit — `BrandKitPage` (M, **highest-risk mobile bug**)
- **Fix functional breakage:** review-form side tabs disappear <700px → add scrollable **mobile pill tabs** driving the same `activeTab`.
- Conversation `100vh`→`100dvh` + safe-area (keyboard bug); choice screen 2-col→1-col <480px; glow-blob overflow; raw-hex sweep; spinner/skeleton loading; danger states → tokens.

### Billing/Credits — `CreditsPage` (S)
- Fix undefined-token fallbacks (kills wrong `#3b82f6`); price-per-credit callout + stronger "popular" card in stacked view; correct empty state (`Coins`, not spinner); card-wrap the header + back-link; (later) move out of `VideoEngine/` namespace to `Billing/`.

### Analytics — `PersonalAnalyticsPage` (S)
- Remove dead theme-swatch strip; mobile 2×2 stat strip; recent-posts table → card list ≤640px; sticky mobile CTA; funnel → horizontal scroll chips. (Already token-clean & data-honest — least work.)

### Video Lab — VideoEngine pages (S token sweep + L mobile gallery)
- **S:** centralize score colors → tokens (fixes 4 files); shared `ScoreBar` + `CreditsNotDeductedBadge` components; token-name audit (`--color-bg-secondary`… → canonical); Lucide icons + 44px toggles; delete-confirm touch targets.
- **L:** **ClipsGallery mobile** — replace split panel with vertical clip card list → full-screen clip **bottom sheet** (9:16 player, scores, caption, download). Desktop split/list/table stays.

## 4. Sequencing to deployment

**Priority anchored on the golden path (Solo Creator: brand → generate → schedule).**

1. **Performance workstream (§2a) FIRST** — fix the global auth gate, route + CSS code-splitting, caching. This is the owner's #1 pain and benefits every page immediately. Then the rest of cross-cutting: **shared mobile primitives + token/CSS sweep + namespace fix + dead-code purge** (§2b–2c). ~1–1.5 wk. Verify load times on staging with the QA harness.
2. **Generate** (golden path core). M.
3. **Calendar** mobile agenda + lifecycle guard. L (feature parity later).
4. **Brand Kit** (quality multiplier; fix the functional mobile breakage). M.
5. **Settings** (accounts/connections needed to publish). M.
6. **Library** + **Analytics** + **Billing**. M + S + S.
7. **Video Lab** (token sweep now; mobile gallery as fast-follow). S + L.
8. **Scalability hardening** (from master plan): atomic credit deduction RPC, atomic rate-limit, keyset pagination, timing-safe bearer, startup secret validation, query timeouts, pooling, caching, rate limits.
9. **Staging deploy — all 3 targets** (Vercel app + Supabase edge fns + worker container). Measure real load times; QA each page on real infra.
10. **Production deploy** + final checklist.

Each page step = build → **Frontend + Mobile QA agent screenshot verification** (seed the QA account so populated states are testable) → fix → sign-off.

## 5. Deployment topology & cost (unchanged, near-$0)

- **Vercel** (Hobby, free): Next.js app + light API. Secrets server-side only; `OAUTH_STATE_SECRET` required.
- **Supabase** (free): DB/Auth/Storage + ~53 edge functions (deploy via CLI; secrets in Supabase Secrets).
- **Worker** (small always-on host ~$5–20/mo): Python FastAPI + FFmpeg video engine (cannot run on Vercel). `VIDEO_WORKER_URL` + rotated webhook secret.
- **AI:** Claude-first metered (Groq fallback). Only fixed costs: worker host + metered AI.
- **Step 0 (owner):** rotate the 3 git-history-leaked keys (Groq/FAL/Pollination) + set `OAUTH_STATE_SECRET`. (Service-role/Anthropic/Paystack are disk-only, not in the repo.)

## 6. Rough effort rollup

Performance workstream ~3–5d · rest of cross-cutting ~1 wk · Generate ~M · Calendar ~L · Brand Kit ~M · Settings ~M · Library ~M · Analytics ~S · Billing ~S · Video Lab ~S+L · Security + Scalability hardening ~M · Deploy (3 targets) ~M. **≈ 5–7 focused weeks solo to a secure, fast (<2s), scalable, mobile-native, deployed MVP** (Video Lab mobile gallery and Calendar feature-parity can fast-follow launch).

## 7. Verification (every step)

- Build green (`npm run build:next`).
- QA harness screenshots: desktop 1440 + mobile (Pixel 5) + 320px, light & dark, per page.
- Mobile-UX + Frontend QA agent review of the real screenshots.
- Backend/Service-Connection QA before deploy (Supabase RLS, AI providers, worker `/health` + webhook, OAuth round-trips).
- Concurrency test credits + rate limiter before prod.
