# Setup Log — Calendar & Library Rebuild Infrastructure

This covers the one-time setup done before any packet work (Master Brief §0 rule 6, §2). Packet-specific decisions belong in `docs/calendar-library-rebuild/<packet>/DECISIONS_LOG.md`, not here.

## 1. Enforcement mechanism (Master Brief §0 rule 6)

**Outcome: real hook-based enforcement was implemented and verified working — no fallback to instruction-level-only enforcement was needed.**

- Researched the hooks system for the installed Claude Code version via the `update-config` skill, which surfaced the full settings/hooks JSON schema for this install.
- Mechanism: a `PreToolUse` hook matched on `"Write|Edit"`, implemented as a Node script: [.claude/hooks/block-prod-code-until-mockup-approved.js](../../.claude/hooks/block-prod-code-until-mockup-approved.js).
  - Reads `tool_input.file_path` from stdin JSON.
  - If the path falls under `src/**`, `supabase/migrations/**`, or `supabase/functions/**` AND `docs/calendar-library-rebuild/MOCKUP_APPROVED` does not exist, it returns `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` — the current (non-deprecated) PreToolUse deny mechanism in this version.
  - Otherwise exits 0 with no output, deferring to normal permission flow.
- Wired into [.claude/settings.json](../../.claude/settings.json) (project-level, committed — this gate is part of the project's process, not a personal preference).
- **Verified end-to-end, not just unit-tested**: a real `Write` tool call to `src/__hook_test__.tmp.js` was attempted and denied with the expected reason. A real `Write` to `docs/calendar-library-rebuild/__hook_test__.tmp.md` succeeded (then both throwaway files were removed). A pipe-test of the raw script also confirmed `supabase/migrations/**` is blocked the same way.

### Scope characteristic and re-gating decision

The gate is **repo-wide**, not scoped to calendar/library files specifically: while `MOCKUP_APPROVED` is absent, **no** `Write`/`Edit` to `src/**`, `supabase/migrations/**`, or `supabase/functions/**` will succeed via Claude Code — including unrelated work elsewhere in Brandosse. This is what the brief literally specifies (a single marker file gating those three trees).

**Decision (confirmed with the human 2026-06-23): re-gate per packet.** After a packet's Phase 3 implementation is complete, the marker file is deleted so the next packet starts re-gated. The human creates `docs/calendar-library-rebuild/MOCKUP_APPROVED` only after explicitly approving that packet's mockup — once per packet. Whichever agent/orchestrator closes out a packet's Phase 3 is responsible for deleting the marker afterward before the next packet's Phase 0 begins.

## 2. Agent roster (Master Brief §2)

All 9 roster agents created in `.claude/agents/` exactly as specified, with explicit `tools:` lines (this repo's other agents omit `tools:` and default to all tools — these are deliberately restricted per the brief, e.g. `docs-auditor` has no `Edit`/`Bash` so it cannot act on its own Remove recommendations):

- `docs-auditor` — Read, Grep, Glob, Write
- `implementation-researcher` — Read, Grep, Glob, WebSearch, WebFetch, Write
- `calendar-ui-ux-designer` — Read, Grep, Glob, Write, Bash
- `library-ui-ux-designer` — Read, Grep, Glob, Write, Bash
- `design-system-compliance-agent` — Read, Grep, Glob, Write
- `mobile-responsive-parity-agent` — Read, Grep, Glob, Write, Bash
- `qa-persona-agent` — Read, Grep, Glob, Write, Bash
- `feature-frontend-builder` — Read, Grep, Glob, Write, Edit, Bash (Phase 3 only)
- `feature-data-layer-builder` — Read, Grep, Glob, Write, Edit, Bash (Phase 3 only)

All carry `model: sonnet` (not specified for the two Phase 3 builders in the brief; set to sonnet for consistency with the rest of the roster — flag if you want a different model for implementation work).

## 3. Master brief persisted

The pasted brief is saved at `docs/calendar-library-rebuild/MASTER_BRIEF.md` so it survives as a stable reference rather than living only in chat history.

## 4. Gaps found (not yet resolved)

- `CALENDAR_SPEC.md` and `LIBRARY_SPEC.md` (referenced throughout the brief and required by `docs-auditor`) do not exist anywhere in the repo yet. Only `docs/PERSONAL_WORKSPACE_SPEC.md` and `docs/ORG_WORKSPACE_SPEC.md` exist (both explicitly say Calendar/Library are "documented separately").
- No `PACKET_1_PERSONAL_CALENDAR.md` / `PACKET_2_PERSONAL_LIBRARY.md` / `PACKET_3_ORG_CALENDAR.md` / `PACKET_4_ORG_LIBRARY.md` exist yet — expected, since the brief says these get fed one at a time after this setup.
