# D4 — Definition of Complete
**Deep Launch-Readiness Audit · Brandosse** · Phase 4 · 2026-08-21

> The concrete bar at which work on each existing capability **stops**. Not aspirational.
> Written only for capabilities that already exist (Completion Lock). Genuinely new ideas are in D8.
> Founder constraint from Gate 0: no fixed date, all pillars targeted at L5. These definitions therefore set the **L4 "competitive" bar as the launch gate**, and name the L5 increment separately where one exists — because L5 on every pillar simultaneously is a multi-year programme, and the launch gate must be reachable.

Format: `WHEN <trigger>, THE SYSTEM SHALL <response>`.

---

## DoC-1 · Publishing (P6) — *the keystone*

**Functional criteria**
- WHEN a user connects a social account, THE SYSTEM SHALL complete a real OAuth grant via Zernio and store a `provider='zernio'` record, or fail with a specific reason.
- WHEN a connected account cannot publish for any reason, THE SYSTEM SHALL display it as `needs_reconnect` and never as active/healthy.
- WHEN a scheduled post reaches its time, THE SYSTEM SHALL dispatch it exactly once, verified by `publish_request_id` idempotency.
- WHEN a publish attempt fails, THE SYSTEM SHALL record the reason, retry up to 3 times with backoff, and **notify the user in-app after the final failure**.
- WHEN a post remains in `publishing` longer than 15 minutes, THE SYSTEM SHALL transition it to `failed` with a timeout reason and surface it.
- WHEN a post is dispatched, THE SYSTEM SHALL store `external_post_id` for later attribution.

**Quality bar**
- ≥4 platforms publishing for real (Instagram, TikTok, LinkedIn, YouTube minimum — matching Buffer's free tier at $6/channel/mo).
- Publish success rate ≥98% excluding platform-side rejections.
- Zero posts in a non-terminal state older than 1 hour.
- Dispatch p95 within 60s of scheduled time.

**Persona acceptance tests**
- *Power Migrant:* connects 4 accounts, schedules 20 posts across a week, and all 20 publish or fail loudly — unaided.
- *Casual Operator:* connects one account and publishes one post within 5 minutes of signup, without reading documentation.

**Edge cases handled:** expired Zernio grant · platform rate limit · platform 500 · post scheduled in the past · duplicate dispatch · server restart mid-dispatch · media too large · caption over platform limit · account disconnected between schedule and dispatch.

**Observability:** per-dispatch structured log (post, account, platform, outcome, latency); alert on failure rate >5% in 1 hour; alert on any post in `publishing` >15 min; dashboard of publishes/day by platform.

**Explicitly out of scope:** approval workflows, team roles, bulk CSV import, first-comment scheduling, link-in-bio.

---

## DoC-2 · Video clipping (P5) — *the strongest asset*

**Functional criteria**
- WHEN a user submits a YouTube URL, THE SYSTEM SHALL ingest it successfully in ≥90% of attempts on public videos.
- WHEN ingestion is blocked by bot detection, THE SYSTEM SHALL retry via the configured mitigation and, if it still fails, offer direct upload with a plain-language explanation.
- WHEN a video is ingested, THE SYSTEM SHALL transcribe it with word-level timestamps regardless of length.
- WHEN a transcript exceeds the model output budget, THE SYSTEM SHALL segment the analysis so no candidate moment is lost to truncation.
- WHEN clips are selected, THE SYSTEM SHALL render each to the platform preset requested (9:16, 1:1, 16:9) with burned-in word-level captions and speaker-aware framing.
- WHEN a job fails at any stage, THE SYSTEM SHALL report which stage, in user-comprehensible language, and refund credits.

**Quality bar**
- Job success rate ≥90% on public YouTube URLs and direct uploads.
- 60-minute source processed end-to-end in ≤10 minutes p95.
- Cost per 60-minute source ≤$0.40 (currently ~$0.20–0.30).
- Transcription WER competitive with Whisper large-v3 on clean English audio.
- **No raw tracebacks ever rendered to a user.**

**Persona acceptance tests**
- *Power Migrant:* pastes a 45-minute podcast URL and receives ≥8 usable vertical clips with accurate captions, without editing anything.
- *Casual Operator:* uploads a phone video and gets clips without knowing what a transcript or aspect ratio is.

**Edge cases handled:** 3-hour source · 4K input · no audio track · non-English · private/geo-blocked URL · ffmpeg crash · disk full · worker OOM · mid-render cancel · two speakers · screen recording with no face.

**Observability:** per-stage timing and failure counts; ingestion success rate by source type (the metric that would have caught P5-007 in a day); cost per job; alert if ingestion success drops below 85%.

**L5 increment (post-launch):** clip scoring validated against real published performance — which requires DoC-1 and DoC-6 first.

**Explicitly out of scope:** B-roll insertion, multi-language dubbing, custom caption animation editors, collaborative editing.

---

## DoC-3 · Text generation (P3)

**Functional criteria**
- WHEN a user generates content, THE SYSTEM SHALL inject the active brand kit into the prompt and produce platform-differentiated output.
- WHEN a user regenerates, THE SYSTEM SHALL preserve the prior version in `content_versions` and allow revert.
- WHEN a user requests a refinement ("shorter", "punchier"), THE SYSTEM SHALL apply it as an instruction against the existing draft rather than a blind re-roll.
- WHEN the primary provider fails, THE SYSTEM SHALL fall back **and emit an alert**.
- WHEN generation returns empty or invalid output, THE SYSTEM SHALL surface a retry affordance, never a silent empty string.

**Quality bar**
- Model explicitly configured and current-generation — never an unexamined default.
- Generation p95 ≤8s for a single caption.
- ≥3 revisions retained per post with visible diff.
- Cost per generation ≤$0.05.

**Persona acceptance tests**
- *Power Migrant:* iterates a caption through 3 refinements, compares versions, reverts to v2 — and rates the output at least as good as their own ChatGPT workflow.
- *Casual Operator:* gets a usable caption on the first try with no options configured.

**Edge cases handled:** empty brand kit · provider 500 · rate limit · token limit · mid-stream cancel · concurrent generations · non-English brand voice.

**Observability:** per-generation provider, model, tokens, latency, cost; alert on any fallback activation; alert on empty-output rate >1%.

**Explicitly out of scope:** fine-tuned per-user models, multi-language translation, long-form blog generation.

---

## DoC-4 · Content planning & calendar (P2)

**Functional criteria**
- WHEN an AI action is offered in the UI, THE SYSTEM SHALL implement a handler for it, or SHALL NOT offer it.
- WHEN a user applies a generated week plan, THE SYSTEM SHALL create the corresponding draft posts and confirm how many were created.
- WHEN a user selects multiple posts, THE SYSTEM SHALL support bulk reschedule and bulk delete.
- WHEN a post is scheduled, THE SYSTEM SHALL respect the user's timezone including DST transitions.
- WHEN a scheduling conflict exists, THE SYSTEM SHALL surface it without blocking the action.

**Quality bar**
- **Zero UI affordances that silently no-op** — the single hardest rule in this document, and the one P2 currently fails.
- Calendar renders 500 posts without virtualization jank.
- Optimistic updates reconcile within 2s.

**Persona acceptance tests**
- *Power Migrant:* plans a 4-week campaign, bulk-reschedules a week by 2 days, and never re-enters content by hand.
- *Casual Operator:* schedules their first post from the calendar without opening a menu twice.

**Edge cases handled:** empty calendar · 500+ posts · timezone/DST · concurrent edits · past-dated scheduling · deleted account mid-schedule.

**Observability:** count of AI actions offered vs handled (must be equal); apply-action success rate.

**Explicitly out of scope:** campaign hierarchies, series templates, content-pillar quota enforcement, approval chains.

---

## DoC-5 · Ideation (P1)

**Functional criteria**
- WHEN a user opens ideation, THE SYSTEM SHALL offer suggestions grounded in at least one non-fabricated signal, or SHALL clearly label them as generic starters.
- WHEN a signal source is unavailable, THE SYSTEM SHALL degrade visibly rather than present fabricated data as insight.
- WHEN a user likes an idea, THE SYSTEM SHALL persist it for later use.
- WHEN an idea is selected, THE SYSTEM SHALL carry its full context into generation without re-entry.

**Quality bar**
- **Zero fabricated data presented as real-world signal.** Non-negotiable — this is a trust property, not a quality metric.
- Suggestions reflect the brand kit; two different brands must not receive identical suggestions.

**Persona acceptance tests**
- *Power Migrant:* gets suggestions specific enough to their niche that at least 1 in 5 is usable unedited.
- *Casual Operator:* goes from opening the app to a selected idea in under 60 seconds with no blank-page moment.

**Edge cases handled:** empty brand kit · brand-new account with no history · signal source down · non-English brand.

**Observability:** suggestion acceptance rate; signal-source freshness and failure alerts.

**Explicitly out of scope:** competitor content monitoring, audience research tooling, trend prediction.

---

## DoC-6 · Analytics & loop closure (P8) — *the thesis*

**Functional criteria**
- WHEN a post has been published, THE SYSTEM SHALL fetch its real performance metrics from the platform on a schedule and store them against `external_post_id`.
- WHEN performance data exists, THE SYSTEM SHALL surface per-post, per-platform, and date-range comparisons, with export.
- WHEN a user generates new content, THE SYSTEM SHALL include their top-performing prior posts as prompt context. *(This is the P8→P3 carrier — the loop closing.)*
- WHEN sufficient history exists, THE SYSTEM SHALL derive posting times from measured performance and use them in scheduling. *(P8→P2 carrier.)*
- WHEN insufficient data exists, THE SYSTEM SHALL say so plainly rather than display fabricated or illustrative figures.

**Quality bar**
- Metrics refreshed at least daily per published post.
- Attribution chain `generations → posts → external_post_id → metrics` intact for ≥95% of published posts.
- **At least one loop handoff (P8→P1, P8→P2, or P8→P3) graded INTACT with a citable carrier.** Below this, the product thesis is unimplemented.

**Persona acceptance tests**
- *Power Migrant:* identifies their best-performing format in under 2 minutes and generates a new post informed by it.
- *Casual Operator:* sees one clear, plain-language statement of what worked and what to do next.

**Edge cases handled:** zero published posts · platform API rate limit · revoked token mid-fetch · deleted platform post · account disconnected.

**Observability:** metric freshness per post; fetch failure rate by platform; **an explicit dashboard of loop-closure health** — how many generations were informed by prior performance.

**Explicitly out of scope:** competitor benchmarking, paid-ad analytics, cross-account attribution, custom report builders.

---

## DoC-7 · Discovery score / reach (P7)

**Functional criteria**
- WHEN content is scored, THE SYSTEM SHALL either ground the score in an external or historical signal, OR present it explicitly as an unvalidated stylistic checklist.
- WHEN a scored post is later published, THE SYSTEM SHALL record score-versus-outcome so calibration becomes measurable.
- WHEN scoring fails, THE SYSTEM SHALL show "unscored — retry" and never a fabricated 0. *(Already met — `seo.ts:258-272`.)*

**Quality bar**
- Score-to-outcome correlation **measured and published internally** — the number may be weak, but it must exist.
- Scoring cost ≤$0.02 per post; p95 ≤5s.

**Persona acceptance tests**
- *Power Migrant:* can see why a score was given and whether it has ever predicted anything.
- *Casual Operator:* receives at most 3 concrete, actionable suggestions — not 9 numeric dimensions.

**Edge cases handled:** very short caption · no hashtags · non-English · emoji-only · invalid JSON from model.

**Observability:** score distribution over time; correlation tracking; alert if scores collapse to a narrow band (a sign the model changed).

**L5 increment:** weights learned from the user's own outcomes. Requires DoC-1 and DoC-6.

**Explicitly out of scope:** keyword-volume tooling, SERP tracking, thumbnail A/B testing.

---

## DoC-8 · Video generation (P4)

**Functional criteria**
- WHEN a user requests a video, THE SYSTEM SHALL call a real provider and return a stored asset the product owns — never a hotlink or placeholder.
- WHEN a tier is selected, THE SYSTEM SHALL charge the advertised price, or obtain explicit consent before charging more.
- WHEN mock mode is active, THE SYSTEM SHALL label output as simulated in the UI.
- WHEN generation fails, THE SYSTEM SHALL refund credits automatically and surface the provider reason.

**Quality bar**
- Success rate ≥90% (currently 0%).
- **Positive gross margin at every credit tier** — currently negative at the cheapest (P10o-001).
- Cost per output reconciled against live provider rates.
- Mock mode **defaults to off**.

**Persona acceptance tests**
- *Power Migrant:* compares output against Runway/Kling and finds it acceptable for social use.
- *Casual Operator:* generates a video without understanding tiers, and is charged what they were shown.

**Edge cases handled:** provider timeout · webhook never arrives · duplicate webhook · worker dies mid-job · user cancels · concurrent submits · content filter rejection.

**Observability:** success rate, cost per output, margin per tier, queue depth, stuck-job alerts.

**Explicitly out of scope (for launch):** voiceover, music, multi-shot assembly, captions on generated video, shot planning. **These absences must be stated in the UI so expectations are set** — silent single-shot mute output is the current failure.

---

## DoC-9 · Dashboard shell (P9)

**Functional criteria**
- WHEN any in-scope route renders, THE SYSTEM SHALL use `src/ui-v2` primitives and the shared shell. *(Founder decision: ui-v2 is the target.)*
- WHEN a route exists, THE SYSTEM SHALL provide navigation to it, or SHALL remove it.
- WHEN system state is displayed, THE SYSTEM SHALL reflect the true underlying state — including degraded and failed states.
- WHEN a surface has no data, THE SYSTEM SHALL explain why and offer the next action.
- WHEN a control is rendered, THE SYSTEM SHALL wire it to a real handler.

**Quality bar**
- **100% of in-scope routes on ui-v2** (currently 71%); legacy shell and stylesheets deleted.
- Zero unstyled renders.
- Time-to-first-value ≤5 minutes for a new signup.
- Usable at 375px on every in-scope route.
- Keyboard-navigable primary flows; focus trapped in modals.

**Persona acceptance tests**
- *Power Migrant:* finds every major surface without a tutorial and reaches video generation without typing a URL.
- *Casual Operator:* completes signup → brand kit → first generated post unaided.

**Edge cases handled:** zero-data account · 500+ items · slow network · session expiry mid-action · deep link to an unauthorised resource.

**Observability:** route-level error rate; TTFV funnel; nav-item click distribution (orphaned routes show as zero).

**Explicitly out of scope:** dark/light theming beyond current support, i18n, offline mode, custom dashboards.

---

## DoC-10 · Foundations (P10)

**Functional criteria**
- WHEN any authenticated user queries any table, THE SYSTEM SHALL return only rows they own or are explicitly granted.
- WHEN a background job is scheduled, THE SYSTEM SHALL make it visible to monitoring — **no allowlists**.
- WHEN any job or record enters a non-terminal state, THE SYSTEM SHALL bound that state with a timeout and a reaper.
- WHEN a provider fallback activates, THE SYSTEM SHALL alert.
- WHEN a required credential for an enabled feature is missing, THE SYSTEM SHALL fail at startup, not at runtime.
- WHEN a secret is committed, CI SHALL fail.

**Quality bar**
- **Zero cross-tenant reads** — verified by an automated test that logs in as user A and attempts to read user B's rows across every table. This test is the single highest-value test in the codebase and does not exist.
- Zero live secrets in git history.
- Every outbound call has a timeout.
- CI runs tests, not just a build.
- Cost per active user tracked and alerting on deviation.

**Persona acceptance tests:** not user-facing — but every persona test above implicitly depends on these.

**Edge cases handled:** RLS bypass attempts · IDOR on every ID-taking endpoint · webhook replay · expired tokens · concurrent credit deduction · service-role key exposure.

**Observability:** error tracking with alerting (currently absent); structured logs queryable in production; a health check that enumerates *all* jobs; per-user cost tracking.

**Explicitly out of scope:** SOC2, pen-test certification, multi-region, HA failover.

---

## Summary — the launch gate

A capability is **complete for launch** when it meets its DoC above at the **L4 bar**. Three cross-cutting rules override every individual definition:

1. **Nothing user-facing may silently no-op.** (Violated today by P2-004, P9-010, P4-004.)
2. **Nothing may display fabricated data as real.** (Violated today by P8-001, P9-004.)
3. **Nothing may lose user content.** (Violated today by P6-003, P3-003.)

These three are the minimum trust contract. Every one is currently broken somewhere.
