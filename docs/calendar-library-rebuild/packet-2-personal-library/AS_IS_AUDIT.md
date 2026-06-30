# AS-IS Audit — Packet 2: Personal Content Library

Auditor: `docs-auditor`
Date: 2026-06-25
Packet: `docs/calendar-library-rebuild/PACKET_2_PERSONAL_LIBRARY.md`
Specs compared against: `docs/LIBRARY_SPEC.md`, `docs/PERSONAL_WORKSPACE_SPEC.md` §5.4, `docs/ORG_WORKSPACE_SPEC.md` §3 (for the org reference architecture only)

Scope rule observed: no file under `src/**`, `supabase/**`, or any production code was created, edited, or deleted. This is a read-only audit. Generate Studio / AI Studio files (`SessionStore.js`) were read only to the extent needed to trace `ensureLibraryRowsForPosts()` call sites and the `saveDraft()`/`preparePostForApproval()` write shape — not analyzed or critiqued further, per Master Brief §0 rule 2.

---

## 0. Headline finding — `LIBRARY_SPEC.md` §0/§13.1, resolved with certainty

**`ensureLibraryRowsForPosts()` does not write to any `assets` table — personal or otherwise. It writes to `public.content_library_items`, a thin junction/index table, and no personal-scoped `assets` table exists anywhere in the codebase or migration history today.**

Proof, read directly from source (not inferred from the spec's description):

```js
// src/services/contentLibraryService.js:24-56
export async function ensureLibraryRowsForPosts(rows = []) {
  const payload = normalizeLibraryPostPayload(rows);   // { user_id, post_id, item_type: 'post' }
  ...
  const { data: existingRows, error: existingError } = await supabase
    .from('content_library_items')
    .select('post_id')
    .in('post_id', postIds);
  ...
  const { error: insertError } = await supabase
    .from('content_library_items')
    .insert(rowsToInsert);
  ...
}
```

This is the entire function. It takes `{ id, user_id }` pairs for `posts` rows, checks `content_library_items` for an existing row with that `post_id`, and inserts `{ user_id, post_id, item_type: 'post' }` if missing. **It does not write captions, media URLs, tags, status, or any descriptive/technical metadata of any kind.** It is purely a "this post now also appears in the library index" marker row.

`content_library_items` itself, defined in `supabase/migrations/20260227090000_calendar_library_alignment.sql:77-124`, is a junction table, not a content table:

```sql
CREATE TABLE IF NOT EXISTS public.content_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.content_templates(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  tags text[] DEFAULT '{}',
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
...
ALTER TABLE public.content_library_items
  ADD CONSTRAINT content_library_items_one_reference_only CHECK (
    (post_id IS NOT NULL)::int +
    (media_asset_id IS NOT NULL)::int +
    (template_id IS NOT NULL)::int = 1
  );
```

The `CHECK` constraint (line 117-121) proves the design intent explicitly: every row points at **exactly one** of `posts`, `media_assets`, or `content_templates` — `content_library_items` itself carries no descriptive metadata (no title/description/alt_text/dimensions/checksum/status/approval fields). The actual content lives on whichever of those three tables the row points to; `content_library_items` is an index/favorites/tags overlay on top of them, not the asset record itself. The same migration also installs two `AFTER INSERT` triggers (`create_library_item_from_post` at line 246, `create_library_item_from_media` at line 256) that do exactly what `ensureLibraryRowsForPosts()` does from the client side — meaning today there are **two independent code paths writing the same junction rows**: a client-side JS helper called explicitly after certain `posts` writes, and a database trigger that fires on every `posts`/`media_assets` insert regardless of whether the client remembered to call the JS helper. Both are idempotent (`ON CONFLICT DO NOTHING` in the trigger; existing-row check + `23505`-swallow in the JS function), so they don't conflict, but it does mean `ensureLibraryRowsForPosts()` is, in practice, partially redundant with a trigger that already fires automatically — worth flagging for Phase 1, not something this audit resolves.

**Is there a personal-scoped `assets` table that simply isn't documented elsewhere, per the first half of §13.1's question?** No. Confirmed by:
- Grepping all of `supabase/migrations/**` for `CREATE TABLE` statements with "assets" in the name: the only hits are `public.brand_assets` (brand kit logo/asset references, `20260220041938_brand_kit.sql:69` — unrelated, scoped to Brand Kit, not Library) and `public.media_assets` (`20260227090000_calendar_library_alignment.sql:39` — see below).
- Grepping all of `src/**` for `.from('assets')` / `.from("assets")`: zero matches. No code anywhere queries a table literally named `assets`.
- The personal-scope table that *functions* as a raw-upload store is `public.media_assets` (`20260227090000_calendar_library_alignment.sql:39-59`): `id, user_id, storage_path, storage_bucket, public_url, file_name, file_type, mime_type, file_size_bytes, duration_seconds, width, height, aspect_ratio, thumbnail_url, source, content_pillar_id, platform_targets, created_at, deleted_at`. This is real, RLS-enabled (`user_id = auth.uid()`, line 131-135), and already written to by `LibraryStore.uploadMediaAsset()` (`src/stores/LibraryStore.js:314-426`). But it is **far thinner** than `LIBRARY_SPEC.md` §2.1's `assets` schema: no `description`, `tags` (present but unused by any UI), `ai_tags`, `alt_text`, `checksum`, `status`/approval substate, `uploaded_by`/`approved_by`/`approved_at`, `used_in_post_ids`, or `superseded_by_asset_id`. It is a media-upload record, not the unified-source-taxonomy asset record LIBRARY_SPEC.md §1/§2.1 describes.

**Does the org side already have a real `assets` table, as LIBRARY_SPEC.md §0 claims?** Functionally yes, but the literal table name is **`org_asset_library`**, not `assets` (confirmed via `supabase/migrations/20260324130000_org_asset_library_table.sql:1`; `ORG_WORKSPACE_SPEC.md`'s own example query in the companion spec — `supabase.from('assets')...` — does not match any real query anywhere in `src/org/services/**`, which all call `.from('org_asset_library')`. The spec's example line is illustrative shorthand, not a literal table reference). `org_asset_library` is a real, rich, already-built table — `name, description, file_url, thumbnail_url, file_type, mime_type, file_size_bytes, dimensions, tags, folder_path, approval_status, approved_by, approved_at, is_brand_asset, usage_count, versions, current_version, is_archived, metadata` — plus a companion `org_asset_folders` table and an `org_post_asset_links` junction table linking assets directly to `posts` (all from `20260324130000`, `20260326110000`, `20260327020000`, `20260327022000`, `20260325110000`). This is the real, working reference architecture for "what a fully-built asset table with approval substate, folders, versioning, and post-linkage looks like in this codebase" — and it is meaningfully closer to what `LIBRARY_SPEC.md` §2.1 wants than anything on the personal side.

**Direct answer to §13.1's actual question** ("does `ensureLibraryRowsForPosts()` write into a personal-scoped `assets` table that simply isn't documented elsewhere, or does it write into something else entirely — e.g. directly decorating `posts`?"): **neither of the two options the spec posed is exactly right.** It writes into neither an `assets` table nor directly onto `posts`/`generations` rows — it writes into a third thing, a junction table (`content_library_items`) that references `posts` by foreign key but carries no content itself. Practically, for the purposes of LIBRARY_SPEC.md's implementation question: **Personal Library is "introduce the table itself," not "build the read UI on an existing table."** Nothing today on the personal side combines source-taxonomy unification (§1), the full metadata schema (§2.1), checksum/duplicate detection (§5), AI auto-tagging (§5/§8), or soft-delete/version-history (§6.2) — `content_library_items` + `media_assets` together cover maybe 15% of §2.1's field list and 0% of the approval-adjacent, versioning, and AI-tagging behavior. The org side's `org_asset_library` is the much closer structural reference and should be the template `implementation-researcher`/the data-layer builder works from when designing the new personal `assets` table (or whatever it ends up named) — not `content_library_items` or `media_assets`, which are both too thin to extend in place without essentially rebuilding them into something resembling `org_asset_library` anyway.

**What is safe to do without touching `ensureLibraryRowsForPosts()`'s call sites, confirmed:** the function is called from exactly three files — `src/stores/SessionStore.js` (4 call sites: `:668`, `:2338`, `:2356`, `:2445`, `:2463`, `:2630` — both personal and org-scope draft/publish flows), and `src/admin/pages/AdminModeration/moderationApi.js` (2 call sites: `:879`, `:1411`, the admin content-moderation tool's post-creation paths). All six call sites pass only `{ id, user_id }` shape and never inspect the function's return value (it returns nothing — `void`). This means a new `assets` table can be introduced and the new Library page can be built to read from it **without modifying `ensureLibraryRowsForPosts()` or any of its six call sites at all** — exactly the safety condition §13.1 asks about. The new table would need its own population path (the upload flow writes to it directly; generation-output sync would need either a new trigger/sync function or an additional call alongside `ensureLibraryRowsForPosts()`, not a replacement of it). This is a Phase 1 design question, not resolved here, but the audit confirms the precondition Phase 1 needs: today's function is small, self-contained, and non-load-bearing for anything beyond the junction table it already targets.

**One more scoping gap worth flagging now rather than letting Phase 1 rediscover it:** `content_library_items` and `media_assets` have **no `organization_id` column at all** — they are purely `user_id`-scoped (confirmed: no `organization_id` in either `CREATE TABLE` statement, `20260227090000_calendar_library_alignment.sql:39-87`). Yet `ensureLibraryRowsForPosts()` is called from `SessionStore.js` in flows that also run for org-scope posts (`preparePostForApproval()`, `saveDraft()` — both call `getActiveOrgScope()` and `withOrgScope()` immediately adjacent to the `ensureLibraryRowsForPosts()` call). This means **today, an org member's draft post also silently creates a `content_library_items` row scoped only to that member's personal `user_id`** — which has no relationship to that org's `org_asset_library` and isn't visible to anyone else in the org. This isn't a bug LIBRARY_SPEC.md asks this packet to fix (org Library is Packet 4's territory), but it is a real, currently-existing cross-contamination of "personal library now has a stray row for an org draft" that the new personal `assets` table's design should either replicate deliberately (decide it's fine) or close off (scope the new table's writes to `workspace_type = 'personal'` only, matching every other personal table's scoping rule per `PERSONAL_WORKSPACE_SPEC.md` §1). Flagging for human decision, not resolving here.

---

## 1. Full file map of the current Personal Library implementation

### 1.1 Routing — how a user actually reaches this page

| File | Role |
|---|---|
| `src/components/User/UserSidebar.jsx:47-52` | Sidebar nav item "Content Library" → `path: "/app/library"`, icon `Image`, `mobilePrimary: true` |
| `app/app/library/page.jsx` | Next.js route handler. Renders `<LibraryPageV2 />` imported from `@/pages/LibraryPage/LibraryPageV2`. No other logic. |
| `src/pages/LibraryPage/LibraryPageV2.jsx` | The actual page component (1,010 lines) |

**Finding, matching the format Packet 1 used for Calendar:** the route is real, wired, and reachable — not a stub. Unlike Calendar, where Packet 1 found a fresh `src/calendar/` + `src/pages/ContentCalendar/` tree had already been built (superseding the old `CalendarPageV3.jsx` tree mid-rebuild), **no equivalent new tree exists for Library.** `src/pages/LibraryPage/LibraryPageV2.jsx` is still the only, original implementation — confirmed via `Glob` for `src/library/**` and `src/pages/ContentLibrary/**` (both zero results). This packet's audit target is a single, unmigrated legacy tree, not a partially-completed rebuild.

### 1.2 Page + view components (`src/pages/LibraryPage/`)

| File | Lines | Purpose |
|---|---|---|
| `LibraryPageV2.jsx` | 1,010 | Page shell: header/actions, filter bar (search/platform/status/type + "remember filters" persisted to `localStorage`), left-rail section nav (All/Drafts/Scheduled/Published/Failed/Archived/Media/Templates), grid/table view toggle, bulk-select mode, upload modal, schedule modal hookup, all the `posts`/`media_assets`/`content_templates` action handlers (schedule, retry, archive, duplicate, delete, move-to-draft, use-in-post, repurpose, use-template) |
| `components/LibraryCard.jsx` | 191 | Grid-view card: preview media (image/video/fallback), status pill, platform icon, one primary action (computed by item status/type) + an overflow menu for secondary actions, optional bulk-select checkbox |
| `components/LibraryBulkActionBar.jsx` | 39 | Sticky bottom bar shown when ≥1 item selected in bulk mode — Clear/Move to draft/Archive/Delete |
| `libraryItemUtils.js` | 68 | Pure display-formatting helpers (`getItemTypeLabel`, `getItemTitle`, `getItemDescription`, `formatDate`) shared between the grid card and table row, explicitly documented in its own header comment as existing "so both stay in sync without re-deriving logic" |

Total: **1,308 lines** across 4 files. (Packet's brief named `src/pages/LibraryPage/` as a likely candidate without giving a line count — confirmed substantial, not a stub, same finding shape as Packet 1's Calendar conclusion.)

### 1.3 Data layer

| File | Role |
|---|---|
| `src/stores/LibraryStore.js` (432 lines, Zustand) | The entire data access layer for the current Library page. Direct inline Supabase calls: `fetchLibraryData()` (parallel-fetches `posts` + `media_assets` + `content_templates` + `content_pillars`, all `user_id`-scoped, 5-minute stale-cache guard), `schedulePost()`, `movePostToDraft()`, `archivePost()`, `unarchivePost()`, `retryFailedPost()`, `deletePost()`, `duplicatePost()`, `saveTemplate()`, `uploadMediaAsset()` |
| `src/services/contentLibraryService.js` (56 lines) | **The audited function.** `ensureLibraryRowsForPosts()` — see §0 above. This file has exactly one export and no other logic. |
| `src/pages/CalendarPage/components/ScheduleModal.jsx` (216 lines) | **Not owned by Library, but load-bearing for it.** Imported at `LibraryPageV2.jsx:30` and rendered at `LibraryPageV2.jsx:1002` for the "Schedule"/"Reschedule" primary action on draft/scheduled post cards. This is the same file Packet 1's audit (§3.8) already classified **Refactor** for Calendar's own reasons (naive browser-local `Date` handling, no timezone parameter) — see §4 of this report for how that finding carries over here. |
| `src/utils/postStatusMachine.js` (`assertPostStatusTransition`) | Imported directly by `LibraryStore.js` — every status-changing action (`schedulePost`, `movePostToDraft`, `archivePost`, `unarchivePost`, `retryFailedPost`) routes through this guard before writing, same as Calendar's store does. Not duplicated — genuinely the same shared file. |
| `src/constants/statuses.js` (`POST_STATUS`) | Same canonical enum Calendar uses — imported by `LibraryStore.js`, `LibraryPageV2.jsx`, `LibraryCard.jsx`. |

### 1.4 Styling

| File | Role |
|---|---|
| `src/styles/LibraryV2.css` | Page-specific styles for `.library-shell`, `.library-topbar`, `.library-filters`, `.library-left-rail`, `.library-content`, `.library-grid`, `.library-card-*`, `.library-table-*`, `.library-upload-dialog`, etc. Built entirely on the existing `--dash-*` / `--color-*` design tokens (`color-mix(in srgb, var(--dash-panel) 96%, transparent)` pattern repeated throughout) — no new tokens introduced, consistent with Master Brief §0 rule 5. |

### 1.5 Tables read/written by this tree (confirmed by direct grep of `LibraryStore.js`, `LibraryPageV2.jsx`, `LibraryCard.jsx`)

- **`posts`** — read: `*` plus joined `connected_accounts(id, platform, account_name, avatar_url)` and `generations(id, session_id, storage_path, media_type, prompt)`; written: `status`, `scheduled_at`, `caption`, `archived_at` (via the various action methods), full-row insert on `duplicatePost()`.
- **`media_assets`** — read: `*` (all columns, §0 above for schema); written: full-row insert on upload (`storage_path`, `storage_bucket`, `public_url`, `file_name`, `file_type`, `mime_type`, `file_size_bytes`, `content_pillar_id`, `platform_targets`, `source: 'upload'`).
- **`content_templates`** — read: `*`; written: full-row insert via `saveTemplate()` (not currently wired to any UI button in `LibraryPageV2.jsx` — confirmed via grep, `saveTemplate` is defined in the store but has zero callers anywhere in the page tree. Templates are read/used, never created, from the current UI).
- **`content_pillars`** — read only, `user_id`-scoped, used purely to label cards/filter by pillar name. No write path anywhere in this tree (pillar creation lives entirely in the dead `CalendarStore.js` code Packet 1's audit flagged for Remove — §3.9 of that report — meaning **today there is no UI anywhere in the live app that can create a new content pillar**, only consume existing ones. Worth flagging since `LibraryPageV2.jsx`'s `UploadModal` lets a user pick a pillar from a dropdown populated by `contentPillars`, but if that list is empty — e.g., a fresh account — there is no "+ create pillar" escape hatch on this page or, per Packet 1, anywhere else live).
- **`content_library_items`** — written only, never read, by this tree. `LibraryStore.uploadMediaAsset()` inserts a row after a successful media upload (`:399-411`) — this is a **second, independent write path into the same junction table** `ensureLibraryRowsForPosts()` targets, confirming `content_library_items` really is meant to be the unification point across `posts` and `media_assets`, exactly as the `item_type` discriminator and the one-reference-only `CHECK` constraint suggest. But since the page never queries `content_library_items` for anything — it always queries `posts`/`media_assets`/`content_templates` directly and assembles the unified `items` array client-side in `LibraryPageV2.jsx:387-440` — the table is currently being populated faithfully but never consumed. It's pure write-only overhead today.

---

## 2. Comparison against `LIBRARY_SPEC.md`'s target architecture

The spec does not name an explicit target file tree the way `CALENDAR_SPEC.md` did (no `src/library/` shared-engine diagram equivalent appears in `LIBRARY_SPEC.md`). What it does specify, against which the current tree is compared piece by piece in §3 below:

- §1 — **One unified collection** distinguished by a `source` field (`upload`/`generation`/`post`), not separate tabs. *Current state:* `LibraryPageV2.jsx` already does exactly this in spirit — `items` is one assembled array combining `posts`, `media_assets`, `content_templates` (§1.5 above), filtered by a left-rail "section" rather than hard tabs. The taxonomy differs though: spec wants `upload`/`generation`/`post`; current code has `post`/`media`/`template` (`itemType`), which is a different split — `media` conflates spec's "raw upload" and any non-post media, and there's no equivalent for "post-linked media kept in sync" as its own discriminator. Conceptually aligned, not field-for-field aligned.
- §2.1 — full `assets` table schema (workspace scope, source, generation/post FK, descriptive/technical/administrative metadata, checksum, status/approval, used_in_post_ids, superseded_by_asset_id). *Current state:* does not exist — see §0.
- §3 — approval substate. *Current state:* N/A for personal per spec's own text ("Personal workspace has no equivalent... consistent with personal having no approval concept anywhere else in the product") — confirmed true of the current tree too: no `approval_status`/`pending_approval` field appears anywhere in `media_assets` or `content_library_items`, and no UI gates a personal upload behind any approval step today. This is a rare case of current behavior already matching the spec exactly, by virtue of both being "there's nothing here."
- §4 — Grid + table views, filters (type/status/source/"unused"/tag/date range), search. *Current state:* Grid + table view toggle exists (`viewMode` state, `LibraryPageV2.jsx:328`); filters exist for type/status/platform (not source — see above) and a left-rail section nav doubling as a coarse filter; no "unused" filter (no `used_in_post_ids` field exists to filter on); no tag filter (tags exist on `content_library_items`/`media_assets` schema-wise but are never surfaced in any filter UI); no date-range filter. Search exists, keyword-only, across caption/hashtags/pillar name (not title/description/tags/ai_tags, because those fields mostly don't exist yet).
- §5 — Upload flow: drag-drop multi-file, per-file progress, checksum/duplicate warning, async Claude vision auto-tagging, org approval-gate. *Current state:* `UploadModal` (`LibraryPageV2.jsx:145-282`) is single-file only (`<input type="file">`, no `multiple` attribute, no drag-drop despite the dropzone-styled label — clicking opens a native file picker, there's no actual `onDrop` handler anywhere in the file), no progress indicator beyond the button's `loading`/`uploading` boolean, no checksum computation anywhere in `LibraryStore.uploadMediaAsset()`, no AI vision call of any kind (confirmed via repo-wide grep, §0 above — no Claude vision auto-tagging edge function exists for Library uploads anywhere in `supabase/functions/**`).
- §6 — Asset detail drawer, used-in list, approve/reject, soft-delete. *Current state:* no detail drawer exists at all for media/upload items — `LibraryCard.jsx`'s primary action for a media item is "Use in Post" (navigates straight to Generate), there is no click-to-expand detail view anywhere in the current tree. Delete is a hard delete (`LibraryStore.deletePost()` calls `.delete()` directly, no soft-delete/trash state) for posts; there is no delete action at all currently wired for media assets in the UI (the store has no `deleteMediaAsset` method).
- §6.2 — Version history via `superseded_by_asset_id`. *Current state:* does not exist in any form.
- §7 — Cross-link into Calendar's shared `ScheduleModal`/Quick Post. *Current state:* partially real today — Library already calls into `src/pages/CalendarPage/components/ScheduleModal.jsx` (§1.3 above), which is the *same* file Packet 1's Calendar audit found Calendar itself doesn't currently use for its own scheduling (Calendar schedules via drag-and-drop or inline `PostPanel` fields, never this modal). So today's "shared" component is shared in name and file location only — it's a Library-only modal that happens to live under the Calendar page's folder, not a true cross-link both pages exercise. This exactly matches what Packet 1's audit already flagged in its §3.8 and its open-items §4: *"`components/ScheduleModal.jsx` is currently load-bearing for Library... Any refactor plan needs to keep Library's caller working throughout the transition."* This audit confirms that dependency is real and current, not hypothetical.
- §8 — AI auto-tag/caption/alt-text, duplicate detection, NL search (phase 2), repurposing suggestions (phase 2, flagged). *Current state:* none of the AI capabilities exist yet for Library specifically. (Note: AI-generated captions/hashtags *do* exist, but as part of Generate Studio's `generate-post-metadata` edge function per `PERSONAL_WORKSPACE_SPEC.md` §5.3 — out of this packet's scope per Master Brief §0 rule 2 — not as a Library-side capability operating on uploads.)
- §9 — Permissions: personal = always full access (view/upload/edit/delete/schedule), no approval gate. *Current state:* matches — there is no permission check of any kind in the current Library tree beyond `user_id` ownership (e.g., `handleUseMediaInPost`'s explicit `media.user_id !== user.id` guard, `LibraryPageV2.jsx:557-560`), which is exactly right for personal scope and needs no change.
- §10 — File validation (mime/size/dimension), signed URLs, RLS scoping, soft-delete, audit trail. *Current state:* `uploadMediaAsset()` has **no client-side file validation at all** — no mime-type allowlist, no size cap, no dimension/duration check (confirmed: the only check in `UploadModal.submit()` is `if (!file) { toast.error(...) }`, `LibraryPageV2.jsx:179-182` — any file type/size passes straight to upload). Storage URLs are public (`getPublicUrl`, `LibraryStore.js:340`), not signed/short-expiry — acceptable today since personal media has no confidentiality requirement the spec names, but worth noting as a real gap versus §10's general principle. RLS scoping is correctly enforced at the database layer (`media_assets`/`content_library_items` policies both check `auth.uid() = user_id`, `20260227090000_calendar_library_alignment.sql:131-147`) — this part is solid. No soft-delete, no audit trail beyond `created_at`.
- §11 — Empty/loading/error states. *Current state:* present in reasonable shape — `LibraryPageV2.jsx:896-908` has loading and empty states with copy, though not the specific "Upload your first asset / link to Generate" CTA the spec's empty-library state names; no AI-tagging shimmer state (nothing to shimmer, since no AI tagging exists); no distinct "pending approval, viewed by non-approver" state (not applicable to personal per §3); upload validation failure has no distinct inline-per-file UI since there's no validation step to fail in the first place.

---

## 3. Per-file classification

### 3.1 `LibraryPageV2.jsx` (1,010 lines) — **Refactor**

The page is the right *concept* — one unified grid/table of posts + media + templates, filterable, with a left-rail section nav that's a reasonable analog to the spec's collections idea — but it's built entirely around the current three-table-stitched-client-side model rather than a single `assets` table query, and several of spec §1/§4/§5/§6's concrete requirements (source-field unification, "unused" filter, tag filter, date-range filter, detail drawer, multi-file drag-drop, duplicate detection, AI tagging) have no foothold to attach to in the current structure without a deeper rewrite than a find-and-replace.

What's worth carrying forward conceptually (not verbatim):
- The left-rail section nav + filter bar + grid/table toggle interaction pattern is sound UX and matches spec §4's intent reasonably well; it just needs to filter against the new unified table's `source`/`status` fields instead of `itemType`/`POST_STATUS`.
- The "remember filters" `localStorage` persistence (`LIBRARY_FILTER_PREFS_KEY`, lines 38, 58-66, 356-372) is a nice, low-risk UX touch with no spec conflict — worth keeping as a pattern.
- Bulk-select mode + sticky bulk action bar (lines 332-334, 686-727, rendered via `LibraryBulkActionBar`) is a real, working pattern not mentioned in the spec but not contradicted by it either — same "Reuse with scope caveat" logic Packet 1 applied to Calendar's command bar (§3.6 of that report). Flagging for the same kind of human confirmation: intentional carry-forward, or cut for v1 simplicity since the spec's own bulk-action language is absent.
- The primary/secondary action split per card type (`getPrimaryAction`/`getSecondaryActions` in `LibraryCard.jsx`, called from here) is a clean pattern worth preserving structurally even though the underlying data model changes.

**Reasoning for Refactor, not Remove:** the interaction model (filterable unified grid, bulk actions, primary-action-per-card-state) is fundamentally right and matches the spec's intent in §1/§4. The problem is the data model underneath it (three separately-fetched tables stitched client-side, §1.5 above) rather than the page's UX shape — once the new `assets` table exists, this page's *logic* needs substantial rework but its *interaction design* is a legitimate starting point, the same distinction Packet 1 drew for `CalendarPageV3.jsx`.

### 3.2 `components/LibraryCard.jsx` (191 lines) — **Refactor**

The primary/secondary action computation (`getPrimaryAction`, `getSecondaryActions`) is good, defensible design — one clear action per card state instead of a wall of same-size buttons, which directly serves the Master Brief §4 mobile-parity mandate (one big tappable primary action beats five small ones on a touch target). The status-pill + platform-icon + preview-media layout (`LibraryPreviewMedia`, lines 20-81) is a reasonable visual pattern.

Gaps against spec:
- No detail-drawer trigger anywhere — clicking the card does nothing for media/template items (only the preview-media button calls `onPreviewClick`, and `LibraryPageV2.jsx` never actually passes an `onPreviewClick` prop to `LibraryCard` — confirmed via grep, it's dead prop-plumbing today, accepted but never supplied). Spec §6 wants every asset to open a detail drawer; today there is no detail surface for non-post items at all.
- No "Schedule" action exists for media-type items — only posts get the schedule primary action (`getPrimaryAction`, switch only fires for `item.itemType !== 'media'/'template'` branches). This is the exact gap the packet's QA-persona walkthrough (Phase 2, Solo Sade "scheduling directly from it without ever opening AI Studio") will need resolved — currently a raw upload's only path forward is "Use in Post," which routes to Generate Studio, the opposite of what §7's direct-schedule cross-link wants.
- No version/supersede affordance, no checksum/duplicate badge, no AI-tag shimmer state (none of these exist in the data model yet, so the component can't render them).

**Reasoning for Refactor, not Remove:** the action-computation pattern and card layout shape are good UI decisions independent of the data model; they need new props/branches (detail-drawer trigger, direct-schedule for media, AI-tag-shimmer state) rather than a from-scratch rebuild.

### 3.3 `components/LibraryBulkActionBar.jsx` (39 lines) — **Reuse**

Small, clean, self-contained — reuses the existing `.ui-save-bar` shell pattern (explicitly noted in its own header comment) rather than inventing new styling, consistent with Master Brief §0 rule 5. Its three actions (move to draft, archive, delete) operate only on `posts`-type items today (`LibraryPageV2.jsx:707`, the `selectedItems` filter explicitly excludes non-post items) — nothing in the spec contradicts bulk actions existing, and nothing requires them to expand to cover assets specifically. Classified Reuse because the component itself needs no structural change; if bulk actions for the new unified `assets` table are wanted later, that's an addition to `LibraryPageV2.jsx`'s wiring, not a rewrite of this file.

### 3.4 `libraryItemUtils.js` (68 lines) — **Refactor**

Clean, well-reasoned pure functions (the file's own header comment explains *why* it exists — shared formatting logic between grid and table views so they can't drift apart, a genuinely good practice). But every function's logic branches on the current `itemType: 'media'|'template'|'post'` taxonomy and derives titles/descriptions by stripping hashtags out of a `caption` field — none of which maps cleanly onto the new spec's `source: 'upload'|'generation'|'post'` taxonomy or its explicit `title`/`description`/`alt_text` fields (§2.1), which would make this entire derive-it-from-caption approach unnecessary once those fields exist as real columns instead of being inferred. Refactor, not Remove, because the *shape* of "shared formatting helpers used by both views" is exactly right and should persist — the specific implementations just won't have anything to do once real `title`/`description` fields exist to read directly.

### 3.5 `src/stores/LibraryStore.js` (432 lines) — **Refactor**

Real, working data-access layer for the current three-table model, correctly `user_id`-scoped throughout (matches `PERSONAL_WORKSPACE_SPEC.md` §1's scoping rule), and routes every status-changing action through `assertPostStatusTransition()` before writing — the same safety discipline Packet 1 praised in `CalendarStore.js`. The `fetchOptionalTable()` helper (lines 19-24, swallowing `42P01`/missing-table errors) is a defensively reasonable pattern given `media_assets`/`content_templates` may not exist in every environment.

This needs to become the new Library data layer's foundation, but with substantial change:
- `fetchLibraryData()` needs to become a single query against the new `assets` table (plus whatever `posts` join is still needed for `source: 'post'` rows) instead of three parallel queries stitched client-side.
- `uploadMediaAsset()` (lines 314-426) is the closest existing analog to spec §5's upload flow, but is missing every required new step: no checksum computation, no AI-tagging kickoff, no multi-file support, no validation. This is the single most important method to evolve, not discard — it already gets storage upload + `media_assets` row + `content_library_items` sync right structurally, it just needs the new steps layered in.
- No `deleteMediaAsset`/soft-delete method exists at all today — net-new, not a refactor of something existing.

**Reasoning for Refactor, not Remove:** identical logic to Packet 1's treatment of `CalendarStore.js`'s posts-methods half — this is real, working, correctly-scoped code that needs to evolve in place against the new schema, not be thrown away. Unlike `CalendarStore.js`, there is no dead-code half to split out here — every method in this file is referenced and used by the live page (confirmed via grep: `saveTemplate` is the only method with zero callers, flagged in §1.5 above, but it's a small, harmless, unused-not-dead method rather than a whole subsystem like Calendar's ghost-slots code, so it doesn't warrant its own Remove classification the way Calendar's four dead state-slices did).

### 3.6 `src/services/contentLibraryService.js` (56 lines, `ensureLibraryRowsForPosts()`) — **Reuse, with a structural caveat flagged for Phase 1**

Per Master Brief §0 rule 2 and `LIBRARY_SPEC.md`'s own framing ("it consumes generation output via the existing (unmodified) `ensureLibraryRowsForPosts()` sync, it does not replace it"), this function is explicitly meant to be left alone. The audit confirms it is small, self-contained, idempotent, and safe to leave untouched — none of its six call-sites (§0 above) need to change for a new `assets` table to be introduced alongside it.

Classified **Reuse**, not Refactor, specifically because the spec's own non-negotiable framing forecloses changing it, and because — separately from that instruction — there's nothing wrong with what it does today; it does its one small job (sync a `posts` row into the junction table) correctly and safely. The caveat: Phase 1 (`implementation-researcher`) needs to design how the *new* `assets` table gets populated for `source: 'generation'`/`source: 'post'` rows, since this function only ever touches `content_library_items`, not whatever the new table ends up being. That's a net-new sync path to design, sitting *alongside* this function, not a change to it. Flagging explicitly so Phase 1 doesn't mistake "leave this function alone" for "this function will populate the new table" — it won't, by design, unless something new is added next to it.

### 3.7 `src/pages/LibraryPage/components/ScheduleModal.jsx` — **Out of this packet's primary scope; cross-reference to Packet 1's existing classification**

This file physically lives under `src/pages/CalendarPage/components/`, not under `LibraryPage/`, but it is Library's load-bearing dependency (§1.3, §2 above). Packet 1's audit already classified it **Refactor** in its own §3.8, for Calendar-side reasons (naive `Date` handling, no timezone parameter, needs to become the spec's actual shared `ScheduleModal.jsx`/`useScheduleAction()`). This audit does not re-classify it independently — doing so would risk Packets 1 and 2 producing contradictory recommendations for the same file. What this audit adds, specific to Library's stake in it: **whatever Phase 3 does with this file, Library's "Schedule"/"Reschedule" card actions (`LibraryCard.jsx`'s `getPrimaryAction`, `LibraryPageV2.jsx:1001-1007`) must keep working throughout the transition** — exactly the dependency Packet 1's own report flagged in its open-items §4 ("Any refactor plan needs to keep Library's caller working throughout the transition — this is a cross-packet dependency... whoever runs Packet 2's audit should also be made aware of"). Consider this confirmation that the dependency is real, current, and now explicitly cross-referenced from both sides.

### 3.8 `src/styles/LibraryV2.css` — **Reuse**

Built entirely on existing `--dash-*`/`--color-*` design tokens via `color-mix()`, no new tokens introduced (confirmed by reading the file's token references directly — every custom property it defines derives from an existing token, e.g. `--library-surface: color-mix(in srgb, var(--dash-panel) 96%, transparent)`). This is exactly the discipline Master Brief §0 rule 5 requires and Packet 1 didn't have an equivalent CSS file to evaluate for Calendar. Classified Reuse because the *token usage* is correct and should be the pattern any new Library mockup follows — individual class names/layouts will naturally need new rules as the page's structure changes (grid card needs a detail-drawer companion, upload modal needs multi-file/progress states), but those are additions, not corrections to what's here. Nothing in this file needs to be torn out for being wrong; it needs to be extended.

---

## 4. Resolving the packet's flagged dependency — Calendar's `ScheduleModal.jsx` and Library's stake in it, made explicit

`PACKET_1_PERSONAL_CALENDAR.md`'s own audit (§8, open item 4) flagged this exact cross-packet concern in advance: *"`components/ScheduleModal.jsx` is currently load-bearing for Library... Any refactor plan needs to keep Library's caller working throughout the transition — this is a cross-packet dependency between Packet 1 (Calendar) and Packet 2 (Library) that whoever runs Packet 2's audit should also be made aware of."*

Confirmed from this side: `LibraryPageV2.jsx:30` imports `ScheduleModal` from `'../CalendarPage/components/ScheduleModal'`, and `:1001-1007` renders it conditionally whenever `schedulingPost` is set (which happens from `LibraryCard.jsx`'s "Schedule"/"Reschedule" primary action, and from the table view's calendar-icon button at `LibraryPageV2.jsx:963`). This is a real, current, single point of coupling between the two packets' codebases. **Recommendation for both packets' Phase 3 sequencing:** whichever packet's implementation phase runs first should either (a) move/refactor `ScheduleModal.jsx` into the new shared location `CALENDAR_SPEC.md` §6 names and update Library's import path as part of the same change, or (b) explicitly leave the current file in place and importable until both packets have reached Phase 3, to avoid one packet's implementation silently breaking the other's still-shipping page. Not resolving which approach to take here — flagging it as a sequencing decision for the human approving both packets' mockups.

---

## 5. Direct comparison to the org reference architecture (`org_asset_library`)

Per the packet's explicit instruction to treat org's asset library as "a real reference point for what personal needs to become," summarizing what's already proven and working there that personal Library has none of today:

| Capability | `org_asset_library` (org, exists today) | Personal (`media_assets`/`content_library_items`, exists today) |
|---|---|---|
| Folder hierarchy | Yes — `org_asset_folders`, recursive, path-based, visibility (team/private) | No — and per `LIBRARY_SPEC.md` §2.2, personal shouldn't get folders either (tags/filters instead), so this gap is by design, not a deficiency |
| Approval substate | Yes — `approval_status` (`pending`/`approved`/`rejected`), `approved_by`/`approved_at` | N/A by design (§3 — personal has no approval concept) — correctly absent |
| Versioning | Yes — `versions` (jsonb), `current_version` | No — and this *is* a real gap against `LIBRARY_SPEC.md` §6.2, which explicitly wants personal version history too |
| Post-linkage | Yes — dedicated `org_post_asset_links` junction table with `asset_role` (primary/supporting/reference) | Partial — `content_library_items.post_id` exists but is a one-row-per-post index entry, not a many-to-many asset↔post link; no equivalent to "this asset is used on 3 different posts" |
| Usage tracking | Yes — `usage_count` integer, incremented on link | No — nothing tracks "is this asset used anywhere," which is exactly the §4 "unused" filter LIBRARY_SPEC.md wants and personal has no field to support |
| Brand-asset flagging | Yes — `is_brand_asset` boolean | No equivalent |
| Soft-delete/archive | Yes — `is_archived` boolean (not hard delete) | No — personal's only delete path (`LibraryStore.deletePost()`) is a hard `.delete()` call, no soft-delete/trash at all |
| Server-side upload validation/permission gate | Yes — `org-asset-upload` edge function validates permissions, builds safe storage paths, infers file type server-side | No — `uploadMediaAsset()` runs entirely client-side with no server-side validation step at all |

This table is the clearest evidence for why this audit classifies personal Library's data layer as needing to effectively become a new build modeled on `org_asset_library`'s shape, rather than an incremental extension of `content_library_items`/`media_assets` — the gap between what exists and what `LIBRARY_SPEC.md` §2.1 wants is large, and a working, already-proven reference for most of that gap already exists one folder over in `src/org/`.

---

## 6. Summary table

| File | Lines | Classification | One-line reason |
|---|---|---|---|
| `pages/LibraryPage/LibraryPageV2.jsx` | 1,010 | Refactor | Right interaction shape (unified filterable grid/table); data model underneath needs to move from 3-table client-stitch to single `assets` table |
| `pages/LibraryPage/components/LibraryCard.jsx` | 191 | Refactor | Good primary/secondary action pattern; missing detail-drawer trigger, missing direct-schedule for media items |
| `pages/LibraryPage/components/LibraryBulkActionBar.jsx` | 39 | Reuse | Clean, self-contained, no spec conflict; posts-only scope is a fine starting point |
| `pages/LibraryPage/libraryItemUtils.js` | 68 | Refactor | Good shared-helper pattern; logic derives from caption-stripping that becomes unnecessary once real `title`/`description` fields exist |
| `stores/LibraryStore.js` | 432 | Refactor | Real, correctly-scoped, working data layer; needs to target new `assets` table, add checksum/AI-tag/soft-delete/validation steps |
| `services/contentLibraryService.js` (`ensureLibraryRowsForPosts`) | 56 | Reuse | Explicitly spec-protected ("unmodified"); small, safe, self-contained; new table needs its own parallel sync path, not a change to this one |
| `styles/LibraryV2.css` | — | Reuse | Already built on existing design tokens correctly; needs additive rules, not corrections |
| `pages/CalendarPage/components/ScheduleModal.jsx` | 216 | *(See §3.7 — not independently reclassified; Packet 1 already called Refactor)* | Cross-packet dependency; Library's caller must keep working through any Packet 1 refactor |

**Counts (Personal Library tree only, excluding the cross-referenced-not-reclassified `ScheduleModal.jsx`): Reuse = 3, Refactor = 4, Remove = 0.**

No file in the current Personal Library tree warrants an outright Remove classification — everything here is either directly reusable as-is, or has a sound underlying concept that needs its implementation rebuilt against the new `assets` table. This differs from Packet 1's Calendar audit, which found a substantial dead-code block (`CalendarStore.js`'s ghost-slots/content-pillars/optimal-times methods, ~258 lines) with zero live references; no equivalent orphaned subsystem exists in the Library tree audited here — `saveTemplate()` (§1.5) is the only unused method found, and at one small method rather than a whole feature area, it does not rise to its own Remove recommendation.

---

## 7. Open items for human attention

1. **The org-draft-creates-a-personal-library-row cross-contamination** (§0, final paragraph) — `ensureLibraryRowsForPosts()` runs unconditionally for both personal and org-scope draft/publish flows in `SessionStore.js`, but `content_library_items` has no `organization_id` column, so an org member's draft currently leaves a stray personal-scoped junction row with no relationship to their org's actual asset library. Decide whether the new personal `assets` table should explicitly exclude org-scope writes (matching every other personal table's scoping convention) or whether this is acceptable/intentional overlap.
2. **`content_library_items` is currently write-only** — both `ensureLibraryRowsForPosts()` and `LibraryStore.uploadMediaAsset()` write to it, but nothing anywhere reads from it. Confirm whether the new implementation should finally start reading from (an evolved version of) this table, or whether it's superseded entirely by the new `assets` table and becomes dead weight itself — a question this audit surfaces but does not answer, since it depends on Phase 1's schema design.
3. **`saveTemplate()` in `LibraryStore.js`** has zero UI callers today — confirm whether "Templates" remain in scope for the rebuild (LIBRARY_SPEC.md doesn't mention templates as one of its three source types at all — §1 names upload/generation/post only) or whether templates are being intentionally dropped from Library's scope in the new spec, which would make this method (and the `content_templates` read path, and the "Templates" section of the left rail) candidates for a future Remove that this audit isn't yet certain enough to recommend outright, since the spec's silence on templates could mean either "out of scope, cut it" or "not mentioned because no change needed."
4. **The `ScheduleModal.jsx` cross-packet dependency** (§4) — needs explicit sequencing decision between Packet 1 and Packet 2's Phase 3 implementation order so neither packet's build breaks the other's still-shipping page.
5. **Bulk-select mode and "remember filters" persistence** (§3.1) — not mentioned in `LIBRARY_SPEC.md`, not contradicted by it. Same kind of confirm-intentional-carry-forward flag Packet 1 raised for Calendar's command bar — worth an explicit yes/no rather than assumed either direction.
6. **No server-side upload validation exists today** (§2, §5 above) — `uploadMediaAsset()` has no mime/size/dimension check at all. `LIBRARY_SPEC.md` §10 requires this as a new hook point regardless of source table design; flagging it here as confirmed-absent today so Phase 1's validation design isn't mistaken for replacing something that already existed in some weaker form — it didn't exist at all.

---

**Awaiting human sign-off before any Remove classification is acted on.** Nothing in this report has been deleted, edited, or moved — this is a read-only audit and recommendation only. No Remove classification was issued for any file in this packet's scope (§6), but the open items in §7 (particularly #2 and #3) identify candidate future Remove decisions that depend on Phase 1 design choices not yet made, and the cross-packet `ScheduleModal.jsx` dependency (§3.7, §4) carries Packet 1's own Refactor classification forward by reference, not by independent re-decision. Any eventual Remove recommendation arising from this packet's Phase 1/Phase 3 work will require the same explicit written sign-off before being acted on.
