# Workflow: Brand Kit Usage

## Current Implemented Flow
1. User visits `/app/settings/brand-kit`.
2. `BrandKitStore` upserts/loads `brand_kit` and `brand_assets`.
3. Setup options:
   - manual review form
   - conversational capture
   - document upload extraction flow
4. Generate workspace loads condensed brand kit via `brandKitLoader`.
5. Generation services pass brand kit context into generation and planning calls where supported.

## Expected Target Flow
- Brand kit should be consistently applied across all generation, caption, and scheduling contexts with transparent confidence and override behavior.

## Breakpoints and Gaps
- Document extraction backend is placeholder, reducing reliability of upload path.
- No explicit user-visible "brand context applied" diagnostics per generated asset/post.

## Required Integration Points
- Implement full extraction pipeline in `extractBrandKit`.
- Add generation-level metadata that records brand kit version/hash used.

## Suggested Implementation Order
1. Complete extraction backend contract.
2. Persist brand kit hash on generation/post creation.
3. Add UI badge/inspection for applied brand context and confidence.
