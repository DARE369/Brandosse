# AS-IS Audit — Brand Kit (personal workspace), pre-rebuild

Auditor: `docs-auditor`
Date: 2026-07-08
Scope: everything that currently exists for the **personal-workspace** Brand
Kit feature, compared against the new mockup screenshots described by the
requesting agent (empty state, 4-path setup, extraction loader, guided
conversation, 5-tab review form, saved-kit dashboard with multi-kit switcher,
re-import diff screen, error state, signed-out guard). Org-workspace Brand
Kit (`org_brand_kits`) is a **separate, already-shipped feature** and is
noted only for contrast/non-collision purposes — it is out of scope for this
rebuild.

This is a read-only audit. No application code, migration, or config was
created, edited, or deleted while producing it.

---

## 0. Headline finding

The current Brand Kit feature is **not a stub or a dead prototype** — it is a
complete, wired, real-data feature that already implements almost every
*interaction* the new mockups describe (upload-doc extraction with a staged
loader, guided AI conversation, a 5-tab review form, a saved-kit dashboard,
re-import producing a diff-and-merge modal, JSON import/export). It is built
on the same pre-ui-v2 design system Library/Calendar were on before their
own migrations (`--bk-*` tokens in `src/styles/BrandKit.css`, not
`--uiv2-*`), so the shape of this job is structurally similar to those two:
presentation-layer swap over a data layer that mostly already does the job.

However, there are real, functional gaps versus the new mockups (not just
presentational ones), and one confirmed live bug. Most importantly:

- **`brand_kit` is hard-limited to ONE kit per user** (`user_id uuid NOT NULL
  UNIQUE` — `supabase/migrations/20260220041938_brand_kit.sql:9`, and every
  read/write path uses `.upsert(..., { onConflict: 'user_id' })` /
  `.eq('user_id', userId).maybeSingle()`). The mockups' kit switcher ("Marrow
  Coffee ▾ · 2 of 3 kits · 12 assets") requires **multiple kits per
  account** — this is a genuine schema change, not a presentation change.
- **There is no website-URL import/extraction anywhere in the codebase.**
  Grepped for `scrape`, `fetchWebsite`, URL-based import — zero hits. The
  only import paths that exist today are (a) PDF/Word document upload via
  the `extractBrandKit` edge function, and (b) raw JSON file import
  (`BrandKitSetupChoice.jsx:44-59`, client-side `file.text()` + `JSON.parse`,
  no server round-trip at all). The mockups' "yourbrand.com" URL import and
  "Re-import from site" both require a **net-new edge function** (fetch +
  parse a live URL, not just a stored document).
- **Confirmed schema-drift bug, live today**: the extraction pipelines
  (`supabase/functions/extractBrandKit/index.ts` and
  `src/services/brandKitConversation.js`) both emit a `brandKit` object shaped
  `{ brand_voice: [], core_values: [], content_pillars: [], hashtags: [],
  do_list: [], dont_list: [] }` (see `extractBrandKit/index.ts:12-33` and
  `brandKitConversation.js:10-29`), but the actual `brand_kit` table and
  `BrandKitReviewForm.jsx`'s `toFormState()` (lines 159-190) expect
  `brand_voice` as **text** (not array), `forbidden_phrases`/
  `content_restrictions` (not `dont_list`/`content_pillars`), and have **no
  column at all** for `core_values`, `hashtags`, or `do_list`. Practical
  effect: every AI-extracted or AI-conversation-derived Brand Kit today
  silently drops `core_values`, `hashtags`, `content_pillars`, `do_list`, and
  mis-types `brand_voice`/`tone_descriptors` on the way into the review form.
  This is a real, currently-shipped bug (not a hypothetical one) — flag for
  the rebuild to fix regardless of which mockup path it's redone under.
- **Studio's live generation pipeline reads directly from `brand_kit` and
  `brand_assets`** (`src/stores/SessionStore.js:20` and
  `src/services/generationPipeline.js:19`, both `import { loadBrandKit } from
  './brandKitLoader'`, which does `supabase.from('brand_kit').select('*')...`
  and `supabase.from('brand_assets').select(...)` —
  `src/services/brandKitLoader.js:4-19`). **Any DB schema change here is a
  breaking change to live content generation, not just a UI rebuild.** The
  new multi-kit model requires deciding which kit Studio reads from (active
  kit? explicit selection?) before any schema change ships.

---

## 1. File map — what exists today

### 1.1 Routing
| File | Role |
|---|---|
| `app/app/settings/brand-kit/page.jsx` | Next.js route. Renders `<BrandKitPage />` from `@/pages/Settings/BrandKitPage`. No other logic. |
| `src/components/User/UserSidebar.jsx:79` | Nav entry: `{ name: "Brand Kit", path: "/app/settings/brand-kit", icon: Layers, badge: "NEW" }`, plus a live "incomplete" status dot (`:224-230`) driven by `useBrandKitStore((s) => s.status)`. Sidebar also eagerly calls `loadBrandKit(user.id)` on an idle-callback/250ms-timeout (`:114-131`) so the nav badge reflects real kit status even before the page is opened. |

### 1.2 Presentation layer (screen components — what the new mockups replace)
| File | Role | Mockup screen it corresponds to |
|---|---|---|
| `src/pages/Settings/BrandKitPage.jsx` | Page shell / state machine. Owns `screen` state (`choice`\|`extracting`\|`conversational`\|`review`\|`dashboard`), routes between the components below, mounts the diff modal. 242 lines. | Orchestrates all screens |
| `src/components/BrandKit/BrandKitSetupChoice.jsx` | 3 starting paths: "Upload brand document" (primary CTA, PDF/Word ≤20MB validated client-side, `:12-21`), "Guide me with AI" (conversational), "Fill it myself" (manual), plus a small "Import from JSON" footer link. | "Set up your brand kit" 4-option screen — **missing the mockup's 4th path** (mockup has Upload / Guided / Manual / **Import a kit file** as 4 equal options; current build has 3 primary + JSON-import as a footer afterthought, and has **no empty/landing state at all** — no "Build your brand kit" / website-URL-import screen before this choice screen) |
| `src/components/BrandKit/BrandKitExtractLoader.jsx` | Staged progress UI: 7 stages (uploading → reading → identity → voice → visual → guardrails → building), client-simulated timers layered over a real edge-function call, `AlertCircle` error state with "Guide me with AI instead" fallback. | "Reading Brand-Guidelines.pdf" loading screen — **conceptually equivalent**, though the mockup's screenshot describes 4 steps and this build has 7; a mockup-vs-build reconciliation is needed, not a rebuild from scratch |
| `src/components/BrandKit/BrandKitConversation.jsx` + `src/services/brandKitConversation.js` | One-question-at-a-time chat UI (6 fixed questions), free-text answers, live preview panel (`BrandKitLivePreview.jsx`) alongside the chat, final Groq call to structure the transcript into a draft kit. | Guided conversation screen — **conceptually equivalent, real and working** |
| `src/components/BrandKit/BrandKitReviewForm.jsx` | 5-tab review/edit form: **Basics / Voice / Guardrails / Visual Style / Assets** (`TAB_CONFIG`, lines 14-40) — this **already matches the mockup's exact 5-section structure** (Basics/Voice/Guardrails/Visual Style/Assets), including per-field AI-confidence flags, a sidebar with fill-count per tab, and a submit-time "missing tier-1 fields" warning modal (`BrandKitSaveWarning.jsx`). | 5-step review/edit form — **strong match already**, only presentation-layer swap needed; no "draft saves automatically" behavior exists today (every save is an explicit user click on "Save & continue"/"Confirm and activate") |
| `src/components/BrandKit/AssetUploader.jsx` | Drag-and-drop or click-to-browse multi-file uploader, per-file progress bar, type-to-icon mapping (logo/font/document/video/image/other), inline edit (name/description/usage hints/alt text/tags) and delete per asset. | Assets tab / Assets card in dashboard — real and working, uploads to the real `brand_assets` storage bucket |
| `src/components/BrandKit/BrandKitDashboard.jsx` | Saved-kit summary: brand name/industry header, voice/audience meta row, color-palette swatches, a weighted "Kit health" percentage bar (`getHealthScore`, `brandKitValidation.js:20-35`), a "Quick edit" rail linking into each of the 5 tabs, an "Update Kit" dropdown (upload new doc / edit manually). | Completed summary dashboard — **partial match**: has Basics/Voice/health summary and swatches, but **no separate Voice/Guardrails/Visual Style/Assets cards** (mockup shows 4-5 distinct cards; current build is a single summary card + a quick-edit list), **no font-pair display**, **no "things to avoid" tags shown**, **no kit switcher** (can't — only one kit exists in the DB), **no "New brand kit" action** (can't — schema forbids it) |
| `src/components/BrandKit/BrandKitDiffModal.jsx` | Full diff/merge UI: separates "conflicts" (field changed) from "additions" (field newly found), per-row Current/New toggle buttons, bulk "Keep all current"/"Use all new", collapsible additions list, footer Cancel/"Apply selection". | "Diff — review updates from re-import" screen — **strong conceptual match already**, but today it can only be triggered by re-**uploading a document** (`BrandKitDashboard.jsx`'s "Update Kit" menu → "Upload updated brand document"), never by a website re-import, because no website import path exists |
| `src/components/BrandKit/BrandKitSaveWarning.jsx` | Modal warning shown when tier-1 fields are still empty at save time; not a mockup screen by itself but supporting UI for the review form. | N/A (supporting) |
| `src/components/BrandKit/BrandKitLivePreview.jsx` | Side-panel live preview of collected data during the guided conversation. | Supports guided-conversation screen |
| `src/components/BrandKit/BrandKitOnboardingModal.jsx` | Grep-confirmed to exist; not read in full for this audit (out of the direct screen flow — appears to be a separate first-login nudge, not part of the 8-screen flow described). Flag for a follow-up read before the rebuild scopes it in/out. | Unclear — needs a closer look before rebuild |

Styling: `src/styles/BrandKit.css`. Confirmed via header comment
(`:1-5`) it is "dark-first, indigo-accented ... All values use `--bk-*`
tokens from variables.css" — its own bespoke token family, not `--dash-*`
and not `--uiv2-*`. This is a **third** token family alongside the two
Library/Calendar were already found on, confirming Brand Kit needs the same
ui-v2 token/primitive swap Studio/Dashboard/Library/Calendar each got.

**Screens the mockups describe that have literally no equivalent screen
today:**
- Empty/landing state ("Build your brand kit" — URL import or "Start from
  scratch") — today the page goes straight to `BrandKitSetupChoice` with no
  prior empty state or URL-import field.
- Error state ("Couldn't load your brand kit" / Try again / Contact
  support) — `BrandKitPage.jsx` only renders a plain `<div
  className="bk-error-banner">{error}</div>` banner (`:222`) above whatever
  screen was already rendering; there is no full-screen dedicated error
  state.
- Signed-out guard ("Sign in to view your brand kit") — `BrandKitPage.jsx`
  instead **auto-redirects** to `/login` (`:51-54`) and briefly shows a
  generic `AuthLoadingOverlay` ("Redirecting to sign in"), not a
  dedicated "Sign in to view your brand kit" guard screen with presumably a
  sign-in CTA staying on-page.
- Multi-kit switcher — impossible without the schema change noted in §0.

### 1.3 Data layer
| File | Role |
|---|---|
| `src/stores/BrandKitStore.js` | Zustand store, all Supabase access lives here (real, not mocked): `loadBrandKit` (upserts an empty row on first load, `:106-109` — meaning **a `brand_kit` row is silently created for every user the first time they open the page**, not just on explicit save), `saveBrandKit` (upsert, computes a client-side `version_hash`), `markSetupComplete`/`skipSetup`, `uploadAsset`/`updateAsset`/`deleteAsset` (real `brand_assets` storage bucket, direct signed XHR upload with progress events, `:32-78`), `openDiffModal`/`applyDiff`. |
| `src/services/brandKitLoader.js` | Consumed by **Studio's live generation pipeline** (see §0) — `loadBrandKit(userId)` reads `brand_kit` + up to 20 `brand_assets` rows and condenses them into a plaintext prompt-injection summary (`condenseBrandKit`, `:21-60`). This is the actual live coupling between Brand Kit data and content generation quality. |
| `src/utils/brandKitValidation.js` | `TIER_1_FIELDS` (brand_name, brand_voice, target_audience, forbidden_phrases, content_restrictions), `isFilled`, `getMissingTier1Fields`, `getHealthScore` (weighted: tier-1 fields count 2x). Pure logic, framework-agnostic. |
| `src/utils/brandKitHash.js` | `computeBrandKitHash` — fallback hash used by `BrandKitStore.computeVersionHash` if `btoa`/`JSON.stringify` throws. Not read in full; small utility. |
| `src/constants/statusEnums.js` | `BRAND_KIT_STATUS` (`MISSING`/`PARTIAL`/`CONFIGURED`, presumably — confirmed present, not fully read) and `ASSET_STATUS` (`UPLOADING`/`READY`/`FAILED`, confirmed via `BrandKitStore.js` usage). |
| `supabase/functions/extractBrandKit/index.ts` | Real edge function. Downloads the uploaded document from the `brand_assets` bucket via a signed URL, does binary/PDF-ish text extraction (naive paren-scraping for PDFs, `:93-103` — **not a real PDF parser**, will produce poor results on complex/image-heavy PDFs, which the extract loader's own fallback UI half-acknowledges with "Scanned or image-only documents can fail"), then calls `callLlm({ preferredProvider: "anthropic", jsonMode: true, ... })`. **Confirmed schema-drift bug** — see §0. |
| `src/services/brandKitConversation.js` | Pure prompt-building + normalization logic for the guided conversation's final Groq call. Same schema-drift bug as above (§0). |

---

## 2. Database — exact current shape (read directly from migration files)

### 2.1 `public.brand_kit` (`supabase/migrations/20260220041938_brand_kit.sql:7-58`, plus `20260330111000_brand_kit_version_hash.sql`)

**One row per user, enforced by `user_id uuid NOT NULL UNIQUE`.** This is the
central schema fact that blocks the mockups' multi-kit model.

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | `gen_random_uuid()` | PK |
| `user_id` | uuid | — | `UNIQUE`, FK → `auth.users(id)` ON DELETE CASCADE |
| **Basics** | | | |
| `brand_name` | text | | |
| `industry` | text | | |
| `tagline` | text | | |
| `website_url` | text | | present, but nothing reads it to drive a re-import today |
| `primary_language` | text | `'en'` | |
| `target_audience` | text | | |
| `audience_age_range` | text | | |
| `audience_locations` | text[] | `'{}'` | |
| **Voice** | | | |
| `brand_voice` | text | | single value (form renders as a pill-select of 6 fixed options), **not** the array shape the extraction pipelines emit (§0 bug) |
| `tone_descriptors` | text[] | `'{}'` | tag list — maps to mockup's "tone-of-voice tags" |
| `writing_style_notes` | text | | |
| `signature_phrases` | text[] | `'{}'` | matches requested field list exactly |
| `forbidden_phrases` | text[] | `'{}'` | this is the "banned words list" from the requested field checklist |
| `emoji_usage` | text | `'moderate'` | matches requested field exactly |
| `call_to_action_style` | text | | matches requested field exactly |
| **Guardrails** | | | |
| `content_restrictions` | text[] | `'{}'` | this is the mockup's "things to avoid" tag list (Guardrails tab, not Visual Style — see note below) |
| `competitor_names` | text[] | `'{}'` | matches requested field exactly |
| `legal_disclaimers` | text | | matches requested field exactly |
| `brand_safe_only` | boolean | `true` | |
| `min_caption_words` | int | `20` | |
| `max_caption_words` | int | `300` | together these are the requested "caption/hashtag limits" field, minus hashtags |
| `max_hashtags` | int | `30` | |
| **Visual Style** | | | |
| `visual_style_keywords` | text[] | `'{}'` | |
| `color_palette` | jsonb | `'[]'` | array of `{hex, name, usage}` objects — matches mockup's color swatches |
| `typography_notes` | text | | **free text only** — mockup shows 2 structured font pairs (display + body); no structured font-pair columns exist |
| `photo_style_notes` | text | | |
| `avoid_visual_elements` | text[] | `'{}'` | this is a *second*, visual-specific "things to avoid" list, separate from `content_restrictions` |
| **Platform prefs** | | | |
| `platform_preferences` | jsonb | `'{}'` | present in schema and form state (`toFormState`, `:188`) but **no UI tab renders it** — dead column from the UI's perspective today |
| **Metadata** | | | |
| `setup_completed` | boolean | `false` | drives dashboard-vs-choice routing |
| `setup_skipped` | boolean | `false` | |
| `last_updated_at` | timestamptz | `now()` | |
| `created_at` | timestamptz | `now()` | |
| `version_hash` | text | — | added by the second migration; client-computed, used for future diff/change-detection, not currently compared against anything server-side |

RLS: `ENABLE ROW LEVEL SECURITY` + single `FOR ALL USING (auth.uid() =
user_id) WITH CHECK (auth.uid() = user_id)` policy (`:60-66`). Simple,
correct owner-only access — **would need to become kit-scoped** (still owned
by `user_id`, but no longer 1:1) if multi-kit ships.

### 2.2 `public.brand_assets` (`20260220041938_brand_kit.sql:69-115`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | FK → `auth.users`, CASCADE |
| `brand_kit_id` | uuid | FK → `brand_kit(id)`, CASCADE — **this FK is exactly why single-kit-per-user currently works cleanly; multi-kit will need this to stay as-is (each asset already belongs to one specific kit), so this table's shape doesn't need to change, only `brand_kit`'s uniqueness constraint does** |
| `name`, `asset_type` (`'logo'\|'font'\|'document'\|'video'\|'image'\|'other'`), `file_name`, `mime_type`, `file_size_bytes` | | |
| `storage_path`, `public_url` | | path convention `{user_id}/{asset_type}/{timestamp}_{filename}` per migration comment (`:177`) |
| `description`, `tags`, `usage_hints`, `alt_text`, `extracted_text`, `visual_summary`, `color_palette`, `font_family` | | rich metadata already present — `extracted_text`/`visual_summary` suggest a prior intent to AI-analyze uploaded assets, but no code path currently populates them (grepped `BrandKitStore.uploadAsset`, `:253-311` — never sets these two fields) |
| `status` (`'ready'` default), `processing_notes` | | matches `ASSET_STATUS` enum usage in the store |
| `created_at`, `updated_at` | | |

RLS: same owner-only pattern as `brand_kit`. Indexes on `user_id`,
`brand_kit_id`, `asset_type` (`:113-115`).

**Verdict: `brand_assets` table shape is already a very close match for the
mockup's Assets card** (logo files, product shots, PDF/zip attachments) —
`asset_type` already includes `document`; nothing in the mockup asset list
requires a new column. The mockup's "drag-to-fill drop zones" (per-slot
upload, e.g. a specific "primary logo" slot) is a **presentation/UX
behavior**, not a schema gap — `asset_type='logo'` plus ordering/tags is
enough to build that in the UI layer.

### 2.3 Storage — `brand_assets` bucket (`supabase/migrations/20260222013000_storage_buckets_and_policies.sql:1-104`)

Real, provisioned bucket: private (`public = false`), 50MB limit, allowed
MIME types include PNG/JPEG/WEBP/SVG/GIF, PDF, DOC/DOCX, TXT/MD, TTF/OTF,
MP4/WEBM. Four RLS policies (select/insert/update/delete), all scoped to
`(storage.foldername(name))[1] = auth.uid()::text`. **This already covers
every asset type the mockup screenshots show** (logo files, product shots,
PDF/zip — though `.zip` specifically is not in the allowed MIME list; would
need `application/zip`/`application/x-zip-compressed` added if zip
attachments are truly required verbatim from the mockup).

### 2.4 Org-workspace equivalent (context only, not in scope)

`public.org_brand_kits` (`supabase/migrations/20260327010000_org_brand_kit_stage1.sql`)
is a **structurally different, already-shipped, unrelated table** — one kit
per `brand_project_id` (`UNIQUE` constraint), with its own AI-prompt-building
trigger (`build_org_brand_kit_ai_prompt`), completeness-score trigger,
editor-permission table (`org_brand_kit_editors`), and RLS scoped to
`organization_members`. It shares almost no column names with personal
`brand_kit` (`voice_description` vs `brand_voice`, `banned_phrases` vs
`forbidden_phrases`, `content_pillars` instead of anything in personal's
schema, etc.) and has its own page (`src/org/admin/BrandKitPage.jsx`,
`src/org/services/brandKitService.js`, `src/org/components/BrandKitPanel.jsx`,
`app/app/org/[orgId]/admin/brand-kit/page.jsx`). **Confirmed: this is
completely independent of the personal Brand Kit rebuild** — no shared code,
no shared table, no risk of collision. Noted here only so the rebuild does
not accidentally reuse/rename anything the org side depends on.

---

## 3. Field-by-field comparison against the requested checklist

| Requested field | Exists today? | Where |
|---|---|---|
| Multiple kits per user | **No** | `brand_kit.user_id` is `UNIQUE` — hard schema block, see §0 |
| Basics/Voice/Guardrails/Visual Style/Assets 5-section structure | **Yes, exact match** | `BrandKitReviewForm.jsx` `TAB_CONFIG` (`:14-40`) |
| Asset attachments (logo/PDF/zip) with storage relationship | **Mostly yes** | `brand_assets` table + `brand_assets` storage bucket; zip MIME type not currently allow-listed |
| Website re-import producing a diff | **Diff mechanism yes, website-fetch no** | `BrandKitDiffModal.jsx` exists and works against *document* re-uploads only; no URL-fetch edge function exists |
| Guided-conversation capture mode | **Yes** | `BrandKitConversation.jsx` + `brandKitConversation.js` |
| Document-upload extraction mode (AI parses PDF) | **Yes, but with a real bug** | `extractBrandKit` edge function; naive PDF text-scrape (not a proper parser) + schema-drift bug (§0) |
| Tone-of-voice as a tag list | **Yes** | `tone_descriptors text[]` |
| "Things to avoid" as a tag list | **Yes, but split across two columns** | `content_restrictions` (Guardrails tab) AND `avoid_visual_elements` (Visual Style tab) — the mockup's single "things to avoid" tag list under Visual Style most likely maps to `avoid_visual_elements`, but this needs an explicit design decision, not just a rename |
| Banned words list | **Yes** | `forbidden_phrases text[]` |
| Competitor names list | **Yes** | `competitor_names text[]` |
| Legal disclaimers | **Yes** | `legal_disclaimers text` |
| Caption/hashtag limits | **Yes** | `min_caption_words`, `max_caption_words`, `max_hashtags` |
| Signature phrases | **Yes** | `signature_phrases text[]` |
| CTA style | **Yes** | `call_to_action_style text` |
| Emoji usage preference | **Yes** | `emoji_usage text` |
| 2 font pairs (display + body) | **No** | Only free-text `typography_notes`; no structured font-pair columns |
| Website URL import (initial) | **Column exists, feature doesn't** | `website_url text` column present; no scrape/extraction pipeline reads it |

---

## 4. Is Brand Kit used anywhere else in the app? (breaking-change risk)

**Yes — confirmed, live, load-bearing.** Two call sites:

1. `src/stores/SessionStore.js:20` — `import { loadBrandKit } from
   '../services/brandKitLoader'`
2. `src/services/generationPipeline.js:19` — `import { loadBrandKit } from
   './brandKitLoader'`

Both consume `brandKitLoader.js`'s `condenseBrandKit()` output (a
plaintext summary string built from `brand_kit` columns + up to 20
`brand_assets` rows, `brandKitLoader.js:21-60`) and inject it into Studio's
content-generation prompts. This means:

- **Renaming/removing/retyping any `brand_kit` column** (e.g. changing
  `brand_voice` from text to array to fix the §0 bug, or removing
  `content_restrictions` in favor of a renamed field) **will silently change
  or break what Studio's AI generation sees**, not just the Brand Kit page.
  Any such change needs `brandKitLoader.js`'s `condenseBrandKit()` updated in
  lockstep, and ideally a regression check against actual Studio output.
- **The multi-kit schema change is the highest-risk item for this reason.**
  Once a user can have 2-3 kits, `loadBrandKit(userId)`'s `.maybeSingle()`
  call breaks outright (multiple rows will error or silently pick one at
  random depending on the query). Studio needs an explicit "active kit"
  concept (or an explicit kit selector in the generation flow) before/at the
  same time the DB constraint changes — this is a cross-feature product
  decision, not just a Brand Kit rebuild detail, and should be flagged to
  the human before implementation starts.

Also load-bearing, secondary: the nav sidebar's "incomplete" status dot
(`UserSidebar.jsx:224-230`) reads `BrandKitStore`'s derived `status`
(`MISSING`/`PARTIAL`/`CONFIGURED`) which is computed from `setup_completed` +
`brand_name` presence (`BrandKitStore.js:352-357`) — any rebuild needs to
either keep emitting a compatible status or update this consumer too.

---

## 5. Per-piece classification

### 5.1 `public.brand_kit` table — **Refactor**
Column set is already ~90% aligned with the mockup's requested fields (see
§3 table — only structured font-pairs are missing). The blocking issue is
purely structural: the `UNIQUE(user_id)` constraint must be relaxed to
support multiple kits per account, which means introducing a proper
"account has many kits, one marked active/default" model (new constraint
shape, likely a new `is_active`/`is_default` boolean or a separate
`brand_kit_id` pointer somewhere account-level). **Reasoning for Refactor,
not Remove/rebuild-from-scratch:** the column list itself is sound and
already used by a live consumer (Studio) — throwing it away would be
strictly worse than evolving it. This is the single most consequential
schema decision in the whole rebuild and needs explicit human sign-off given
the Studio coupling in §4.

### 5.2 `public.brand_assets` table — **Reuse**
Already matches the mockup's Assets-card requirements almost exactly
(logo/document/image/video/font/other typing, storage_path/public_url,
tags/usage_hints/alt_text metadata). Only a possible small addition (zip
MIME type allow-listing on the storage bucket, if zip attachments are truly
required) — not a structural change. The `brand_kit_id` FK already
correctly scopes assets to one kit, which is exactly the shape needed once
multiple kits exist per user (each asset still belongs to exactly one kit;
no fan-out ambiguity to resolve).

### 5.3 `brand_assets` storage bucket — **Reuse**
Real, provisioned, correctly RLS'd private bucket already covering every
asset type in the mockups except zip (minor allow-list addition if needed).
No reason to introduce a second bucket or migrate to `personal_assets`'
storage — **`personal_assets` (Library's table,
`20260625100000_personal_assets_table.sql`) is a conceptually different
thing** (generated/uploaded/post-sourced content assets for the content
library, explicitly scoped `source IN ('upload','generation','post')`) and
should **not** be conflated with brand reference assets (logos, brand
guideline docs). Keep them separate — this was an open question in the
task brief and the audit's answer is: do not merge these.

### 5.4 `BrandKitStore.js` (Zustand data layer) — **Refactor**
The Supabase access patterns (`uploadWithProgress` XHR upload, asset
CRUD, diff-modal state) are sound and worth keeping conceptually. But
`loadBrandKit`'s current behavior of silently `upsert`-creating an empty
`brand_kit` row for every user on first page load (`:106-109`) is
single-kit-shaped and must change to a "list kits, select/create one"
model. `saveBrandKit`'s hardcoded `{ onConflict: 'user_id' }` upsert
(`:169-172`) is the most direct casualty of the multi-kit schema change and
must be rewritten to upsert-by-`id` instead.

### 5.5 `brandKitLoader.js` (Studio-facing condenser) — **Refactor, high caution**
Logic (condensing kit + assets into a prompt string) is sound and should be
kept conceptually, but it currently assumes exactly one kit per user
(`.maybeSingle()` on `user_id`, `brandKitLoader.js:4-9`). Must be updated to
resolve an explicit "active kit for this user" before the multi-kit schema
ships, in coordination with whatever `SessionStore.js`/`generationPipeline.js`
expect. **This file is the literal bridge to a live, revenue-relevant
feature (content generation) — treat any change here as a breaking-change
review, not a routine refactor.**

### 5.6 `extractBrandKit` edge function + `brandKitConversation.js` — **Refactor**
Both need their output schema fixed to match `brand_kit`'s real columns
(§0 bug) regardless of anything else. The `extractBrandKit` function's PDF
text extraction is also naive (paren-scraping, `:93-103`) — worth
evaluating a real PDF-parsing approach as part of this refactor, especially
since the new mockups put more emphasis on the extraction flow ("Reading
Brand-Guidelines.pdf" progress screen) than the current build's UI alone
suggests. Net-new work needed on top of this refactor: a **new edge
function (or an extension of this one) for URL-based extraction**, since
none exists today (§0).

### 5.7 `BrandKitSetupChoice.jsx`, `BrandKitExtractLoader.jsx`, `BrandKitConversation.jsx`, `BrandKitReviewForm.jsx`, `AssetUploader.jsx`, `BrandKitDiffModal.jsx`, `BrandKitSaveWarning.jsx`, `BrandKitLivePreview.jsx` — **Refactor**
All eight are real, working, conceptually correct implementations of
screens the new mockups also want (setup-path chooser, extraction loader,
guided chat, 5-tab review form, asset uploader, diff/merge modal, save
warning, live preview). None should be thrown away. All eight need: (a) a
presentation-layer swap onto `ui-v2` primitives/tokens (same pattern as
Library/Calendar), and (b) targeted behavior changes to close the gaps in
§1.2 (4th setup path as a first-class option not a footer link, "draft
saves automatically" behavior, multi-kit awareness in the review form's
save/data-loading, URL-based diff trigger in addition to document-based).

### 5.8 `BrandKitDashboard.jsx` — **Refactor (more substantial than the others)**
Correct concept, but the mockup's dashboard is structurally different
enough (separate Voice/Guardrails/Visual Style/Assets cards, font-pair
display, kit switcher, "Re-import from site"/"New brand kit" actions) that
this is closer to a near-rewrite of the component than a light swap, even
though the underlying data source (one `brand_kit` row + its `brand_assets`)
is directionally the same data the new version needs (just queried
differently once multi-kit ships).

### 5.9 `BrandKitOnboardingModal.jsx` — **Needs a follow-up read before classification**
Confirmed to exist via grep but not read in full for this audit — it did
not appear anywhere in the 8-screen flow this audit traced through
`BrandKitPage.jsx`'s `renderScreen()`. Do not classify Reuse/Refactor/Remove
without first confirming what triggers it and whether it's still wired to
anything live.

### 5.10 Missing screens: empty/landing state, error state, signed-out guard, kit switcher — **New build, not a rebuild-from-existing-code item**
None of these have an existing component to refactor from:
- Empty "Build your brand kit" state with URL-import/"start from scratch" —
  net new.
- Dedicated full-screen error state ("Couldn't load your brand kit" / Try
  again / Contact support) — today's plain `error` banner
  (`BrandKitPage.jsx:222`) is the closest existing thing, but it's a
  presentational afterthought, not a screen; net new.
- Dedicated signed-out guard screen — today's behavior is an auto-redirect
  to `/login` (`BrandKitPage.jsx:51-54`), a different UX pattern than a
  same-page "Sign in to view your brand kit" guard with an on-page CTA; this
  is a product-behavior decision for the human (redirect vs. in-page guard),
  not just a visual rebuild.
- Kit switcher — blocked on the multi-kit schema change (§0/§5.1).

### 5.11 `src/styles/BrandKit.css` — **Refactor (replace)**
Own bespoke `--bk-*` token family per its own header comment. Same
category as Library's/Calendar's pre-ui-v2 stylesheets — superseded by a
future CSS Modules file on `--uiv2-*` tokens, following the exact pattern
`StudioPage.module.css`/`PersonalDashboardPage.module.css` already set.

---

## 6. Net-new work required (not present in any form today)

1. **Multi-kit account model** — schema change to `brand_kit` (relax
   `UNIQUE(user_id)`, add an active/default-kit concept), with **explicit
   coordination required with Studio's generation pipeline** (§4) before or
   alongside shipping. This is the single riskiest, most consequential item
   in the whole rebuild.
2. **Website-URL import/re-import edge function** — nothing today fetches
   or parses a live URL for brand extraction; only stored-document
   extraction exists. Needs a new edge function (fetch page HTML/metadata,
   parse into the same brand-kit field shape `extractBrandKit` produces,
   once that function's schema-drift bug is fixed).
3. **Structured font-pair fields** (display + body) — currently only
   free-text `typography_notes`; needs new columns (or a `jsonb` shape
   similar to `color_palette`) plus review-form UI.
4. **Dedicated empty/landing, error, and signed-out states** — none exist
   as first-class screens today (see §5.10).
5. **"Draft saves automatically" behavior** — the current review form only
   saves on explicit button click; if the mockup's automatic-draft-save
   note is meant literally, this is new debounced-autosave logic, not
   present anywhere in `BrandKitStore.js` today.
6. **Kit switcher UI** — depends on item 1.
7. **Zip MIME type on the `brand_assets` storage bucket allow-list** — small
   addition, only if zip attachments are truly required verbatim from the
   mockup.
8. **Fix the confirmed extraction schema-drift bug** (§0) — technically not
   "net new" but must be fixed regardless of which mockup screens are
   rebuilt first, since it silently corrupts every AI-assisted kit today.

---

## 7. Summary table

| Item | Classification | One-line reason |
|---|---|---|
| `public.brand_kit` table | Refactor | Columns ~90% match new spec; blocking issue is the `UNIQUE(user_id)` single-kit constraint, needs multi-kit model, high Studio-coupling risk |
| `public.brand_assets` table | Reuse | Already matches Assets-card requirements; FK-to-kit shape already correct for multi-kit |
| `brand_assets` storage bucket | Reuse | Real, RLS'd, correct MIME coverage except zip |
| `BrandKitStore.js` | Refactor | Sound patterns, but single-kit-shaped upsert/load logic must change |
| `brandKitLoader.js` (Studio bridge) | Refactor, high caution | Live production dependency for content generation; `.maybeSingle()` breaks under multi-kit |
| `extractBrandKit` edge function | Refactor | Confirmed schema-drift bug; naive PDF text extraction; needs URL-import capability added |
| `brandKitConversation.js` | Refactor | Same schema-drift bug as extractBrandKit |
| `BrandKitSetupChoice.jsx` | Refactor | Right concept, missing 4th first-class path, no empty/landing state before it |
| `BrandKitExtractLoader.jsx` | Refactor | Right concept, stage count/labels differ from mockup, needs ui-v2 swap |
| `BrandKitConversation.jsx` + `brandKitConversation.js` | Refactor | Real and working, needs ui-v2 swap + the schema-drift fix |
| `BrandKitReviewForm.jsx` | Refactor | Already matches the exact 5-tab structure; needs ui-v2 swap + multi-kit save path + optional autosave |
| `AssetUploader.jsx` | Refactor | Real and working, needs ui-v2 swap |
| `BrandKitDiffModal.jsx` | Refactor | Real and working, needs to also handle URL-sourced diffs, not just document-sourced |
| `BrandKitDashboard.jsx` | Refactor (substantial) | Right data, but mockup's card layout/kit-switcher is a near-rewrite |
| `BrandKitSaveWarning.jsx`, `BrandKitLivePreview.jsx` | Refactor | Small supporting components, ui-v2 swap only |
| `BrandKitOnboardingModal.jsx` | Unclassified — needs follow-up read | Not part of the traced 8-screen flow; unclear current role |
| `src/styles/BrandKit.css` | Refactor (replace) | Own bespoke `--bk-*` token family, same category as Library/Calendar's pre-ui-v2 CSS |
| Empty/landing state | New build | No existing equivalent |
| Full-screen error state | New build | Only a plain inline error banner exists today |
| Signed-out guard screen | New build | Today's behavior is an auto-redirect, not an in-page guard |
| Kit switcher | New build | Blocked on multi-kit schema change |
| Website-URL import/re-import | New build (new edge function) | No URL-fetch extraction path exists anywhere |
| Structured font-pair fields | New build (new column(s) + UI) | Only free-text `typography_notes` exists |
| `public.org_brand_kits` and its whole file tree | Out of scope, do not touch | Separate, already-shipped, unrelated feature — noted only to prevent collision |

**Counts:** Reuse = 2 (asset table, storage bucket), Refactor = 15
(1 table + 1 store + 1 Studio-bridge service + 2 extraction services + 8
screen components + 2 supporting components + 1 stylesheet), New build = 6,
Unclassified pending follow-up = 1, Out of scope = 1.

---

## 8. Open items for human attention

1. **The multi-kit schema change (§5.1) and its Studio coupling (§4) is the
   highest-priority decision for the human to make before any
   implementation starts.** Specifically: what does "active kit" mean for
   generation — most-recently-edited, explicitly marked default, or an
   explicit per-generation kit picker in Studio? This audit does not
   recommend an answer; it only confirms the current code has no such
   concept and needs one.
2. Confirm intent behind the mockup's "draft saves automatically" copy —
   literal debounced autosave (net-new), or just reassurance copy describing
   the existing "your data persists between the 5 tabs before final save"
   behavior (already true today, since `BrandKitReviewForm` keeps all tab
   data in one `form` state object across tab switches, `:319-346`)?
3. Confirm which of `content_restrictions` vs `avoid_visual_elements` (both
   currently exist, in different tabs) should map to the mockup's single
   "things to avoid" tag list under Visual Style — or whether both should
   surface, in which case the mockup's copy needs adjusting instead.
4. Confirm whether zip-file attachments are a hard requirement (small
   storage-bucket MIME allow-list change) or the mockup's "zip" mention was
   illustrative.
5. `BrandKitOnboardingModal.jsx` needs a follow-up read/trace before the
   rebuild scopes it in or out — not resolved by this audit.
6. Confirm whether the signed-out guard should change from the current
   auto-redirect-to-`/login` behavior to an in-page "Sign in to view your
   brand kit" guard screen as the mockup implies — this is a UX-pattern
   decision, not just a visual one.

---

**Awaiting human sign-off before any Remove classification is acted on.**
This audit contains **no Remove classifications** — every existing piece of
the current Brand Kit feature is either Reuse or Refactor, because the
current implementation is real, working, and largely spec-aligned already.
Nothing in this report has been deleted, edited, or moved — this is a
read-only audit and recommendation only. The multi-kit schema change (§5.1)
in particular should not proceed without explicit human sign-off given its
confirmed live coupling to Studio's content-generation pipeline (§4).
