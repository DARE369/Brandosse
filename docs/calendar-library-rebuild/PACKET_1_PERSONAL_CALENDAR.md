# Packet 1 — Personal Content Calendar (Rebuild)

Read `MASTER_BRIEF.md` (in this same directory) in full before this. Everything there applies here without exception, especially the rule against touching code before mockup approval and the rule against touching Dashboard/Generate Studio.

## Objective
Replace the existing Personal Content Calendar (sidebar item "Content Calendar," currently mocked/incomplete per `PERSONAL_WORKSPACE_SPEC.md` §5.4's stub note) with a real implementation, following `CALENDAR_SPEC.md` — specifically the personal-scope behavior described throughout that document (no pipeline overlay, Drafts rail instead of Approved-backlog rail, no approval gating on scheduling).

## Phase 0 — `docs-auditor`
Audit whatever currently exists at the Personal Calendar's route/component (locate it — it's linked from the sidebar even if the page itself is thin or stubbed). Specifically check: is there any existing calendar rendering code at all, anything related to the `scheduled_at` field on `posts`, or anything left over from the Generate Studio "coming soon" toast that should be referenced rather than duplicated. Produce the AS-IS audit and reuse/remove table per the master brief.

## Phase 1 — `implementation-researcher`
Research: calendar grid libraries already present as dependencies in this codebase (check before suggesting anything new), drag-and-drop libraries with verified touch support (this matters — see master brief §4), and how `generation_id`/grouping should work for multi-platform fan-out per `CALENDAR_SPEC.md` §2.2's flagged assumption — resolve that assumption here, against the real schema, before mockup work starts.

## Phase 2 — Mockup
`calendar-ui-ux-designer` builds fluid, responsive mockups (per master brief §4) for every state in `CALENDAR_SPEC.md` §10 (empty, loading, error, conflict, stale-write) plus: month view, list view, the Drafts rail open and collapsed, the post detail drawer, the Quick Post composer (§6.3 of the spec), and the schedule modal itself. Build a single `mockup-gallery.html` linking all of them.

`design-system-compliance-agent` and `mobile-responsive-parity-agent` review every mockup before it's presented.

`qa-persona-agent` walks through, as **Solo Sade** specifically (this packet's primary persona, since personal-workspace users skew toward fast, mobile, solo use): scheduling a draft from the Drafts rail, rescheduling by drag (and by the touch fallback), and creating a post via Quick Post end-to-end — at both mobile and desktop width.

## Gate
Stop here. Present the mockup gallery, the parity report, the compliance report, and the persona walkthrough together. Wait for explicit approval before Phase 3.

## Phase 3 — Implementation (post-approval only)
`feature-data-layer-builder` then `feature-frontend-builder`, scoped strictly to what the approved mockup shows. Flag (don't silently resolve) the two open items from `CALENDAR_SPEC.md` §13: whether to wire Generate Studio's stub button (touches AI Studio — needs separate sign-off) and who owns bulk-delete permission for scheduled posts.

## Phase 4 — Post-build QA
`qa-persona-agent` re-runs the same walkthrough against the real build, not the mockup, and reports any divergence.
