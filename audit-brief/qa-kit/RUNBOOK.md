# RUNBOOK — Live Verification of the Generate Page Fixes (Weeks 1-3)

This is the master checklist. Everything in `audit-brief/FIXLOG.md` marked
"Could not verify — no live environment available" gets closed out here.
Work through this top to bottom; fill in every `RESULT:` line as you go,
then paste the whole filled-in **RESULTS TEMPLATE** (at the very end of this
file) back for review.

**A note on trust**: every script in this kit was written by re-reading the
CURRENT code of whatever it tests, not by trusting what FIXLOG claims that
code does. Where re-reading the code turned up something FIXLOG got wrong
or overstated, it's called out inline below as a **FINDING**, separate from
the pass/fail checks themselves — the most important one is in Check 6.

---

## PART A — PREREQUISITE SETUP (do this before anything else)

### A0. Create the two test accounts

1. Sign up for two normal, free accounts in the app (whatever your normal
   signup flow is — email/password is simplest). Use real-looking emails you
   control, e.g. `you+qaverify1@yourdomain.com` and `you+qaverify2@...`.
2. **Account #1** (`TEST_USER_EMAIL`) needs:
   - At least ~20 credits (enough to cover `verify-credits.js`'s handful of
     real image generations — it restores your balance to whatever it was
     before each run, so credits aren't *consumed* by testing, but the
     account needs a starting balance for the "set balance to N" steps to
     make sense. If your project seeds new accounts with starter credits,
     you may already have enough).
   - Optionally, one **mock connected account** (Settings → Connected
     Accounts → connect any platform using the mock/demo option, if your
     app's UI offers one). If you skip this, `verify-scheduled-publish.js`
     will create and clean up a temporary one automatically — either is
     fine.
3. **Account #2** (`TEST_USER_2_EMAIL`) needs nothing beyond existing and
   being able to log in. It's only used to prove it CANNOT see account #1's
   private data.
4. Fill in `qa-kit/.env` with both accounts' credentials (see
   `qa-kit/README.md`).

### A1. Confirm the Vault `service_role_key` secret exists

**Why this matters**: `dispatch_scheduled_post()` (the function that
actually sends a scheduled post to `publish-post`) silently no-ops with a
logged warning if this secret is missing — Week 1's FIXLOG flagged this as a
manual, non-migratable step that could not be confirmed from the repo.
**Check 7 (`verify-scheduled-publish.js`) depends on this being done.**

**Click-path**: Supabase Dashboard → your project → **SQL Editor** → New
query → run:

```sql
select name, created_at from vault.decrypted_secrets where name = 'service_role_key';
```

- **One row comes back** → the secret exists. Move on.
- **Zero rows** → run this once (replace with your REAL service-role key —
  the same one in your `qa-kit/.env`):

```sql
select vault.create_secret(
  '<your-real-service-role-key>',
  'service_role_key',
  'Used by dispatch_scheduled_post() and the process-jobs/process-scheduled-posts cron jobs.'
);
```

`RESULT: ______________` (found existing / created new / error — paste it)

### A2. Confirm both cron jobs are registered and active

**Click-path**: same SQL Editor, run:

```sql
select jobname, schedule, active from cron.job
where jobname in ('process-scheduled-posts', 'process-jobs');
```

Expect exactly 2 rows, both `active = true`:
- `process-scheduled-posts` — schedule `* * * * *` (every minute)
- `process-jobs` — schedule `* * * * *` (every minute)

If either is missing, re-apply the corresponding migration
(`20260710120000_vault_based_cron_secrets.sql` /
`20260712120000_week3_process_jobs_cron.sql`) via `supabase db push` or the
SQL Editor directly.

`RESULT: ______________` (both present & active / one missing — which one)

### A3. Confirm `job-webhook` does NOT require a Supabase auth JWT

**Why this matters**: fal.ai's webhook call to `job-webhook` carries only the
per-job token this app generates (`?job_id=...&token=...`) in the URL — it
does **not** carry a Supabase session JWT. If this function has Supabase's
"Enforce JWT verification" setting ON, every webhook call from fal.ai will
be rejected before your function code even runs, and video jobs will only
ever complete via the `process-jobs` poller (functionally OK, just slower
than intended). **Check 6 (`verify-video-jobs.js`) Case A's timing
classification depends on this being OFF.**

**Click-path**: Supabase Dashboard → your project → **Edge Functions** →
`job-webhook` → **Details**/**Settings** tab → find "Enforce JWT
Verification" (sometimes shown as "Verify JWT"). It must be **OFF/disabled**
for this specific function (this is a per-function setting — other
functions like `generateImage` correctly keep it enabled, since those
really are called with a Supabase session).

If your CLI-based deploy config controls this instead (`supabase functions
deploy job-webhook --no-verify-jwt`), confirm that flag was used for this
function specifically.

📸 **Take a screenshot of this setting** (for the record — paste path/name
below, attach the image when you report results).

`RESULT: ______________` (JWT verification OFF confirmed / still ON — fix
before running Check 6 / could not find the setting — describe what you see)

### A4. (Optional but recommended) Remove `generations` from the realtime publication, if nothing else needs `postgres_changes` on it

**Why this matters**: Week 2 Fix 1's migration replaced `postgres_changes`
subscriptions with broadcast-from-database for this feature, but flagged
that `generations`' membership in the `supabase_realtime` publication was
never added by a tracked migration — meaning it was toggled on via the
Dashboard at some point, outside version control, and may still be granting
a `postgres_changes` subscription path this feature no longer uses (but
which could still be exposed to a different, unaudited subscriber).

**Click-path**: Dashboard → **Database** → **Replication** → find the
`supabase_realtime` publication → check whether `generations` is listed.

- If yes, and you've confirmed no other feature in the app subscribes to
  `generations` via raw `postgres_changes` (grep the codebase for
  `.channel(...).on('postgres_changes'` targeting `generations` — Week 2's
  audit found none), removing it from the publication closes this
  historical exposure at the replication level entirely.
- This step is **informational/optional** — nothing in this kit depends on
  it, but it's the one remaining item from Week 2 Fix 1's "manual dashboard
  checks the owner must still run" list.

📸 **Take a screenshot either way** (whether `generations` is in the
publication) for the record.

`RESULT: ______________` (generations found in publication, removed / found,
left in place / not found)

---

## PART B — SCRIPTED CHECKS

Run these **in this order**. Each entry: what it verifies, which
Week/Fix it closes, expected cost, expected runtime, dependencies.

### Check 1 — `node verify-realtime-payload.js`

- **Verifies**: the exact shape of `realtime.broadcast_changes()`'s payload
  — does the row land under `payload.record` (what SessionStore.js assumes
  first) or a different key? Also whether INSERT/UPDATE events are
  distinguishable.
- **Closes**: FIXLOG Week 2 Fix 1 — "the exact field names
  `realtime.broadcast_changes()` puts inside that payload."
- **Cost**: free (one QA session + one QA generation row, cleaned up).
- **Runtime**: ~15 seconds.
- **Depends on**: nothing.
- **If it FAILS on the payload-shape check**: this is a one-line fix in
  `SessionStore.js`'s `subscribeToSession` — the script tells you exactly
  which key to check first.

`RESULT: ______________`

### Check 2 — `node verify-realtime-authz.js`

- **Verifies**: a second user genuinely cannot subscribe to the first
  user's session broadcast topic OR background-jobs topic — this is the
  actual security boundary, not just "the client doesn't ask for it."
- **Closes**: FIXLOG Week 2 Fix 1 — "second user / org non-member attempting
  to subscribe to someone else's session's topic ... Could not execute this
  against a live project."
- **Cost**: free.
- **Runtime**: ~30-60 seconds (waits up to 12s per subscribe attempt).
- **Depends on**: `TEST_USER_2_EMAIL`/`TEST_USER_2_PASSWORD` being set.
- **If Check 2 or 4 in this script's output shows SUBSCRIBED**: stop and
  treat this as a real, live cross-user data exposure — do not proceed with
  the rest of this runbook until it's fixed.

`RESULT: ______________`

### Check 3 — `node verify-trigger-ownership.js`

- **Verifies**: `ensure_draft_post_for_generation`'s `ON CONFLICT DO
  NOTHING` hardening actually matches the live `posts` table's partial
  unique index character-for-character — proven empirically by forcing the
  exact race (a generation's status flipped to `completed` twice
  concurrently) rather than just reading the SQL.
- **Closes**: FIXLOG Week 3 Fix 1 — "live-database confirmation that the ON
  CONFLICT target expression exactly matches the partial index's stored
  expression ... never run against a live Postgres instance."
- **Cost**: free.
- **Runtime**: ~10 seconds.
- **Depends on**: nothing.

`RESULT: ______________`

### Check 4 — `node verify-rate-limit.js`

- **Verifies**: `check_rate_limit()`'s advisory-lock concurrency guard under
  REAL parallel load (15 truly-simultaneous calls against a 10/min limit) —
  does exactly 10 succeed, not 9 or 11?
- **Closes**: FIXLOG Week 2 Fix 5 — "actual wall-clock behavior of the
  advisory-lock-based concurrency safety under real parallel load ... not
  executed against a live database."
- **Cost**: free (enhance-prompt has a deterministic fallback path — no LLM
  spend if `ANTHROPIC_API_KEY`/Groq aren't configured, and even if they are,
  this is one of the cheapest calls in the app).
- **Runtime**: ~30-90 seconds (includes waiting out the rate-limit window at
  the end).
- **Depends on**: not having called `enhance-prompt` in the last 60 seconds
  before running it (the script reminds you of this).

`RESULT: ______________`

### Check 5 — `node verify-credits.js`

- **Verifies**: reserve-before-render concurrency safety (two simultaneous
  requests at balance=1 — exactly one succeeds), refund-on-post-reservation-
  failure, and idempotent replay (same `request_id`+`request_slot` — no
  double-billing) — all against the REAL `generateImage` function.
- **Closes**: FIXLOG Week 3 Fix 0/Fix 2 — "real concurrent-load behavior
  ... not executed against a live Postgres+Deno environment," and the
  credit-leak bug found during Week 3 Phase 0 (callers never checked
  `deduct_credits`' `ok` field).
- **Cost**: **real** — approximately 5 fal.ai image generations
  (a few cents each). Gated behind a single `y/n` prompt at the start.
  Restores your original credit balance at the end regardless of outcome.
- **Runtime**: ~1-2 minutes.
- **Depends on**: a `user_credits` row already existing for `TEST_USER`
  (generate at least one image via the app first if you've never used this
  account).
- **Known limitation (read before running)**: Case B (refund-on-failure)
  needs something to reliably fail *after* credits are reserved. The script
  tries passing an invalid Recraft style, betting fal.ai's own validation
  rejects it — this is a best-effort trigger, not guaranteed. **If Case B
  reports `⏭️ SKIPPED` (the bogus style was unexpectedly accepted)**, use this
  manual fallback instead:
  1. Dashboard → Edge Functions → Secrets → temporarily change `FAL_API_KEY`
     to any invalid string.
  2. Re-run `node verify-credits.js`, answer `y` only when it reaches Case
     B's prompt (you can Ctrl+C after Case B finishes if you don't want to
     redo A/C — but the balance-restore step at the end only runs if the
     whole script completes, so **let it finish**, or manually reset the
     balance yourself afterward via the SQL Editor).
  3. Restore the real `FAL_API_KEY` value immediately after.

`RESULT: ______________`

### Check 6 — `node verify-video-jobs.js`

- **Verifies**: the entire async video mechanism against real fal.ai —
  webhook vs. poller completion timing, the full offline chain (generation
  → draft post), cancel (including the webhook/poller race-safety claim
  guard), and idempotent resubmission.
- **Closes**: FIXLOG Week 3 Fix 3's entire "Could not verify" list — fal.ai's
  actual webhook payload/timing, queue-cancel support, webhook/poller race
  safety, and whether the offline chain really works with zero clients.
- **Cost**: **real and the highest in this kit** — each case submits one
  real video (standard tier ~5 credits if `TEST_IMAGE_URL` is set in `.env`,
  else premium ~15 credits — the script tells you which before every case).
  All three cases are individually gated behind their own `y/n` prompt.
- **Runtime**: ~2-5 minutes per case you choose to run.
- **Depends on**: **A1** (Vault secret) and **A3** (job-webhook JWT
  setting). Note the dependency is asymmetric: `generateVideo`'s own submit
  path and `job-webhook` don't need Vault at all — only the `process-jobs`
  **poller's** cron-triggered `net.http_post` call needs the Vault secret to
  authenticate itself (same mechanism as `process-scheduled-posts`). So if
  A1 is missing, the webhook can still complete a job on its own, but you'd
  have no fallback if the webhook itself is broken (which is exactly what
  A3 checks) — do both A1 and A3 before this check so a failure here points
  at the actual video mechanism, not a missing prerequisite.
- **A CONFIRMED FINDING will print during Case A** (not a failure — read it
  carefully): metadata generation for the video's draft post will NOT have
  started within the ~2.5 minutes this script waits, because metadata
  kickoff is driven entirely by a browser client's realtime subscription or
  by opening the post's publish stage — neither happens here. This is
  real, current app behavior, confirmed by reading `SessionStore.js`
  directly — see "FINDING" callout below.

> **FINDING — FIXLOG Week 3 Fix 3's journey check (a) overstates the offline
> guarantee.** It says the draft-post-and-metadata chain "works with zero
> client tabs open." Re-reading `SessionStore.js` shows this is only true
> for the **draft post** (genuinely DB-trigger-owned, no client needed). The
> **metadata kickoff** (`scheduleDraftMetadataGeneration` →
> `generate-post-metadata`) is invoked ONLY from `subscribeToSession`'s
> realtime broadcast handler or from `hydratePostProductionFromGeneration`
> (opening the publish stage) — both require an actual browser client. A
> video that completes with zero browser tabs open anywhere will sit with
> `workflow_state.metadata_status` unset until a client next opens that
> post. This is not a crash or a data-loss bug — the post is still there,
> draft-complete, and metadata generates correctly the next time anyone
> opens it — but it is a real gap in the "fully offline, fully automatic"
> claim. **No code was changed to fix this** (out of scope for this
> verification pass) — flagging it here as the follow-up item it is: if
> truly-unattended metadata generation matters, `job-webhook`/`process-jobs`
> (server-side, no client needed) would need to call `generate-post-metadata`
> themselves after finalizing a completed generation, the same way they
> already finalize the generation itself.

`RESULT: ______________` (note which cases you ran and their individual
verdicts — this script's own output already gives you a per-case breakdown)

### Check 7 — `node verify-scheduled-publish.js`

- **Verifies**: the pre-existing (not touched by Week 3) scheduled-post
  pipeline end to end — `process_scheduled_posts` → `dispatch_scheduled_post`
  → `publish-post` → `runMockPublish`. This is the highest-value check for
  Week 3 Fix 3's decision NOT to duplicate this into the new
  `background_jobs` mechanism — if this is broken, that decision needs
  revisiting.
- **Closes**: FIXLOG Week 1 Fix 1 — "whether `vault.create_secret(...)` has
  actually been run in the live Supabase project ... if it hasn't,
  `dispatch_scheduled_post()` logs a warning and no-ops."
- **Cost**: free (a QA post scheduled 90 seconds out; optionally a temporary
  QA mock connected account, cleaned up automatically).
- **Runtime**: up to 4 minutes (polls every 10s).
- **Depends on**: **A1** (Vault secret) and **A2** (cron registered) — if
  either prerequisite is missing, this check fails and tells you which one
  to check first.

`RESULT: ______________`

### Check 8 — `node verify-metadata-reconcile.js`

- **Verifies (script-only half)**: `generate-post-metadata` has no "already
  in progress, refuse to run" guard — it always proceeds and can recover a
  post stuck at `metadata_status='in_progress'`, with or without a
  `metadata_started_at` timestamp (covering both the current row shape and
  pre-Week-2-Fix-3 rows that never had that field at all).
- **Closes**: FIXLOG Week 2 Fix 3 — "live timing of the 2-minute
  reconciliation window against a real network-drop scenario" (the
  server-side half of it — see Check 8's manual half below for the
  client-side half).
- **Cost**: free (real Claude/LLM call — same cost as any normal caption
  regeneration in the app, i.e. negligible).
- **Runtime**: ~10-20 seconds.
- **Depends on**: nothing.
- **The client-side half of stale-reconciliation is NOT covered by this
  script** (it's read-time logic in `hydratePostProductionFromGeneration`,
  which only runs in a browser) — see **Manual Check 8b** below.

`RESULT: ______________`

---

## PART C — MANUAL BROWSER PASS

Nothing below this line can be scripted — it needs an actual browser. Work
through each one and fill in the result.

### C1. Full generate → publish journey (golden path)

Generate an image (or carousel) in Studio → let it complete → open the
publish stage → confirm caption/title/SEO auto-populate → publish (mock) →
confirm it shows up in Library/Calendar as published.

`RESULT: ______________`

### C2. The three route-state handoffs (Week 1 Fix 3)

1. From Library, pick an asset → "Use this asset" → confirm the Studio
   prompt is seeded with that asset's context.
2. From a saved template → confirm the prompt seeds from the template.
3. From Library/Calendar, click "Edit" on an existing post → confirm Studio
   switches to Edit mode with the source image and caption pre-filled.

`RESULT: ______________` (one line per handoff)

### C3. Draft-prompt save/restore across a tab close (Week 2 Addendum 4)

Type a prompt (don't generate), click "Save as draft without generating,"
close the tab entirely, reopen the app, resume that session from the
history drawer → confirm the prompt (and settings, e.g. carousel slide
count if you set one) restore exactly as typed.

`RESULT: ______________`

### C4. Enhance-prompt button — EXPECTED TO FAIL

Click "Enhance prompt" in Studio on a real prompt. **This is expected to
NOT actually apply the enhanced text to the textarea** — Week 1 Fix 2 found
(and left, as out-of-scope for that auth-focused fix) that
`StudioPage.jsx`'s `handleEnhance` reads `result?.enhanced`, but the store's
`enhancePrompt` action returns `{ enhancedPrompt, suggestions }` — no
`enhanced` key. Confirm this is still the case (i.e., the bug was never
silently fixed elsewhere) — the point of this check is verifying the FAILURE
mode is exactly this one, not some other break.

`RESULT: ______________` (confirm: prompt unchanged after clicking Enhance,
no error shown, matches the known bug / OR: something different happened —
describe it, since that would mean either the bug was fixed, or a NEW bug)

### C5. Video Jobs drawer survives a hard refresh mid-job

Submit a video (any tier), immediately hard-refresh the page (or close and
reopen the tab) before it completes → open the Video Jobs drawer → confirm
the job is still listed with a real, correct status (not lost) → wait for
it to complete → confirm the drawer updates live without another refresh.

`RESULT: ______________`

### C6. Rate-limit countdown renders on a real 429

Click "Enhance prompt" (or any rate-limited button) rapidly enough to
actually trigger a 429 in the browser (11+ times within 60s) → confirm the
button shows a live "Retry in Ns" countdown (not a generic error) and
re-enables itself once the countdown reaches 0.

`RESULT: ______________`

### C7. Check 8b — client-side stale-metadata reconciliation UI

Using one of the QA posts from Check 8 (if you didn't let the script clean
them up — rerun Check 8 and Ctrl+C before its cleanup step if needed, or
create a new stuck row directly via the SQL Editor matching the shape in
`verify-metadata-reconcile.js`), open that post's publish stage in the
browser → confirm the UI shows "failed"/regenerable (a muted "—", not a
fake `0`, with a "Last attempt failed — try again" hint) rather than stuck
on a spinner forever → click Regenerate → confirm it completes normally.

`RESULT: ______________`

---

## RESULTS TEMPLATE

Copy everything below this line, fill in every blank, and paste it back.

```
=== PART A — PREREQUISITES ===
A1 (Vault secret):                    PASS / FAIL / NOTES: ___________
A2 (cron jobs registered):            PASS / FAIL / NOTES: ___________
A3 (job-webhook JWT off):             PASS / FAIL / NOTES: ___________
A4 (publication membership, optional): DONE / SKIPPED / NOTES: ___________

=== PART B — SCRIPTED CHECKS ===
Check 1  (verify-realtime-payload):      PASS / FAIL / NOTES: ___________
Check 2  (verify-realtime-authz):        PASS / FAIL / NOTES: ___________
Check 3  (verify-trigger-ownership):     PASS / FAIL / NOTES: ___________
Check 4  (verify-rate-limit):            PASS / FAIL / NOTES: ___________
Check 5  (verify-credits):               PASS / FAIL / SKIPPED / NOTES: ___________
Check 6  (verify-video-jobs) — Case A:   PASS / FAIL / SKIPPED / NOTES: ___________
Check 6  (verify-video-jobs) — Case B:   PASS / FAIL / SKIPPED / NOTES: ___________
Check 6  (verify-video-jobs) — Case C:   PASS / FAIL / SKIPPED / NOTES: ___________
Check 7  (verify-scheduled-publish):     PASS / FAIL / NOTES: ___________
Check 8  (verify-metadata-reconcile):    PASS / FAIL / NOTES: ___________

=== PART C — MANUAL BROWSER PASS ===
C1 (golden path):                        PASS / FAIL / NOTES: ___________
C2 (three route-state handoffs):         PASS / FAIL / NOTES: ___________
C3 (draft-prompt save/restore):          PASS / FAIL / NOTES: ___________
C4 (enhance-prompt — expected fail):     MATCHES KNOWN BUG / DIFFERENT / NOTES: ___________
C5 (video drawer survives refresh):      PASS / FAIL / NOTES: ___________
C6 (rate-limit countdown UI):            PASS / FAIL / NOTES: ___________
C7 (stale-metadata UI, manual half):     PASS / FAIL / NOTES: ___________

=== FINDINGS CONFIRMED DURING THIS PASS ===
(list anything the scripts' own output flagged as a FINDING, e.g. the
offline-metadata-kickoff gap from Check 6 — copy the relevant script output)
```
