# Phase 2 — composer. Handoff for a fresh session.

Written 2026-09-15, at the end of the session that completed Phase 0 and Phase 1.
Read this with [`LIBRARY-PUBLISH-IMPLEMENTATION-PLAN.md`](LIBRARY-PUBLISH-IMPLEMENTATION-PLAN.md) and [`PLATFORM-PUBLISH-FIELDS.md`](PLATFORM-PUBLISH-FIELDS.md).

---

## Start here: four findings that constrain everything below

These were discovered by reading the code, not assumed. Each one invalidated something the mockup or the plan originally said. **Do not re-derive them; do check them if you change the area they describe.**

### 1. There is no "publish now" path. Publishing is asynchronous.

`publish-post` has exactly one caller: the database cron worker.

```
cron 'process-scheduled-posts'   '* * * * *'
  → process_scheduled_posts()        (20260710140000_create_process_scheduled_posts.sql)
     WHERE status = 'scheduled' AND scheduled_at <= now()
     marks the row publishing immediately (duplicate-dispatch guard)
     LIMIT 50 per run
```

Nothing client-side can invoke the publisher. **"Publish now" must mean `scheduled_at = now()`**, picked up within a minute by the worker that is already proven in production. Do not build a second publish endpoint — it would duplicate the dispatch guard, the auth surface and the idempotency problem.

**Consequence, already reflected in the mockup:** the UI may not say "Published". It says *going out now*, and confirmation waits for the post's status to move. Asserting success at click time is the 2026-09-11 defect.

### 2. LinkedIn takes images, not video.

`_shared/linkedin.service.ts` implements `uploadImage()` and nothing else — there is no video upload path. The `library-v3` mockup claimed image *and* video and was wrong. Encoded correctly now in `platformCaptionSpecs.js` → `acceptsMedia`.

### 3. A CSS custom property with a fallback never errors.

Six `--uiv2-*` tokens were referenced and defined nowhere, each with a hardcoded dark fallback, so the TikTok and YouTube options panels painted near-black on a light page. Guarded now by `check:uiv2-tokens`. **If you add a token usage, the token must exist** — do not "fix" a failure by adding a fallback.

### 4. A guard can be aimed at dead code and pass forever.

`check-video-prefs-contract` verified a form no route could reach. When you add a guard, verify it fails: break the thing deliberately, watch it exit 1, restore. Every guard added this session was verified that way.

---

## What Phase 2 has to do

Open the existing composer from the Library with the asset and its generation attached, collect what each platform genuinely requires, and queue the send.

**Extend `QuickPostComposer`. Do not fork it.** Two composers means one of them rots.

### File by file

| File | Change |
|---|---|
| `src/calendar/components/QuickPostComposer.jsx` | `onSubmit` gains a third mode beside `draft` and `schedule` — call it `publish`. Its props are already clean for reuse (`open`, `prefillAsset`, `libraryAssets`, `onClose`, `onSubmit`); the parent owns submission, so the Library can mount it unchanged in every other respect. |
| `src/calendar/services/calendarService.js` | The insert around `:405-440` already writes `status`, `scheduled_at`, `generation_id`, `title: asset?.name`, and YouTube's `workflow_state.youtube.made_for_kids`. `publish` mode = `status: 'scheduled'`, `scheduled_at: new Date().toISOString()`. Carry `ai_disclosure` into `workflow_state` the same way made-for-kids already travels. |
| `src/pages/Calendar/CalendarPage.jsx` | Its `onSubmit` handler routes the new mode. The `?quickPost=1&prefillAssetId=&prefillGenerationId=` hand-off at `:226-266` already works and needs no change. |
| `src/pages/Library/LibraryPage.jsx` | Mount the composer. `handleSchedule` currently navigates away; a Publish action should open it in place. `derivePublishability()` already tells you whether to enable it — use `canPublish` / `canOpenComposer`, do not re-derive. |
| `supabase/functions/_shared/youtube.service.ts` | Reads `status.containsSyntheticMedia` already (`:276`). Feed it from `workflow_state`. |

### The AI-disclosure value

Stored at `user_settings.generation_defaults.ai_disclosure`, defaulting **true**. Settings UI is built (`ContentDefaultsTab`). **Nothing reads it yet** — that is Phase 2's job.

It is a fact about the asset, decided once, carried to every destination. Maps to YouTube `status.containsSyntheticMedia` and Instagram `is_ai_generated`. The composer offers a per-post override (already in the mockup); the default comes from settings.

---

## How to verify

Run these. All pass today, on `feat/direct-social-publishing`.

```
node scripts/test/publishability.test.mjs          # 46 checks, 432 generated cases
node scripts/check-uiv2-token-definitions.cjs
UI_CONSISTENCY_STRICT_PATHS=src node scripts/check-ui-consistency.cjs
node scripts/check-media-required-guard.cjs
npm run build
```

`check-ui-consistency` enforces the **whole `src/` tree**. If it fails, it found something real — fix the finding, do not narrow the path list.

**Phase 2's own guard**, per the plan: a contract test asserting no required platform field is dropped between composer and adapter. In particular that YouTube receives a title and TikTok receives `SELF_ONLY`, and that neither is silently defaulted.

---

## Environment notes

- **Docker Desktop is currently broken on this machine** — its engine 500s on every call, including `docker version`. Deploy edge functions with `supabase functions deploy <name> --use-api`, which bundles through the Management API and needs no Docker. CLI is 2.54.11; 2.117.0 is available.
- `personal-asset-upload` **is deployed** with the clip-provenance change (2026-09-15).
- Disk runs near-full (~14 GiB free of 224). ENOSPC can masquerade as a Turbopack panic.
- The repo's GateGuard hook demands importers/API/schema facts before a first Write or Edit to any file, and before the first Bash call of a session.

---

## Still open, needing a human

| Question | Blocks |
|---|---|
| Should the liability wording live in the Terms of Service rather than only a settings pane? A disclaimer in Settings is weaker than the same term in the ToS, and this one is legal-adjacent. | Nothing technically; worth a lawyer's eye before launch. |
| TikTok content audit and YouTube compliance review are both unsubmitted, so TikTok is `SELF_ONLY` and every YouTube upload locks private. | Phase 7, and what the composer can honestly promise. |
| TikTok domain `brandosse1.vercel.app` is verified, so photo posts are structurally possible — but they are pull-from-URL only, and our media lives in Supabase storage. A proxy route on the verified domain would be needed. | TikTok image publishing. |

---

## What is done, so you do not redo it

Phase 0 (design-system consistency) and Phase 1 (the two gates, clips as a first-class source) are complete and committed — fourteen commits on `feat/direct-social-publishing`, nothing pushed. `check-ui-consistency` went from 254 findings that reported and passed anyway, to zero enforceable findings across the whole tree.
