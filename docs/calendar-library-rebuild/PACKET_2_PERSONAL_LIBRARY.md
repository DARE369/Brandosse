# Packet 2 — Personal Content Library (Rebuild)

Read `CLAUDE_CODE_BRIEF_MASTER.md` in full before this. Everything there applies here without exception.

## Objective
Replace the existing Personal Content Library page with a real implementation per `LIBRARY_SPEC.md`'s personal-scope behavior (no approval substate, single-owner scope, all three ingestion sources unified per §1).

## Phase 0 — `docs-auditor`
This packet has the most important open question in the whole project sitting in front of it: `LIBRARY_SPEC.md` §0/§13.1 — confirm what table `ensureLibraryRowsForPosts()` actually writes into today for the personal workspace. Do not proceed past this point until that's answered with certainty (read the actual service function, not just the spec's description of it). Produce the AS-IS audit and reuse/remove table, and make this finding the headline of that report.

## Phase 1 — `implementation-researcher`
Research: file upload + client-side validation patterns already used elsewhere in this codebase (e.g., however media gets attached in Generate Studio today — read it, don't modify it), perceptual-hash/duplicate-detection approaches that fit the stack, and how to structure the `assets` table (or confirm/extend whatever `ensureLibraryRowsForPosts()` already targets) per `LIBRARY_SPEC.md` §2.1's metadata schema.

## Phase 2 — Mockup
`library-ui-ux-designer` builds fluid, responsive mockups for: grid view, table view, the upload flow (including the duplicate-warning and async-AI-tagging-shimmer states from §5 and §11), the asset detail drawer with version history (§6.2), and the "Schedule" hand-off into the Calendar's Quick Post composer (§7 — this cross-link must be mocked as an actual click-through between the Library and Calendar mockup galleries, not described separately). Build a single `mockup-gallery.html`.

`design-system-compliance-agent` and `mobile-responsive-parity-agent` review every mockup. Pay particular attention here: grid-based asset browsing is one of the easiest UI patterns to get wrong on mobile (cards too small to tap accurately, metadata that requires horizontal scroll) — the parity agent should treat this packet as higher-risk than the calendar packet.

`qa-persona-agent` walks through, as **Solo Sade**: uploading an asset from her phone, confirming it got auto-tagged sensibly, and scheduling directly from it without ever opening AI Studio — at both mobile and desktop width.

## Gate
Stop here. Present everything together. Wait for explicit approval before Phase 3.

## Phase 3 — Implementation (post-approval only)
`feature-data-layer-builder` then `feature-frontend-builder`, strictly to the approved mockup. Flag rather than resolve: `LIBRARY_SPEC.md` §13.2 (whether a repurposing-suggestion deep-link into AI Studio is permitted now or deferred — it touches the boundary you've asked to leave alone).

## Phase 4 — Post-build QA
`qa-persona-agent` re-runs against the real build and reports divergence from the mockup.
