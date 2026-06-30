# Content Library / Asset Library — Specification (Personal + Org)

Status: **Proposed — pending sign-off on §13 open questions before implementation starts.**
Companion documents: `ORG_WORKSPACE_SPEC.md`, `PERSONAL_WORKSPACE_SPEC.md`, `CALENDAR_SPEC.md`.

**Explicit non-goal:** this spec does not modify the Dashboard or Generate Studio / AI Studio. Library is a new read/organize/upload surface plus the formal `assets` table it needs to exist on; it consumes generation output via the existing (unmodified) `ensureLibraryRowsForPosts()` sync, it does not replace it.

---

## 0. What already exists vs. what this spec builds

- **Org**: an `assets` table already exists and is already queried (`ORG_WORKSPACE_SPEC.md` §1's example query, and `useOrgAssets()` powering Org Overview's recent-asset count). Org Asset Library is the full page sitting on top of infrastructure that's already partially there.
- **Personal**: no `assets` table is listed among the personal-scoped tables. `ensureLibraryRowsForPosts()` is referenced as syncing posts "into the personal library," but its destination table isn't named in scope for that document. **This is the central open question (§13.1):** does that function already write into a personal-scoped `assets` table that simply isn't documented elsewhere, or does it write into something else entirely (e.g. directly decorating `posts`)? The answer determines whether Personal Library is "build the read UI on an existing table" or "introduce the table itself." This spec is written to work either way, but implementation can't start until this is confirmed.

---

## 1. What goes in the library — source taxonomy

Three ingestion paths feed one unified collection (not three separate views):

1. **Raw uploads** — logos, brand photography, client-supplied files, documents. Never touched Generate. This is the genuinely new path this spec introduces.
2. **Generation outputs** — every completed generation, synced via the existing `ensureLibraryRowsForPosts()` (unmodified, just consumed).
3. **Post-linked media** — the media attached to any draft/scheduled/published post, kept in sync with #2 by the same existing function.

The Library page shows all three in one grid/table, distinguished by a `source` field (`upload` / `generation` / `post`), not by separate tabs that fragment search — fragmenting "where's my asset" by source-of-origin is exactly the chaos this page exists to remove.

---

## 2. Data model

### 2.1 `assets` table (formalized for org, introduced for personal if §13.1 confirms it's needed)

Following DAM metadata best practice of capping the *required* field set (industry guidance lands around 10–20 fields total before tagging suffers) and separating user-facing **tags** (informal, freeform) from system **metadata** (structured, controlled) — they are stored as two distinct columns, not merged, so AI auto-tags and human tags never silently overwrite each other:

| Field | Category | Notes |
|---|---|---|
| `id` | — | |
| `workspace_type`, `organization_id`, `brand_project_id`, `user_id` | scope | identical scoping rule as every other table — `organization_id IS NULL` for personal |
| `source` | descriptive | `upload` / `generation` / `post` |
| `generation_id`, `post_id` | descriptive | nullable FKs, populated when `source != 'upload'` |
| `title`, `description`, `alt_text` | descriptive | `alt_text` AI-suggested, human-editable — doubles as accessibility metadata and searchable text |
| `tags` | descriptive | freeform, user-added |
| `ai_tags` | descriptive | system-generated (Claude vision call on ingest), kept separate from `tags` per above |
| `media_type`, `dimensions` / `duration`, `file_size`, `format` | technical | mostly auto-populated on upload |
| `checksum` | technical | perceptual/content hash — powers duplicate detection at upload time |
| `status` | administrative | `pending_approval` / `approved` / `rejected` / `archived` — see §3 |
| `uploaded_by`, `approved_by`, `approved_at`, `rejection_comment` | administrative | mirrors the comment-on-rejection pattern Pipeline already uses, for consistency |
| `used_in_post_ids` | administrative | array, updated whenever the asset is placed on a post — this is what answers "has this already been posted" |
| `superseded_by_asset_id` | administrative | version chain — see §6.2 |
| `created_at`, `updated_at` | technical | |

Deliberately **excluded from v1**: usage-rights/licensing fields, expiry dates. Real DAM practice treats these as important, but they add governance overhead with no immediate payoff for a social-team tool at this stage — noted as a phase-2 addition rather than a missed requirement.

### 2.2 Folders vs. tags

No folder hierarchy. Structural organization happens entirely through tags/filters (campaign, brand project, platform-used-on, status), which — per DAM convention — lets one asset belong to multiple groupings simultaneously instead of forcing a single fixed location. Org's separate-folder-per-client pattern (seen in competitor tools) is replaced here by the `brand_project_id` scope filter, which the system already enforces structurally rather than as a manual folder a person has to remember to file things into correctly.

---

## 3. Approval substate (org only)

The permission table in `ORG_WORKSPACE_SPEC.md` §9.1 already distinguishes `can_manage_library` (org_owner/admin/editor) from `can_approve_library_uploads` (org_owner/admin only) — meaning the system was designed for uploads to pass through a lightweight gate distinct from full content review, but nothing currently implements it. This spec builds exactly that, and deliberately **does not** reuse Pipeline's configurable multi-stage machinery:

- New upload by someone without `can_approve_library_uploads` — `status = 'pending_approval'`, visible to the uploader and to anyone with approval rights, **not yet usable in Quick Post / Calendar's asset picker** until approved.
- New upload by an org_owner/org_admin — auto-`approved`.
- Approve / Reject (with required comment, same as Pipeline's `require_comment_on_rejection` pattern) are the only two actions — single stage, no configuration screen. This is intentional: assets aren't editorial content with sequential stakeholders, they're raw material, and a heavier workflow here would just be friction with no governance benefit.

Personal workspace has no equivalent — every personal upload is immediately usable, consistent with personal having no approval concept anywhere else in the product.

---

## 4. Navigation & layout

- **Grid view** (default) — visual-first thumbnails, status pill, source badge, hover quick-actions (use in Quick Post, schedule, approve/reject if pending).
- **Table view** — metadata-dense, for bulk tagging/cleanup; sortable by any column in §2.1.
- **Filters**: type, status, source, "unused" (no entries in `used_in_post_ids`) — directly answers the "what haven't I posted yet" question that came up repeatedly in the pain-point research — tag, brand project (org), date range.
- **Search**: keyword across `title`/`description`/`tags`/`ai_tags` for v1. Semantic search (phase 2, Claude-embeddings-backed) and a natural-language query bar ("find unused reels from last month") are explicitly phase 2 — flagged in §11 rather than promised for v1.

---

## 5. Upload flow

1. Drag-drop, multi-file, per-file progress.
2. On upload completion: checksum computed immediately; if it matches an existing asset, a non-blocking "this looks like a duplicate of [X]" warning appears before the user finishes tagging — doesn't block upload, just surfaces it (some duplicates are intentional re-uploads of an edited version, see §6.2).
3. Async Claude vision call populates `ai_tags`, `description`, `alt_text` suggestions — shown as a shimmer/placeholder on the card until it lands, never blocking the upload from completing.
4. Org: if uploader lacks `can_approve_library_uploads`, lands as `pending_approval` per §3.

---

## 6. Asset detail drawer

- Preview, all descriptive metadata editable inline.
- "Used in" list — every linked post, clickable, deep-linking into Calendar's detail drawer (the cross-link both specs depend on).
- Approve/reject controls if pending (org).
- Delete — soft-delete to a recoverable trash state (not immediate hard delete) with a defined recovery window, gated by `can_manage_library`. Reliability requirement, not optional: an accidental delete of a brand's only logo file should never be unrecoverable.

### 6.2 Version history

Re-uploading "the same" asset (matched via the duplicate-detection in §5, user confirms "this is a new version of X") creates a **new row**, links it via `superseded_by_asset_id` on the old row, and the old row is hidden from default views but remains in "used in" history on any post that referenced it. This directly addresses the "published the wrong/outdated version" pain point identified in the earlier research session — nothing currently in either workspace spec models version history at all.

---

## 7. Cross-link into Calendar

Every approved asset's "Schedule" action opens `CALENDAR_SPEC.md`'s `ScheduleModal` / `QuickPostComposer`, pre-filled with this asset — the same shared component, not a Library-specific reimplementation. This is the single highest-value connection identified across both specs: it is what makes "go straight from an existing asset to a scheduled post" possible without ever opening Generate Studio.

---

## 8. AI / Claude capabilities

| Capability | Behavior | Mutates data automatically? |
|---|---|---|
| Auto-tag/caption/alt-text on ingest | Vision call on upload, populates `ai_tags`/`description`/`alt_text` | Yes — additive metadata only, never overwrites a human-entered field |
| Duplicate detection | Checksum match at upload | No — surfaces a warning, user decides |
| Natural-language search (phase 2) | "find unused reels from Q1" → structured filter | No — produces a filter, doesn't act on results |
| Repurposing suggestion (phase 2, flagged §13.2) | "this asset could become a 9:16 Story version" | No — and notably, *executing* this suggestion requires re-rendering pixels through Generate Studio's models, which is out of this spec's authority to wire up without separate sign-off |

Consistent with the Calendar spec: nothing AI-generated here writes content without a human confirming it first.

---

## 9. Permissions

| Action | Personal | Org — gating permission |
|---|---|---|
| View library | always (own) | always (org-scoped) |
| Upload | always | `can_manage_library` |
| Approve/reject pending upload | n/a | `can_approve_library_uploads` |
| Edit metadata/tags | always (own) | `can_manage_library` |
| Delete (soft) | always (own) | `can_manage_library` |
| Schedule directly from asset | always | `can_schedule` (separately from library permissions — having library access doesn't imply scheduling rights) |

---

## 10. Security & reliability

- **File validation on every upload**: mime-type allowlist, size cap, dimension/duration sanity checks. **Flagged gap**: neither workspace spec describes any malware/virus scanning step on any existing upload path — this should be added here as a hook point even if the actual scanning service is chosen later, rather than shipping a new upload surface with no validation layer at all.
- Signed URLs with short expiry for asset delivery, especially for org assets that may include client-confidential material — never permanently-public direct file URLs.
- RLS-enforced scoping identical to every other table — no query in `assetLibraryService.js` omits the scope filter.
- Soft-delete + recovery window (§6) for reliability against accidental loss.
- Audit trail: every approve/reject/delete/version-supersede records who and when, surfaced in the detail drawer — not a separate logging system, consistent with how Pipeline already keeps history inline on the item rather than in a separate audit page.

---

## 11. Empty / loading / error states

| State | Behavior |
|---|---|
| Empty library, new account | Centered CTA: "Upload your first asset" / link to Generate (link, not redirect) |
| AI tagging still processing | Shimmer on the tag area of the card, rest of metadata fully usable in the meantime |
| Pending-approval asset (org, viewed by a non-approver) | Visible with a clear "Pending approval" pill, disabled-not-hidden "Schedule" action with a tooltip explaining why |
| Upload validation failure | Inline error on that specific file, doesn't block the rest of a multi-file batch |

---

## 12. Phased build plan

**MVP**
- Grid + table views, upload flow with validation + duplicate warning, Claude auto-tagging.
- Approval substate for org (§3).
- Cross-link into Calendar's `ScheduleModal`/Quick Post (§7).
- Soft-delete + version history (§6).

**Phase 2**
- Semantic/natural-language search.
- Repurposing suggestions (pending the Generate-integration decision in §13.2).
- Usage-rights/expiry metadata fields.

---

## 13. Open questions requiring sign-off before implementation

1. **§0 / §2.1** — Confirm what table `ensureLibraryRowsForPosts()` currently writes into for the *personal* workspace, and whether it's safe to introduce/extend an `assets` table there without touching that function's existing call sites.
2. **§8** — Repurposing suggestions that require re-rendering (not just metadata) need Generate Studio's models. Confirm whether a deep-link entry point into AI Studio is permitted now, or stays deferred — same boundary question raised in `CALENDAR_SPEC.md` §13.2.
3. **§3** — Confirm org_owner/org_admin auto-approval-on-upload is the intended default, versus requiring even admins to explicitly approve their own uploads for audit-trail consistency.
