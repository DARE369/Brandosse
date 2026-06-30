# Page: `/app/settings/brand-kit`

## Page Purpose (Plain Language)
This page configures a user's brand identity so generation outputs follow brand voice, guardrails, and visual style.

## Route and Access Rules
- Route: `/app/settings/brand-kit`
- Access: authenticated user under protected app shell.

## Component Composition
- `src/pages/Settings/BrandKitPage.jsx`
- Shared shell: `UserNavbar`, `UserSidebar`
- Screen states:
  - setup choice
  - extraction loader
  - conversational capture
  - review form
  - dashboard
  - diff modal for update merges

## State, Hooks, Services
- Primary store: `BrandKitStore` (`loadBrandKit`, `saveBrandKit`, asset CRUD, diff flow).
- Supporting services:
  - `brandKitLoader` for condensed generation context
  - `brandKitConversation` for conversational extraction prompt schema.

## Data Contracts Touched
- Tables:
  - `brand_kit`
  - `brand_assets`
- Storage:
  - bucket `brand_assets`
- Edge function:
  - `extractBrandKit`
- Realtime channels: none.

## Inbound Dependencies
- Sidebar and generate onboarding nudges route users to this page.
- Generate page loads brand kit context produced here.

## Outbound Dependencies
- Saved brand kit influences generation behavior through `brandKitLoader` and generation service payloads.
- Brand kit completion status changes sidebar indicators and onboarding prompts.

## Current Working Relationships
- End-to-end manual and conversational setup flows are wired.
- Asset uploads and metadata updates are wired through store.
- Diff merge flow for "upload updated document" path is wired at UI level.

## Missing or Partial Relationships
- `extractBrandKit` edge function currently returns fallback scaffold, not real extracted document intelligence.
- No clear generation-level trace showing which brand kit version was applied.

## No Relation Exists Yet
- No relation from brand kit dashboard to downstream post performance/quality analytics.

## Recommended Wiring Contract
- Implement full extraction backend while preserving response contract:
  - `brandKit`
  - `confidenceMap`
  - `missingTier1Fields`
- Persist and surface brand kit hash/version on generation rows for traceability.

## Risks if Wired Incorrectly
- Inconsistent extraction schema can break review form and diff modal.
- Over-trusting inferred extraction without confidence controls can degrade brand safety.
