# Master Rebuild Plan — Competing With the Giants

Date: 2026-06-01
Owner: Founder (solo) + Claude (implementation)
Status: PROPOSED — awaiting greenlight on Stage 1
Supersedes for execution: `ui-consistency-audit-plan-2026-04-29.md` (merged in here)
Builds on: `USER_PERSONAS.md`, `COMPLETED_AND_REMAINING_WORK.md`, `FEATURE_INVENTORY.md`

---

## 0. The one thing to understand first

The product does **not** look messy because of bad taste or weak effort. It looks messy because of a **foundation problem that was diagnosed but never fixed**:

- `--color-primary` is redefined 3× in `tokens.css` alone; 8+ parallel token namespaces (`--color-*`, `--brand-*`, `--accent`, `--primary`, `--dash-*`, `--org-*`, `--admin-*`, `--public-*`, `--bk-*`, `--brandosse-*`) all alias roughly the same indigo. You cannot predict which value wins.
- A strong component library exists (`ui-primitives.css`: `ui-button`, `ui-card`, `ui-field`, `ui-dialog`, `ui-badge`...) but **1 file uses it** while **123 files hand-roll their own buttons** across ≥3 naming systems.
- 63 CSS files, 50+ imported flat — later files silently override earlier ones. ~117 inline styles in JSX bypass the system entirely.

**World-class products look consistent because every button on every page is literally the same component.** Ours can't be until there is one enforced source of truth. This is fixable, and fixing it once lifts every page at the same time. Every past attempt stalled because pages kept getting built before the foundation was consolidated. **This plan fixes the foundation first, then migrates — and adds governance so it cannot drift again.**

---

## 1. Personas (reference + the "feel" layer)

Full definitions live in `USER_PERSONAS.md`. The 7 personas: **Solo Creator, Small Business Owner, Org Contributor, Editor/Reviewer, Org Owner/Admin, External Client Reviewer, Platform Admin/Operator.**

What was missing — and what you asked for — is **how each should *feel*** at the moment of use. This is the emotional contract each surface must honor:

| Persona | Should feel… | Fails when… | Design consequence |
| --- | --- | --- | --- |
| Solo Creator | "This is effortless and a little magical." Momentum, creative flow. | A blank page, a silent failure, or an unclear status. | Start from creation not config; vivid media preview; obvious next step; warm recovery on AI failure. |
| Small Business Owner | "I'm in control without babysitting." Calm confidence. | Buried approvals; technical role jargon. | Summary-first screens; one-tap approve/request-change; plain-language governance. |
| Org Contributor | "I always know what to do next." Clarity, no anxiety. | Permission blocks with no explanation; scattered feedback. | Task-first home; feedback attached to the item; explain *why* an action is blocked. |
| Editor/Reviewer | "I can judge quality in seconds." Decisiveness. | Context split across pages; vague requests. | Side-by-side content + metadata; one feedback place; strong status filters. |
| Org Owner/Admin | "Nothing will blow up on me." Safety, certainty. | Hidden role impacts; no audit trail. | Role-impact previews; confirmations; audit-friendly copy + timestamps. |
| External Client Reviewer | "Oh, that was easy." One focused task. | App complexity; login friction; lost link. | No nav/sidebar; mobile-first; clear approve/changes; graceful expired-link state. |
| Platform Admin | "I can find it and fix it, safely." Operational command. | Mock data unlabeled; no audit; slow search. | Dense, searchable, filterable; live-vs-mock labels; safe destructive confirms. |

**Rule that follows from this:** copy, density, and motion must differ by persona. A creator needs *momentum*; an admin needs *certainty*. Same tokens, different rhythm.

---

## 2. Competitive positioning — how we beat the giants

From current market research (June 2026): the leaders each own one lane —
- **Hootsuite** — broadest AI + engagement-based scheduling calendar.
- **Sprout Social** — deepest intelligence/sentiment; data-first teams.
- **Buffer** — simplicity and best AI-to-price for solo/small.
- **Later** — visual-first, content-planning for brand-led teams.

**None of them lead with what we have: a brand kit that drives generation → review → schedule → publish as one governed loop.** That is our wedge.

Our differentiators to lean into (and make obvious in the UI):
1. **Brand-native generation.** Captions/hashtags/images that are genuinely on-brand because the brand kit feeds every prompt. (Today the prompts are generic — we will make them platform-native and brand-aware. See §6.)
2. **The whole loop in one app.** Generate → library → calendar → review → publish, for both solo and teams. Giants make you stitch tools.
3. **Team governance for small teams/agencies** without enterprise complexity — pipeline + client review + roles, but approachable.
4. **AI that explains itself** (caption audits, slot rationale, readiness checks) — trust, not a black box.

**Bar to clear to be "un-ignorable":** every core flow must be reliable end-to-end (no mock surprises in the demo path), consistent visually, fast, and mobile-clean. Polish + reliability beats more features.

---

## 3. Current state — honest scorecard

| Area | State | Note |
| --- | --- | --- |
| Auth + protected routes | Working | Native Next routes. |
| DB security (RLS) | **Stronger than expected** | 40+ migrations, org isolation, RLS recursion hotfixes, no service-role in browser, no hardcoded secrets, 0 `dangerouslySetInnerHTML`. |
| AI provider routing | Fixed this session | Grok removed; Claude-first with Groq fallback; bug where Claude never ran is fixed. |
| Generation workspace | Working | Brand-aware, session-based. |
| Calendar | V3 rebuilt | Drag-schedule, AI command bar, week plan. |
| Publishing | **Mock only** | Biggest "is it real?" gap. No real OAuth, no scheduled-publish worker. |
| Status values | Inconsistent | Causes wrong counts/badges across user/admin. |
| Caption/hashtag quality | Generic | Prompts not platform-native. |
| UI consistency | **Broken foundation** | Root cause of "messy" — §0. |
| Mobile | Partial | `responsive-contract.css` exists; not enforced per-pattern. |
| Native apps | None | Capacitor path recommended (§9). |
| Automated tests | Thin | Manual QA only. |

---

## 4. The staged rebuild plan (foundation-first)

Each stage has a **Definition of Done** so it can't half-land. Stages are ordered so that **value compounds** — Stage 1 makes every later stage faster and consistent.

### STAGE 1 — Foundation (DO THIS FIRST; nothing else matters until it's done)
**Goal:** one enforced source of truth. After this, every page can be made consistent quickly.
1. **Tokens → 3-tier model** (industry standard): *global primitives* (raw hex/px) → *semantic aliases* (`--surface`, `--text`, `--action`, `--status-*`) → *component tokens* (`--button-bg`...). Collapse the 8 namespaces; keep `--dash/--org/--admin` only as thin compatibility bridges that point at semantics. Delete duplicate/conflicting redefinitions. One indigo, defined once.
2. **Adopt `ui-primitives` for real.** Promote to React components: `UiButton, UiIconButton, UiCard, UiPanel, UiBadge, UiStatusBadge, UiPageHeader, UiStatCard, UiField, UiTabs, UiFilterBar, UiTable, UiModal, UiDrawer, UiEmptyState`. One canonical `StatusBadge` + status map.
3. **Three shells on one grammar.** User/Org/Admin shells share spacing scale, nav height, sidebar width, card radius, button heights, empty/loading/error states — while keeping role-specific nav.
4. **Governance guardrails.** A lint/audit script that fails on: new raw hex (except brand/platform/chart), new generic global class names (`.card`, `.btn-primary`...), `transition: all`, icon buttons without `aria-label`, images without `alt`.

**Definition of Done:** token files reduced to one canonical layer; the 3 shells render on shared primitives; audit script green; one "golden" page per surface migrated as the reference.

### STAGE 2 — High-traffic personal pages
Dashboard, Generate (AI Studio), Calendar (V3 already close), Library, Brand Kit, Settings, Help. Migrate onto primitives; kill inline styles; per-pattern responsive.

### STAGE 3 — Admin control plane
Migrate off monolithic `AdminDashboard.css` into scoped modules on primitives. Overview, Users, User Detail, Moderation, Complaints, Logs, Analytics, Accounts, Organizations, Settings. Dense/searchable/filterable; live-vs-mock labels.

### STAGE 4 — Org/team workspace
Overview, Workspace, My Office, Pipeline, Org Calendar, Asset Library, Common Room, Team Activity, Org Admin (members/roles/pipelines/credits/brand-kit/settings). One status-chip system; consistent modals.

### STAGE 5 — Public/auth + external review
Landing, login/register/reset, invitation accept, client review, context selector. Expressive but on the same tokens. Client review must be flawless on mobile.

### STAGE 6 — Reliability & "is it real" (parallelizable with UI)
Standardize status domain end-to-end; calendar schedule-persistence reliability; **scheduled-publish worker**; at least **one real social OAuth** connection path; label all mock clearly.

### STAGE 7 — Mobile/native + QA pass
Per-breakpoint review (375/768/1024/1440); Capacitor wrap to app-store builds (§9); cross-surface visual QA; lightweight integration tests on the core journey.

---

## 5. Security hardening plan (build on the solid base)

The DB layer is good. Gaps to close, in priority order:
1. **RLS coverage audit** — verify *every* table exposed via the API has RLS enabled + a policy; index every column used in policies (top performance killer). Test as different users/orgs to prove isolation.
2. **Edge function authz** — confirm every function calls `requireUser` and (for org data) checks membership/role, not just auth. Spot-checked good in several; make it a checklist for all.
3. **Secret hygiene** — keys are gitignored and server-side (good). Add: rotate the Anthropic key that was shared in chat earlier; confirm no secrets in client bundles at build time.
4. **Rate limiting & abuse** — per-user/per-tier limits on AI endpoints (ties to §6 cost) to prevent credit-drain and DoS.
5. **Storage bucket policies** — verify signed URLs / per-user prefixes on uploads (migration exists; verify enforcement).
6. **Audit trail** — admin destructive actions already log; extend to publish/credit/role changes uniformly.
7. **Input validation** — validate/limit payloads on edge functions (caption length, array sizes) to avoid prompt-injection blowups and oversized requests.

---

## 6. AI token consumption & cost plan (you asked specifically)

Research-backed levers (can cut AI spend 60–85%). Apply in order of impact:
1. **Model routing by complexity (biggest lever).** ~70% of calls → cheap model, ~20% → mid, ~10% → premium.
   - Session titles, slot suggestions, simple classifications → **cheapest** (Groq `llama-3.1-8b-instant` / Haiku-class).
   - Captions, audits, prompt enhancement → **mid** (Groq 70B / Sonnet-class).
   - Full content-plan / brand extraction / complex reasoning → **premium** (Claude Sonnet/Opus only where it pays).
2. **Prompt caching.** Anthropic charges ~10% of input price for cache hits → 70–90% savings on the cached portion. Move large, stable system prompts (brand kit context, schema skeletons) into cached prefixes. (The `claude-api` skill enforces this when we touch Anthropic code.)
3. **Semantic caching.** Cache results for repeated/near-identical requests (e.g., prompt suggestions per brand-kit hash — already partially done; extend it).
4. **Prompt compression.** Trim verbose system prompts; pass only the brand fields a task needs.
5. **Per-tier budget enforcement.** Dollar/credit budget per user tier on AI endpoints; deduct measured cost per call (the codebase already tracks `totalTokens`). Prevents runaway spend and abuse.

**Net effect:** predictable, low AI cost that scales with users instead of exploding.

---

## 7. User data safety & privacy
- **Data minimization** — only store what's needed; brand kit + content are the sensitive assets.
- **Tenant isolation** — enforced by RLS (§5); the guarantee a team's content never leaks to another.
- **At-rest/in-transit** — Supabase encrypts at rest; all traffic HTTPS. Confirm storage buckets aren't public.
- **Deletion/export** — give users a path to export and delete their data (GDPR-style hygiene; also a trust signal for the client).
- **Third-party data flow** — content sent to AI providers: document it, and prefer providers with no-training guarantees for customer data. Add a short privacy note in-app.
- **PII in logs** — ensure logs/audit don't store raw secrets or full user content.

---

## 8. API / service-provider structure review
Current external dependencies: **Supabase** (auth/db/storage/edge/realtime), **Anthropic** + **Groq** (LLM), **Replicate/Freepik/Pollinations** (media), **Resend** (email), **Paystack/Stripe** (payments).
- **Single LLM gateway** — all model calls already route through `_shared/llm.ts` (good; we just hardened it). Keep every feature on it so routing/caching/budgets are enforced in one place.
- **Provider failover** — Claude→Groq is in place; document the matrix; add health/timeout handling consistently.
- **Media providers** — consolidate behind one service interface so we can swap/upgrade without touching pages.
- **Webhooks** — payments + video worker use signed secrets (good); verify signatures everywhere.
- **Idempotency** — publish + payment paths must be idempotent before going live.

---

## 9. Scalability & mobile/native

**Scalability**
- RLS + indexed tenant columns = DB scales per-tenant cleanly.
- Stateless edge functions scale horizontally.
- Add: pagination/virtualization on long lists (library, admin tables, logs); realtime subscription cleanup (no leaks); cache AI + suggestion results; move heavy work (publishing, video) to background workers/queues.

**Mobile responsiveness**
- Enforce **one responsive contract per UI pattern** (shell, page header, filters, stat grid, table, drawer/modal, card grid, calendar) — not per page. Tables must define mobile behavior (collapse to cards). 44px min touch targets. Reduced-motion policy global.

**Native apps (recommended path: Capacitor)**
- Research-backed: for a form/content-driven SaaS like this, **Capacitor wraps the existing Next/React app into iOS/Android app-store builds with ~full code reuse** (days, not a rewrite). React Native would mean rebuilding the UI from scratch — not worth it for v1.
- Sequence: get the responsive web right (Stage 7) → wrap with Capacitor → add native niceties (push notifications, share-to-app) later.

---

## 10. Blind spots — things not yet on your radar
1. **Onboarding/first-run.** A guided "brand kit → first post in 5 min" flow is the difference between activation and churn. Giants invest heavily here.
2. **Empty states as activation.** Every empty screen should sell the next action (persona-specific). Currently inconsistent.
3. **Error/failure UX.** AI/edge failures need warm, recoverable messaging — not silent fails (the Solo Creator's #1 trust risk).
4. **Observability.** You can't fix what you can't see — add lightweight error tracking (e.g., Sentry) + AI cost dashboards.
5. **Billing/credits truth.** Credits page is partly read-only; make governance self-service before client demo if billing is in scope.
6. **Accessibility = market access.** Missing alt text / labels / contrast can block enterprise/agency buyers and app-store review.
7. **Legal pages.** Terms, privacy policy, data-processing note — table stakes for a client-facing product.
8. **Demo data.** A clean, seeded demo account makes the client demo land far harder than a sparse real one.
9. **Performance budget.** Bundle size / first-load — 63 CSS files imported flat is also a perf smell; consolidation helps here too.
10. **Notifications.** In-app + email for review requests, failures, schedule confirmations — drives retention.

---

## 11. Model strategy per stage (so you don't waste credits)

Principle (from cost research): use the strongest model only where judgment compounds; use cheaper models for high-volume pattern work.

| Work | Best model | Why |
| --- | --- | --- |
| This plan, architecture, token-system design, security review, the **first "golden" page** of each surface | **Opus (claude-opus-4-8)** | High-judgment, low-volume. The reference sets the pattern everything copies — worth getting perfect once. |
| Bulk page-by-page migration onto the established pattern (Stages 2–6, ~50+ pages) | **Sonnet (claude-sonnet-4-6)** | 80% of the volume. Strong, fast, far cheaper. Excellent at following a set template. |
| Mechanical edits — token renames, dead-CSS removal, adding `aria-label`/`alt`, 1:1 inline-style→class | **Haiku (claude-haiku-4-5)** | High-volume, low-judgment. Cheapest. |

**Recommended cadence:** Opus designs Stage 1 + the golden templates → switch to **Sonnet** to grind the page migrations → drop to **Haiku** for cleanup sweeps. Switch with `/model`. This mirrors the 70/20/10 routing that cuts cost 60–80% without quality loss on the work that matters.

---

## 12. What I need from you
1. **Greenlight Stage 1** (foundation). It's the unlock; I recommend doing it on Opus, then we switch models.
2. **Brand truth:** is indigo the final primary, or do you have real brand colors/logo/font to lock in? (We set this once in the token primitives and it cascades everywhere.)
3. **Demo scope:** which persona/flow does the client evaluate first? (I'll make that the first golden path.)
4. **Is billing/real-publishing in scope for this 3-week delivery,** or is a clearly-labeled realistic demo acceptable? (Changes Stage 6 weight.)
5. **Reference products** you love the *look* of (even outside this space) — helps me hit "world-class" on your taste, not a generic default.

---

## 13. Definition of "un-ignorable" (acceptance for the whole effort)
- One token system; no competing namespaces; audit script green.
- Every page uses shared primitives; no page-specific button systems.
- The 3 shells share visual rhythm; each persona's "feel" is honored.
- Core journey reliable end-to-end with no unlabeled mock surprises.
- Clean at 375 / 768 / 1024 / 1440; 44px touch targets; reduced-motion respected.
- AI cost predictable (routing + caching + budgets); security gaps in §5 closed.
- Capacitor build runs on a phone.
