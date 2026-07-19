# Decisions Log — Brand Kit AS-IS Audit

Format: timestamp (local session time, approximate) — agent — decision —
reasoning — what would need to change if wrong.

---

**2026-07-08T00:00:00 — docs-auditor** — Decided to treat this as a
read-only audit task and produce no implementation code, no new
migrations, no new components, per the explicit task instruction. —
Reasoning: task brief explicitly says "audit only, do NOT write any
implementation code, do NOT design anything new." — If wrong: would need to
scope back down and remove any code/schema artifacts accidentally created;
none were created.

**2026-07-08T00:05:00 — docs-auditor** — Started by grepping the whole repo
for `brand_kit`/`brandkit`/`BrandKit` case-insensitively before reading any
single file, rather than assuming the feature was a stub based on the task
brief's phrasing ("Find and document everything that currently exists"). —
Reasoning: the task brief's phrasing left open whether Brand Kit exists at
all; a full-repo grep first avoids missing files and avoids under- or
over-estimating scope before evidence is gathered. — If wrong (i.e. if the
grep missed relevant files due to naming that doesn't contain any of those
three strings): would need a second grep pass on adjacent terms (e.g.
"brand_assets", "brand kit" with a space, "org_brand_kits") — in fact this
gap was caught and closed mid-audit (see next entry).

**2026-07-08T00:10:00 — docs-auditor** — Read both `brand_kit` migrations
(`20260220041938_brand_kit.sql`, `20260330111000_brand_kit_version_hash.sql`)
and the org-side migration (`20260327010000_org_brand_kit_stage1.sql`) in
full before forming any opinion on schema shape, rather than inferring
columns from the React form component alone. — Reasoning: task brief
explicitly required "read actual migration files... Do NOT guess." Reading
the SQL directly (not just the form) is what surfaced the
`user_id uuid NOT NULL UNIQUE` constraint — the single most consequential
fact in this audit — which would not have been obvious from the form
component alone (the form never mentions a uniqueness constraint). — If
wrong: would need to re-verify against the live Supabase schema directly
(per the user's own memory note "DB Migration Drift" — live schema can be
ahead of migration files), which this audit did not do (no DB credentials
used); flagged implicitly by citing migration files, not live schema, as
the source of truth.

**2026-07-08T00:15:00 — docs-auditor** — Classified `public.brand_kit` as
Refactor, not Remove or "keep as-is," specifically because of the
`UNIQUE(user_id)` constraint conflicting with the mockups' multi-kit
requirement. — Reasoning: the column list is ~90% aligned with the
requested field checklist (verified field-by-field in §3 of the audit); the
only structural blocker is the uniqueness constraint, which is a schema
migration, not a full table redesign. Recommending Remove-and-rebuild would
be disproportionate to the actual gap. — If wrong (e.g. if a human decides
multiple kits should actually live in a different table entirely, with
`brand_kit` staying single-purpose): the audit's §5.1/§8.1 already frames
this as an open decision for the human, not a foregone conclusion, so no
correction would be needed beyond the human's explicit call.

**2026-07-08T00:20:00 — docs-auditor** — Traced `loadBrandKit` imports
(`src/stores/SessionStore.js:20`, `src/services/generationPipeline.js:19`)
specifically because the task brief flagged this as a make-or-break
question ("does content generation in Studio already read from a brand kit
table"). Confirmed via direct grep + read of `brandKitLoader.js`, not
inferred. — Reasoning: this is exactly the kind of claim the task brief
warned against guessing on ("this matters a lot"); tracing the actual import
graph is the only reliable way to confirm or deny it. — If wrong (e.g. if
these imports are dead code / behind a feature flag that disables them):
would need to re-check `SessionStore.js`/`generationPipeline.js` call sites
for feature flags or conditional branches around the `loadBrandKit` calls,
which this audit did not do beyond confirming the import lines exist — flag
this as a residual gap, noted here for transparency.

**2026-07-08T00:25:00 — docs-auditor** — Read both AI-extraction code paths
in full (`supabase/functions/extractBrandKit/index.ts` and
`src/services/brandKitConversation.js`) and cross-referenced their output
JSON schema against `BrandKitReviewForm.jsx`'s `toFormState()` field list
and the actual `brand_kit` table columns, rather than assuming the
extraction-to-form pipeline works because the UI components exist and look
complete. — Reasoning: task brief required precision ("do not skip reading
actual file contents in favor of assumptions") and this is exactly the kind
of bug that would not surface from reading any single file in isolation —
only from comparing three files against each other. This produced the
single highest-value finding in the audit (a confirmed, currently-shipping
data-loss bug). — If wrong (e.g. if some other normalization layer
intercepts and remaps these fields before they reach the form, which this
audit didn't find evidence of): would need to grep for any additional
transform between `setExtractedDraft`/`normalizeConversationResult` and
`toFormState` — none was found in the files read, but this audit did not
exhaustively trace every call site of `setExtractedDraft`.

**2026-07-08T00:30:00 — docs-auditor** — Classified `personal_assets` (the
Library table) as explicitly NOT to be reused/merged with brand-kit asset
storage, based on reading the `personal_assets` migration's own header
comment describing it as scoped to
`source IN ('upload','generation','post')` for the content library. —
Reasoning: task brief explicitly raised this as an open question ("reuse of
the existing personal_assets asset storage"); the migration's own stated
purpose is unambiguous that it is a different concept (generated/posted
content, not brand reference material), so recommending against merging is
a documentation/architecture-boundary recommendation, not a judgment call
requiring more evidence. — If wrong (e.g. if a human decides brand assets
should actually live in a unified asset table going forward for other
product reasons not visible in this codebase): this would be a deliberate
architecture change decision for the human to make explicitly, not
something this audit should have inferred from code alone.

**2026-07-08T00:35:00 — docs-auditor** — Did not fully read
`BrandKitOnboardingModal.jsx`, and explicitly flagged it as "Unclassified —
needs follow-up read" rather than guessing a classification for
completeness's sake. — Reasoning: it was confirmed to exist via grep but
never appeared in the traced screen flow through `BrandKitPage.jsx`'s
`renderScreen()`; classifying it without reading it would violate the task
brief's "do not skip reading actual file contents in favor of assumptions"
instruction. — If wrong (i.e. if it turns out to be trivially
classifiable): a follow-up agent should read it before the rebuild scopes
work, cheap to correct.

**2026-07-08T00:40:00 — docs-auditor** — Did not attempt to log into
Supabase or query the live database directly; treated migration files as
the source of truth for schema, consistent with how the sibling
Library/Calendar audit (`docs/calendar-library-rebuild/ui-v2-migration/AS_IS_AUDIT.md`)
was scoped, and consistent with this environment's read-only file-system
tool access. — Reasoning: no DB credentials/tooling were provided to this
agent; migration files are the closest verifiable source of truth
available. — If wrong (i.e. if live schema has drifted from migrations,
per the user's own "DB Migration Drift" memory note): a human or a
DB-capable agent should verify `brand_kit`/`brand_assets`/`org_brand_kits`
against the live schema before the rebuild's first migration is written,
specifically re-checking whether `UNIQUE(user_id)` is still actually
enforced live.

---

**2026-07-08 — Claude (main)** — Human answered the four open items raised
in AS_IS_AUDIT.md §8 before implementation started:
1. **Active-kit model for Studio**: one explicit `is_active` kit per user
   (not most-recently-edited, not an in-Studio picker). Reasoning given:
   simple, predictable, matches how tools with multiple brand profiles
   usually work. Studio's `brandKitLoader.js` will resolve
   `.eq('user_id', userId).eq('is_active', true).maybeSingle()` once the
   schema changes.
2. **Avoid-tags mapping**: keep `content_restrictions` (Guardrails,
   content-level) and `avoid_visual_elements` (Visual Style, visual-level)
   as two separate columns/tag lists, not merged — the mockup's single
   "things to avoid" under Visual Style maps to `avoid_visual_elements`
   only; `content_restrictions` stays under Guardrails. No data loss, no
   schema change needed for this item.
3. **Signed-out UX**: switch from today's auto-redirect-to-`/login` to an
   in-page "Sign in to view your brand kit" guard screen, matching the
   mockup exactly.
4. **Autosave copy**: reassurance copy only, no new debounced-autosave
   logic — today's real behavior (tab data persists in memory across the 5
   tabs, explicit save on submit) already satisfies what the copy implies.
If any of these are wrong, they are easy to revisit independently — each is
a scoped, separable decision, not entangled with the others.

**2026-07-08 — Claude (main)** — Before writing any migration, verified the
live Supabase schema directly via the service-role key rather than trusting
migration files alone, per this project's own established "DB Migration
Drift" precedent (live schema has been found ahead of the migration-history
table before). Confirmed via read-only queries: `brand_kit` has exactly 10
rows today, zero users with more than one row (consistent with
`UNIQUE(user_id)` still being live-enforced), the live column list matches
the migration file exactly (33 columns, same names), and the `brand_assets`
storage bucket's live `allowed_mime_types` genuinely has no zip type. — Why
this matters: the audit's entire schema section was migration-file-derived;
this step closes that gap with real evidence before any DDL is written. —
If wrong: would need to re-verify after any concurrent migration work by
another session, but no evidence of drift was found at time of check.

**2026-07-08 — Claude (main)** — Decided to add zip MIME types to the
`brand_assets` bucket allow-list without a separate user question, treating
it as a low-risk, easily-reversible addition rather than a blocking
decision — the mockup explicitly shows `Logo-Pack.zip · 4 variants` as a
real attachment, and adding an allowed MIME type is non-destructive (widens
what's accepted, never narrows). — If wrong: trivial to remove from the
allow-list in a follow-up migration.

**2026-07-08 — Claude (main)** — Classified `BrandKitOnboardingModal.jsx`
as **Reuse, out of scope** after reading it in full: it is a real, live,
separate first-login nudge modal rendered from `GeneratePageV2.jsx`
(`/app/generate` route, still live) and `OrgGenerateComposer.jsx` (org
workspace), triggered by `BrandKitStore`'s derived completeness status, not
by anything in the 8-screen Brand Kit page flow being rebuilt here. It reads
only `status`/`setup_completed`/`brand_name`, all of which this rebuild
preserves — no changes needed to this file. — If wrong (e.g. if it turns
out to read a field being renamed): would need a follow-up grep of its full
prop/field usage against the final migration's column list before shipping.

**2026-07-08 — Claude (main)** — `supabase db push` refused to apply the new
migration because it replays ALL pending migrations in order, and stalled
on `20260302110000_profile_provisioning_and_status_domain.sql` — an
old, unrelated migration whose `ALTER COLUMN status TYPE text` conflicts
with a live trigger (`sync_org_task_status_from_post` on `posts`).
Investigation (`supabase migration list --linked`) showed this is not an
isolated case: essentially every migration from 20260302110000 through
20260706130000 (55 files) has an empty "Remote" column in the CLI's
bookkeeping table, yet a direct read-only query already confirmed their
real effects are live (e.g. `brand_kit.version_hash`, added by the March 30
migration, already exists on the live table). This means the live DB has
been evolving via a path the CLI's migration-history table never recorded
— total, long-standing drift, not a one-off. — Asked the human how to
proceed rather than guessing; chose "apply my migration directly, skip the
old one." — Implementation: temporarily moved all 55 already-live,
unrecorded migration files out of `supabase/migrations/` (to
`/tmp/migrations-holding-tmp`, outside the repo), ran `supabase db push`
so it only saw the new Brand Kit migration file, then moved all 55 files
back immediately after. No SQL from any of those 55 files was executed —
they were never touched, only their presence in the local folder was
temporarily hidden from the push comparison. Verified via `git status`
that all 63 migration files are back in place with zero diff. — Why this
approach over the alternatives: it required no DB password, no Management
API access token (none was available in this environment), and made zero
changes to the remote migration-history bookkeeping table for the 55 old
files, so it carries no risk of mis-recording their status. — If wrong:
the broader migration-history drift (55 files) is still unresolved and
will block any *future* `supabase db push` the same way; this was
explicitly flagged to the human as option 2 (fix the drift) which they did
not choose this time — a future session should not assume `db push` works
cleanly without first checking `migration list` again.
**Post-push verification (read-only + non-destructive writes, all cleaned
up immediately):** confirmed live via the service-role key that (a) 3
sampled `brand_kit` rows now have `kit_name`/`is_active`/`font_display`/
`font_body` columns populated as expected, (b) inserting a second
`is_active=false` kit for an existing user succeeds (multi-kit works) and
was deleted immediately after, (c) inserting a second `is_active=true` kit
for the same user correctly fails with `duplicate key value violates
unique constraint "brand_kit_one_active_per_user"` (the partial index is
enforcing exactly one active kit per user), and (d) the `brand_assets`
bucket's live `allowed_mime_types` now includes `application/zip` and
`application/x-zip-compressed`.

**2026-07-08 — Claude (main)** — Cleaned up the 55-migration bookkeeping
drift, at the user's explicit request, using `supabase migration repair
--status applied <versions...>` rather than re-running any of the old
files' SQL. Before doing so, spot-checked evidence that the effects really
are already live (not just assumed): read
`20260302110000_profile_provisioning_and_status_domain.sql` in full and
confirmed live `posts.status` values are already canonical lowercase
(`draft`/`publishing`/etc, queried directly), and that a much later
migration in the same blocked range
(`20260327030000_org_tasks_stage4.sql`) already has a live trigger
(`sync_org_task_status_from_post`) that depends on `posts.status` being
`text` — which could only exist if the column conversion this migration
performs had already succeeded previously (most likely applied directly
via the Supabase SQL editor at the time, outside the CLI, which is why the
CLI's history table never recorded it). This is consistent with the
"DB Migration Drift" pattern already known about this project. — Ran
`migration repair` for all 55 versions in one command; verified success by
re-running `supabase migration list --linked` and diffing every row's
Local vs Remote column (zero mismatches) and `supabase db push --dry-run`
(reported "Remote database is up to date"). — Reasoning for repair over
re-running: re-running would risk re-applying already-live DDL a second
time, which several of these 55 files are not written idempotently enough
to survive safely (confirmed by the original failure itself — a live
trigger already blocks a literal re-run of migration #1 in the set); repair
only edits the bookkeeping table, never touches schema. — If wrong (i.e.
if any of the 55 was NOT actually fully applied live despite this
evidence): its real DDL would now be silently skipped by all future
`db push` runs; the mitigant is that the live schema audit earlier in this
session (brand_kit: 33/33 columns matching) and this spot-check together
covered both the earliest and one of the latest files in the range,
making a gap in the middle less likely but not disproven — a future
`supabase db diff --linked` against a fresh local shadow DB would be the
correct follow-up if any live behavior seems inconsistent with a specific
old migration going forward.

---

**2026-07-08 — Claude (main, presentation-layer rebuild)** — Built the
ui-v2 presentation layer for all 9 mockup screens
(empty/landing, 4-path setup choice, extraction loader, guided conversation,
5-tab review form, multi-kit dashboard, diff modal, error state, signed-out
guard) against the already-rebuilt `BrandKitStore.js`/`extractBrandKit`/
migration. Judgment calls made along the way, none pre-answered by the task
brief:

1. **One shared `src/components/BrandKit/BrandKit.module.css`** instead of
   one CSS Module per component (Studio/Library's established pattern). —
   Reasoning: this feature is 10 small files that all reuse the same
   field/tag/pill/card primitives; splitting would duplicate the vast
   majority of rules across files with no scoping benefit (CSS Modules
   already uniquely hash classes per source file at build time regardless of
   how many components import it). — If wrong: mechanical split into
   per-component modules, no logic changes needed.
2. **"Contact support" on the error screen** — no existing mailto/support
   link or support-contact pattern exists anywhere else in the app (grepped
   the whole repo, zero hits). Used a plain `mailto:support@brandosse.com`
   link rather than inventing a new support ticketing flow. — If wrong: swap
   the `href` in `BrandKitPage.jsx`'s error screen for whatever the real
   support channel turns out to be — single line change.
3. **`src/styles/BrandKit.css` (`--bk-*` tokens) was NOT deleted.** Per the
   task brief's own instruction ("only once every consumer is confirmed
   migrated off `--bk-*` classes") — grepped and confirmed live, in-scope-
   elsewhere consumers still exist: `BrandKitOnboardingModal.jsx` (explicitly
   classified Reuse/out-of-scope earlier in this log, still renders from the
   live `/app/generate` and org-generate flows), `IntentClarificationPanel.jsx`,
   `BrandKitForm.jsx`, and several `src/admin`/`src/org` files. `app-entry.css`
   globally imports it. None of the 9 rebuilt screens/components in this
   pass reference any `bk-*` class anymore (verified by grep scoped to
   `src/components/BrandKit/*.jsx` + the new `BrandKitPage.jsx`). — If wrong:
   safe to delete once those other consumers are separately migrated or
   removed.
4. **Re-import-from-site URL prompt uses `window.prompt`**, not a proper
   modal, inside `BrandKitDashboard.jsx`'s "Update Kit" menu. — Reasoning:
   the task brief didn't specify a UI for this beyond "prompts for/reuses
   `website_url`"; a native prompt is the fastest correct implementation and
   is easy to upgrade to a proper Modal input later without touching the
   `extractBrandKit`/`openDiffModal` wiring underneath it. — If wrong: swap
   the `window.prompt` call for a small ui-v2 `Modal` with a single input,
   same handler logic.
5. **Signed-out and full-page-load-error guards render a bare `<AppHeader
   navItems={[]} right={null} />`** (no theme toggle, no nav links) rather
   than the full authenticated header. — Reasoning: matches the mockup intent
   (a minimal, focused guard screen) and avoids rendering nav items that
   would navigate an unauthenticated visitor into other gated app pages. —
   If wrong: trivial to pass the full `NAV_ITEMS`/`headerRight` instead.
6. **Empty-state "Start from scratch" routes to the existing 4-path
   setup-choice screen** (not directly to the manual review form) — this was
   explicit in the task brief's screen description, followed as specified.
7. Extended `BrandKitExtractLoader.jsx` to accept an optional `websiteUrl`
   prop alongside the existing `file` prop, reusing the single component for
   both the mockup's empty-state URL import AND the dashboard's "Re-import
   from site" action, rather than building a second loader component —
   the real network call (`extractBrandKit` edge function) already branches
   internally on `storagePath` vs `websiteUrl`, so the loader only needed to
   skip the "Uploading" stage and change its title copy for URL mode.
8. Did not modify `BrandKitStore.js`, `extractBrandKit/index.ts`,
   `brandKitConversation.js`, or the migration file, per the explicit
   constraint in the task brief — confirmed no gaps were found that would
   have required touching them; every screen's data need was already
   satisfied by the existing store API.

---

**Awaiting human sign-off before any Remove classification is acted on.**
(No Remove classifications were made in this audit — see AS_IS_AUDIT.md §7.)
