# Org Workspace Stage 1: Brand Kit Implementation

Updated: 2026-03-27  
Stage status: implemented  
Validation status: `npm run build` passed

## What was implemented

### 1. Brand kit schema and migration support

Added a Stage 1 compatibility-first migration:

- `supabase/migrations/20260327010000_org_brand_kit_stage1.sql`

This migration adds:

- `org_brand_kits`
- `org_brand_kit_editors`
- brand kit completeness + cached AI prompt generation
- backfill for existing `brand_projects`
- RLS for member reads and admin/editor access management

It also keeps the current repo stable by mirroring the org brand kit into the existing `brand_projects.brand_settings` contract instead of forcing an all-at-once replacement.

### 2. Stage 1 edge function

Added:

- `supabase/functions/org-brand-kit-upsert/index.ts`

This function now:

- verifies active org membership
- allows writes for org admins and granted brand kit editors
- upserts the org brand kit for the active brand project
- updates `last_edited_by`
- mirrors key fields into `brand_projects.brand_settings`
- returns the saved kit with computed completeness

### 3. Shared org helper updates

Updated:

- `supabase/functions/_shared/org.ts`
- `supabase/functions/_shared/org-bootstrap.ts`

Changes:

- added shared brand kit prompt builders/read helpers
- made org bootstrap create a default brand kit row for new orgs when the table exists
- made AI callers read from the new org brand kit prompt path first

### 4. AI integration

Updated:

- `supabase/functions/ai-org-chat/index.ts`
- `supabase/functions/ai-generate-brief/index.ts`
- `supabase/functions/ai-brand-consistency-check/index.ts`

Current behavior:

- AI functions prefer `org_brand_kits.ai_system_prompt`
- if the Stage 1 table is unavailable or no kit exists yet, they fall back to the older `brand_projects.brand_settings` structure

### 5. Org admin UI

Added:

- `src/org/admin/BrandKitPage.jsx`
- `src/org/services/brandKitService.js`
- `src/org/styles/BrandKit.css`

Updated:

- `src/router/router.jsx`
- `src/org/components/OrgSidebar.jsx`

Current UI behavior:

- new route: `/app/org/:orgId/admin/brand-kit`
- admins get a sidebar entry under the Admin section
- the page supports section-by-section editing for:
  - Brand Identity
  - Voice & Tone
  - Content Guidance
  - Visual Identity
  - Brand Assets context
- admins can manage brand kit editors from the same page

### 6. Member-facing read-only panel

Added:

- `src/org/components/BrandKitPanel.jsx`

Updated:

- `src/org/components/OrgGenerateComposer.jsx`

Current behavior:

- org members now see a collapsible read-only brand strip inside the org composer
- the panel shows brand name, completeness tone, tone descriptors, voice summary, content pillars, and prompt prefix

## What was intentionally left out

These items were not completed in Stage 1 because they belong to later stages or would require breaking the chosen stage order:

1. **Full Stage 0 foundation migration**
   - only the schema required for Stage 1 was added
   - the rest of the staged foundation remains for later work

2. **My Workspace dashboard integration**
   - the Brand Kit Panel was integrated into the org composer now
   - the member dashboard usage remains for Stage 6

3. **Non-admin sidebar discoverability for granted editors**
   - admins see the sidebar entry
   - granted editors can use the route and edit if authorized, but there is not yet a dedicated non-admin nav entry

4. **Automated test coverage beyond build validation**
   - production build passes
   - no dedicated Stage 1 automated test suite was added in this pass

## How the system works now

### Read path

- active org members can read the brand kit data for their current brand project
- the org composer panel reads the current brand kit and shows it in read-only form

### Write path

- org admins can edit all Stage 1 brand kit sections
- org admins can grant or revoke editor access
- granted editors can edit the brand kit through the Stage 1 save function

### AI path

- org AI workflows now centralize brand prompt lookup through the shared helper layer
- the new brand kit prompt cache is the preferred source
- legacy `brand_settings` remains populated for compatibility

## Stage 1 deviations from the original staged spec

These were deliberate and align with the repo’s current structure:

1. **Schema delivery**
   - the original staged spec expected Stage 0 to land before Stage 1
   - in this repo state, Stage 1 needed its own prerequisite schema slice to be functional

2. **Editor management UI**
   - the staged spec required editor permissions but did not define the admin control surface
   - a simple editor-access management card was added to make the permission model usable

3. **Compatibility-first mirroring**
   - the repo already relied on `brand_projects.brand_settings`
   - Stage 1 preserves that shape while moving the canonical source to `org_brand_kits`

## Validation completed

Executed:

```bash
npm run build
```

Result:

- success
- no build-breaking TypeScript/JSX/runtime import issues in the Stage 1 code path

## Next-stage dependency note

Stage 2 can proceed independently of the brand kit UI, but Stage 3 and Stage 6 will benefit from the Stage 1 brand kit prompt and member panel now being in place.
