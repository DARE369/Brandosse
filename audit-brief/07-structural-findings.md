# Phase 0 — Structural Findings (Week 3)

All findings below are quoted from the actual repo state as of this pass (post Week 1/2 + Addendum). No code was changed while gathering these.

## 0.1 — Trigger bodies vs. client duplicates

### `ensure_draft_post_for_generation()` (`supabase/migrations/20260227103000_generation_post_unification_and_rls.sql:85-127`)

```sql
CREATE OR REPLACE FUNCTION public.ensure_draft_post_for_generation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.user_id = NEW.user_id AND p.generation_id = NEW.id AND p.status = 'draft'
  ) THEN
    INSERT INTO public.posts (user_id, generation_id, account_id, caption, scheduled_at, status, created_at)
    VALUES (NEW.user_id, NEW.id, NULL, coalesce(NEW.prompt, ''), NULL, 'draft', coalesce(NEW.created_at, now()));
  END IF;
  RETURN NEW;
END; $$;
```
Triggers:
```sql
CREATE TRIGGER generations_to_draft_post_insert AFTER INSERT ON public.generations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_draft_post_for_generation();
CREATE TRIGGER generations_to_draft_post_update AFTER UPDATE OF status ON public.generations
  FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION public.ensure_draft_post_for_generation();
```

**Idempotency**: existence-check-then-INSERT, not `ON CONFLICT`. Backstopped by the partial unique index `idx_posts_unique_draft_per_generation_account` (`status='draft' AND generation_id IS NOT NULL`), but a race between the check and the insert would raise a raw `23505` up through the trigger into whatever transaction fired it (the generation's own INSERT/UPDATE) — that transaction would abort. **Hardening needed**: convert to `INSERT ... ON CONFLICT (user_id, generation_id, coalesce(account_id,...)) WHERE status='draft' DO NOTHING` so the trigger itself can never raise on a race, matching the "ON CONFLICT DO NOTHING" pattern the library trigger already uses.

**Insert-time-completed rows (video path) ARE already covered**: `generations_to_draft_post_insert` has no `WHEN` clause — it fires unconditionally on every INSERT, and the function body itself checks `NEW.status <> 'completed'`. So a row born already `'completed'` (as today's synchronous video path creates) enters the function and creates a draft correctly. This was flagged in the batch brief as an open question; verified **not a bug** — no fix needed here.

**What the trigger does NOT do that the client's `ensureDraftForGeneration` does today**:
- `ensureDraftForGeneration` (`src/stores/SessionStore.js:645-686`) inserts its OWN row on top of (or racing with) the trigger's row when none exists yet, using nearly identical fields (`title`, `hashtags: []`, `workflow_state: {metadata_status:'in_progress', metadata_updated_at}` — fields the trigger's INSERT never sets at all).
- It then calls `ensureLibraryRowsForPosts([...])` (pure redundancy — see below).
- It calls `scheduleDraftMetadataGeneration(post)` — **this is the one thing the trigger cannot do** (kicking off an LLM call is not something a Postgres trigger should do). This is the load-bearing responsibility that must be relocated, not deleted.
- It performs no org-scope write itself; org scope is applied via the separate `apply_generation_org_scope_to_post` BEFORE trigger on the same INSERT it performs (see 0.1 org-scope section).

### `create_library_item_from_post()` (`20260227090000_calendar_library_alignment.sql:246-254`)
```sql
CREATE OR REPLACE FUNCTION public.create_library_item_from_post() RETURNS trigger AS $$
BEGIN
  INSERT INTO public.content_library_items (user_id, post_id, item_type, created_at)
  VALUES (NEW.user_id, NEW.id, 'post', COALESCE(NEW.created_at, now()))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
-- AFTER INSERT ON public.posts, FOR EACH ROW
```
Already idempotent (`ON CONFLICT DO NOTHING`) and fires on **every** post insert unconditionally, regardless of status. The client's `ensureLibraryRowsForPosts` (`src/services/contentLibraryService.js:24-56`) — called from 6 sites in `SessionStore.js` (`ensureDraftForGeneration:683`, `preparePostForApproval:2474,2492`, `saveDraft:2587,2605`, `publishContent:2780`) — does a read-then-conditional-insert of the exact same row shape. **This is pure redundancy with zero unique value**: any code path that inserts a post row already gets its library row from the trigger, synchronously, in the same transaction, before the client's own insert call even returns. Confirmed via codebase search: no other library-item shape or field is written by the client version that the trigger version omits. **In scope for full removal**, all 6 call sites.

### `lock_terminal_posts()` (`20260227090000_calendar_library_alignment.sql:221-237`)
Blocks `UPDATE` away from `published`/`publishing` (except to `failed`), stamps `updated_at`, and sets `is_locked`. Read in full — no interaction with draft/library creation; unaffected by this batch except that any client 23505 recovery added around `posts` inserts must still respect this guard on the subsequent re-fetch/update path (it already does, since re-fetching an existing row and updating it through the normal `saveDraft`/`preparePostForApproval` logic already runs through `assertPostStatusTransition` before hitting this trigger).

### Org scope: two triggers, two directions (`20260324170000_org_helper_functions.sql:93-178`)
```sql
CREATE OR REPLACE FUNCTION public.apply_generation_org_scope_to_post() RETURNS trigger ... AS $$
BEGIN
  IF NEW.generation_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.organization_id IS NOT NULL AND NEW.brand_project_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_generation FROM public.generations WHERE id = NEW.generation_id LIMIT 1;
  IF FOUND THEN
    NEW.organization_id := coalesce(NEW.organization_id, v_generation.organization_id);
    NEW.brand_project_id := coalesce(NEW.brand_project_id, v_generation.brand_project_id);
  END IF;
  RETURN NEW;
END; $$;
-- trigger: set_posts_org_scope_from_generation, BEFORE INSERT OR UPDATE ON posts
```
```sql
CREATE OR REPLACE FUNCTION public.sync_generation_org_scope_to_posts() RETURNS trigger ... AS $$
BEGIN
  UPDATE public.posts SET
    organization_id = coalesce(organization_id, NEW.organization_id),
    brand_project_id = coalesce(brand_project_id, NEW.brand_project_id)
  WHERE generation_id = NEW.id
    AND (organization_id IS DISTINCT FROM NEW.organization_id OR brand_project_id IS DISTINCT FROM NEW.brand_project_id);
  RETURN NEW;
END; $$;
-- trigger: zz_sync_generation_org_scope_to_posts, AFTER INSERT OR UPDATE OF organization_id, brand_project_id ON generations
```
Two distinct, non-overlapping directions: **post-side** (`apply_generation_org_scope_to_post`, fires when a post row itself is written, reads its parent generation's scope) and **generation-side propagation to already-existing posts** (`sync_generation_org_scope_to_posts`, fires when a generation's own scope changes, pushes to any posts already pointing at it). Neither ever writes `generations.organization_id`/`brand_project_id` themselves — nothing in the DB sets scope ON the generation row.

**Client's `syncOrgScopeToGenerations` (`SessionStore.js:459-478`)**:
```js
async function syncOrgScopeToGenerations(generationIds = []) {
  ...
  await supabase.from('generations').update(orgScope).in('id', normalizedIds);   // writes generation-side scope
  await supabase.from('posts').update(orgScope).in('generation_id', normalizedIds); // writes post-side scope directly
}
```
This is the **only** writer of `generations.organization_id/brand_project_id` anywhere in the system (DB triggers never write it) — **load-bearing, must be kept**. Its second statement (writing `posts` directly) is **redundant** with `zz_sync_generation_org_scope_to_posts`, which fires automatically the moment the first statement (the `generations` UPDATE) commits, and does the identical `coalesce(...)` merge. Decision: keep the client function but delete its second (posts) UPDATE — the generations-side write is the one thing nothing else does; the posts-side propagation already happens automatically via the trigger the instant the first write lands.

**Final ownership map** (see Fix 1 for the implementation):
| Invariant | Writer | Trigger that also participates |
|---|---|---|
| `posts` row exists for a completed generation | DB trigger (`ensure_draft_post_for_generation`) | client no longer inserts |
| `content_library_items` row for a post | DB trigger (`create_library_item_from_post`) | client never writes this at all after Fix 1 |
| `posts.organization_id/brand_project_id` (from a post write) | DB trigger (`apply_generation_org_scope_to_post`, BEFORE INSERT/UPDATE) | — |
| `posts.organization_id/brand_project_id` (propagated from generation) | DB trigger (`sync_generation_org_scope_to_posts`, AFTER UPDATE on generations) | — |
| `generations.organization_id/brand_project_id` | Client (`syncOrgScopeToGenerations`, generations statement only) | nothing else writes this |
| `workflow_state.metadata_status`/content fields | Edge function (`generate-post-metadata`, since Week 2 Fix 3) | client only reads |
| `posts.seo_state`/`workflow_state.seo_status` | Edge functions (`seo-score`/`optimize-seo`, since Week 2 Fix 4) | client only reads |

## 0.2 — `deduct_credits` atomicity (verified — see `20260706120000_credit_category_tracking.sql:22-57`, supersedes `20260622000001_deduct_credits_rpc.sql`)

```sql
CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id UUID, p_amount INT, p_category TEXT DEFAULT NULL, p_description TEXT DEFAULT NULL)
RETURNS TABLE(new_balance INT, ok BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new_balance INT;
BEGIN
  UPDATE public.user_credits
  SET balance = balance - p_amount, lifetime_consumed = lifetime_consumed + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND balance >= p_amount
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT COALESCE((SELECT uc.balance FROM public.user_credits uc WHERE uc.user_id = p_user_id), 0)::INT, FALSE;
  ELSE
    INSERT INTO public.credit_transactions (user_id, amount, balance_after, transaction_type, category, description)
    VALUES (p_user_id, -p_amount, v_new_balance, 'consumption', p_category, p_description);
    RETURN QUERY SELECT v_new_balance, TRUE;
  END IF;
END; $$;
```

**Verdict: `deduct_credits` itself is already correctly atomic.** Single `UPDATE ... SET balance = balance - p_amount WHERE balance >= p_amount RETURNING` — this is exactly the atomic compare-and-set pattern the batch brief asks to verify/build. Row-level locking on `user_credits` serializes two concurrent callers for the same `user_id`: the second UPDATE blocks until the first's transaction commits, then re-evaluates `balance >= p_amount` against the *new* balance — so **two concurrent generations at balance=1 (each requesting 1 credit) cannot both succeed**; the second gets `ok=false` with the real post-deduction balance. The `credit_transactions` insert happens in the same function invocation as the balance update, so it's transactionally atomic with it (whatever calls `deduct_credits` — an edge function's request — either does both or neither, since Postgres functions run inside the calling statement's transaction unless it explicitly commits mid-function, which this doesn't).

**Fix 0 is NOT needed** — `deduct_credits` was already hardened correctly, likely before this batch (no changelog entry found for it in Weeks 1-2, so it may predate the whole audit).

**Real, separate bug found while verifying this (in scope for Fix 2, not Fix 0)**: none of the three callers (`generateImage/index.ts:233-238`, `editImage/index.ts` equivalent, `generateVideo/index.ts:189-194`) **check the RPC's `ok`/`new_balance` return value at all** — `await adminClient.rpc("deduct_credits", {...})` discards the result entirely. Combined with the fact that each function does its own advisory `currentCredits < CREDITS_NEEDED` check *before* doing the (slow, expensive) generation work — not atomically reserving the credit — this reopens exactly the race the atomic function was built to prevent: two concurrent requests at balance=1 can both pass the early advisory check, both do the full expensive generation + storage upload + `generations` INSERT, and then both call `deduct_credits` — one gets `ok:true` (balance now correctly at 0), the other gets `ok:false` back, **but the code doesn't look at that value, so the second request still returns HTTP 200 with a fully generated, uncharged image.** This is a real credit-leak vulnerability under concurrency, not a false alarm — fixed as part of Fix 2 (see below): call `deduct_credits` *before* the expensive work (reserve-then-generate) and throw a 402 if `ok === false`.

## 0.3 — Scheduler/cron verdict: **A REAL, WORKING PROMOTER ALREADY EXISTS**

This directly overturns the batch brief's premise ("Fix 3 ... Separately, week 1 likely confirmed ... that scheduled posts have no promoter"). Week 1's own FIXLOG already found and documented this; re-verified here directly against the migrations:

- `process_scheduled_posts()` (`20260710140000_create_process_scheduled_posts.sql:15-77`): scans `posts WHERE status='scheduled' AND scheduled_at <= now()` (joined to a matching active `connected_accounts` row), atomically claims each row via `UPDATE posts SET status='publishing' WHERE id=... AND status='scheduled'` (only proceeds if `FOUND`, i.e. a genuine compare-and-set race guard identical in spirit to `deduct_credits`'s pattern), then calls `dispatch_scheduled_post(...)`.
- `dispatch_scheduled_post()` (`20260710120000_vault_based_cron_secrets.sql:37-76`) reads the service-role key from **Supabase Vault** (not a GUC — this project cannot use `ALTER DATABASE ... SET app.*`, confirmed by that migration's own header) and does `net.http_post` to the `publish-post` edge function with a `Bearer` service-role token.
- Both **`pg_cron`** and **`pg_net`** are confirmed already installed and in active use in this project (`pg_cron` schedules `process-scheduled-posts` every minute; `pg_net` performs the HTTP callout) — re-verified directly in `20260710120000_vault_based_cron_secrets.sql:85-100` (`RAISE EXCEPTION` guard if either extension is missing, meaning the migration itself assumes/requires them present, and per Week 1's FIXLOG this migration was applied). **This settles Fix 3's "exhaust in-repo options before documenting a manual dashboard step" instruction: `pg_cron`/`pg_net` are already the in-repo mechanism, already proven to work for this exact "promote due rows" pattern.**
- `publish-post/index.ts` routes `account.is_mock` to `runMockPublish` and non-mock accounts to `publishToRealPlatform`, updating `posts.status/published_at/failed_at/external_post_id/error_message` and `workflow_state.publish.*` (retry_count, platform_post_url) — real publish-tracking columns already exist and are already used (`publish-post/index.ts:179-234`).
- **One manual, non-migratable step remains** (documented by Week 1, re-confirmed unchanged here): `vault.create_secret('service_role_key', ...)` must be run once, live, in the Supabase SQL editor. Until then `dispatch_scheduled_post` logs a warning and no-ops (posts stay stuck in `scheduled` — never silently mis-published) — this is an ops gap, not a code gap, and no migration can close it (Vault secrets are per-project state, not schema).

**Decision for Fix 3 (documented here, applied there)**: Do **not** build a second, parallel `background_jobs`-based `scheduled_publish` mechanism. A real one already exists, is idempotent (status-guarded claim), reuses the project's actual `pg_cron`/`pg_net` infrastructure, and already writes the correct tracking columns. Building a second scheduler for the same invariant (which post gets published, when) would recreate exactly the "two writers per invariant" anti-pattern this entire batch exists to eliminate elsewhere (Fix 1). Fix 3 in this batch is scoped to **video only** — the one piece that is genuinely still fake-async today (see 0.5/Fix 3 below).

## 0.4 — `mock_publish_logs` DDL + `_shared/mockPublish.ts` idempotency shape

`mock_publish_logs` gained `publish_request_id text` + a non-unique index `(publish_request_id, post_id, connected_account_id)` via `20260330110000_mock_publish_idempotency.sql`. **Important nuance**: this column is NOT enforced as unique — `publish_request_id` is written into every log row (success or failure) purely as an audit/correlation field. The actual idempotency guarantee for scheduled/mock publishing comes from two other places, not from this column:
1. `process_scheduled_posts()`'s atomic claim (`UPDATE ... WHERE status='scheduled'`, only one caller ever sees `FOUND`).
2. `publish-post/index.ts:120-122`'s explicit guard: `if (post.status === "published") return jsonResponse({ success: true, message: "Post already published", postId });` — a second dispatch for an already-published post is a safe no-op.

`runMockPublish` (`_shared/mockPublish.ts:26-204`) writes, in one function call: a `mock_publish_logs` row (success or failure shape, including the passed-through `publish_request_id`), then `posts.status/published_at/platform/account_id` (success) or `posts.status='failed'` (failure), then `connected_accounts` health/failure-count fields, then a `connection_events` row. **This is the idempotency pattern Fix 3's video job finalizer should mirror**: one row logged per attempt (audit trail keyed by a request id, not uniquely constrained) + status-guarded state transition on the parent entity (here `posts.status`; for video jobs, `background_jobs.status`) as the actual concurrency-safety mechanism, not a DB unique constraint on the request id itself.

## 0.5 — `record_generation: true` callers: **NONE — confirmed dead branch**

Grepped every caller of `generateImage`/`editImage`/`generateVideo` in `src/**`. All three client call sites in `src/services/media.service.js` explicitly pass `record_generation: false` (lines 152, 199, 243) and no code anywhere in the repo passes `record_generation: true` or omits it. **The `if (body.record_generation !== false)` branch in all three edge functions (`generateImage/index.ts:202-231`, `generateVideo/index.ts:160-187`, and the equivalent in `editImage/index.ts`) is unreachable in production and always evaluates false.** In scope for deletion in Fix 2 (the functions should simply never insert a `generations` row themselves — see Fix 2's design, which changes generation-row lifecycle ownership anyway as part of the idempotency work).

## Additional Phase-0-adjacent findings (surfaced while tracing consumers, documented here since they directly gate Fix 2/3 design)

- **Cancel is 100% cosmetic today** for image/carousel/edit generation (`StudioPage.jsx:367-381`, its own comment says so explicitly: *"Sync modes ... have no server-side abort available ... does not stop the request or refund credits"*). No `AbortController`/`signal` plumbing exists anywhere in `media.service.js`'s `invokeFunction`. Video's "cancel" (`dismissVideoJob`) only clears client state; the edge function invocation (which blocks synchronously on fal.ai's queue for up to 3–5 minutes) keeps running server-side regardless.
- **Carousel already isolates per-slide failures** (`generationPipeline.js: runCarouselOrchestration`, lines ~294-321) — each slide's `generateImage` call has its own `try/catch`, failures are written as `FAILED` and the loop continues; but there is still no UI banner surfacing "N of M slides succeeded" anywhere (`startCarouselGeneration` silently skips failed slides when creating drafts, sets `error: null` unconditionally).
- **The plain image batch loop (`startGeneration`, `SessionStore.js:1316-1350`) has NO per-iteration isolation** — a single variant failure throws out of the whole loop via `runSingleGeneration`'s re-throw, aborting all remaining variants. This is the gap Fix 2's batch-isolation work must close, using the carousel path's already-proven pattern.
- **Video generation is already asynchronous against fal.ai** (`_shared/fal.service.ts`: `generateVideoHailuo`/`generateVideoKling`/`generateVideoKlingI2V` all use `queueSubmit` + `queuePoll`, never `fal.run` sync) — but the edge function blocks on `queuePoll` internally before returning, and the client's single `supabase.functions.invoke` call blocks for the full 3–5 minutes. This is precisely "a synchronous await dressed up as a background job" — fal.ai's own async queue primitives are already being used, just not exposed as submit-and-return to the client. Fix 3's job mechanism can reuse `queueSubmit`'s request id directly instead of needing new fal-side plumbing.
- **`subscribeToSession`'s realtime handler already updates video job status from broadcasts** (`SessionStore.js:2985-3022`) — the `pollInterval`-clearing calls inside it are inert (no interval is ever created), but the state-transition logic (marking a video job completed/failed from a realtime `UPDATE`) already executes correctly today. Only the interval-based polling half is dead; the broadcast-driven half already works and will be reused/extended by Fix 3, not rebuilt.
- **`groqClient.js`'s `callWithFailover`/`callProvider` are module-private**, reachable only via `enhancePromptWithBrand` (fully dead — zero callers anywhere) and `callGroqVisionJSON` (has a live caller, but in the unrelated Calendar batch-scheduling feature, not Generate/Studio). In scope: delete `enhancePromptWithBrand` only; `callGroqVisionJSON`/`callWithFailover`/`callProvider` must stay since Calendar still uses that chain.
- **`generate-caption` edge function has a live caller**: `SessionStore.js`'s `generateCaption` action (line ~1939) is real, current, and used — NOT the dead legacy path Week 1 Fix 2 found for a *different* function (`ApiService.js`'s mock text response). Do not delete `generate-caption` or its store action.

---
*Findings feed Fix 0 (skipped, verified unnecessary), Fix 1, Fix 2, and Fix 3 below.*
