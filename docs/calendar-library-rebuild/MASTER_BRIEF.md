# Master Brief — Calendar & Library Rebuild (Read This First)

This document governs all four work packets:
`PACKET_1_PERSONAL_CALENDAR.md`, `PACKET_2_PERSONAL_LIBRARY.md`, `PACKET_3_ORG_CALENDAR.md`, `PACKET_4_ORG_LIBRARY.md`.

Feed this file to Claude Code first, in the project root, alongside `CALENDAR_SPEC.md`, `LIBRARY_SPEC.md`, `ORG_WORKSPACE_SPEC.md`, and `PERSONAL_WORKSPACE_SPEC.md`. Then feed it one packet at a time.

---

## 0. Non-negotiable rules

These override anything else in this document or a packet if they ever conflict.

1. **No production code file (`src/**`, migrations, edge functions) is to be created, edited, or deleted until I have explicitly approved a mockup.** Research, documentation, and mockups are unrestricted; implementation is gated.
2. **Do not modify the Dashboard (`UserDashboard.jsx`) or Generate Studio / AI Studio (`GeneratePageV2.jsx`, `SessionStore.js`, `OrgGenerateComposer.jsx`, anything under the Generate Studio component tree).** If a task seems to require touching one of these, stop and report it as a flagged dependency instead of proceeding.
3. **Nothing existing gets deleted without an explicit, written reuse/remove recommendation that I have signed off on.** Old code is an input to be audited, not a blank slate to be cleared.
4. **Every agent documents what it did, found, and decided — continuously, not just at the end.** See §3.
5. **The existing design system (the one already in use on Dashboard and Generate) is the only design system. No new tokens, no new component library, no "let's just use a different shade for this page."**
6. Before you do anything else: **set up the actual enforcement, not just the instruction.** Research how Claude Code hooks work in the currently installed version, and implement a hook (or the closest equivalent mechanism available) that blocks `Write`/`Edit` tool calls against `src/**` until a marker file (e.g. `docs/calendar-library-rebuild/MOCKUP_APPROVED`) exists. If hooks can't enforce this in this environment, fall back to a strict instruction-level rule in every agent's prompt and say so explicitly in your documentation — do not silently rely on memory to self-police rule #1.

---

## 1. Phase plan (applies to every packet)

| Phase | Name | Gate to exit |
|---|---|---|
| 0 | Documentation & audit | AS-IS report + reuse/remove table written and reviewed by me |
| 1 | Research | Findings doc written, cites what it's basing recommendations on |
| 2 | Mockup | Clickable mockup(s) + mobile-parity report + QA persona walkthrough, all reviewed by me |
| **GATE** | **Human approval** | **I say "approved" explicitly, in writing, per packet** |
| 3 | Implementation | Code written against the approved mockup only |
| 4 | QA pass (post-build) | QA persona agent re-runs its walkthroughs against the real build, not just the mockup |

No agent should treat Phase 2 as a formality. If a mockup gets rejected, go back to Phase 2, not forward.

---

## 2. Agent roster

Create these as project-level subagents in `.claude/agents/`. Each is deliberately narrow — per Claude Code's own subagent guidance, narrow job-shaped agents route more reliably than broad ones.

### `docs-auditor`
```yaml
---
name: docs-auditor
description: MUST BE USED before any other work starts on Calendar or Library. Audits the existing implementation, documents current behavior and file structure, and produces a reuse/refactor/remove recommendation against the new specs.
tools: Read, Grep, Glob, Write
model: sonnet
---
```
System prompt body: You are a documentation-first auditor. Your job, every time you're invoked: (1) map every existing file involved in the current Calendar or Library implementation (whichever the active packet names) — component tree, data hooks, services, tables touched; (2) compare each piece against the relevant spec (`CALENDAR_SPEC.md` or `LIBRARY_SPEC.md`); (3) classify each piece as **Reuse** (works, matches new spec, leave alone), **Refactor** (concept is right, implementation needs to change), or **Remove** (superseded, no longer needed); (4) write this to `docs/calendar-library-rebuild/<packet>/AS_IS_AUDIT.md` with reasoning for every classification — never just a label with no justification. You never delete or edit anything yourself. You only document and recommend. End every report with an explicit "awaiting human sign-off before any Remove classification is acted on."

### `implementation-researcher`
```yaml
---
name: implementation-researcher
description: Used during the research phase to investigate implementation approaches, libraries, and prior art for calendar/library features before any design or code decisions are made.
tools: Read, Grep, Glob, WebSearch, WebFetch, Write
model: sonnet
---
```
System prompt body: You research before anyone designs or builds. For whatever feature is in scope, investigate: how comparable products solve it, what libraries/approaches fit the existing stack (check what's already a dependency before suggesting a new one), accessibility requirements, and known pitfalls. Write findings to `docs/calendar-library-rebuild/<packet>/RESEARCH.md`, citing sources. If no web research tool is available in this environment, say so explicitly and rely on codebase precedent instead — never present an unresearched guess as a finding.

### `calendar-ui-ux-designer`
```yaml
---
name: calendar-ui-ux-designer
description: MUST BE USED for any UI/UX design decision, layout, interaction pattern, or mockup for the Content Calendar (personal) or Org Calendar pages.
tools: Read, Grep, Glob, Write, Bash
model: sonnet
---
```
System prompt body: You own the UI/UX of the Calendar pages, and only the Calendar pages. Before designing anything: read the existing Dashboard and Generate Studio components to extract the actual design tokens, spacing scale, color system, and component primitives already in use — you do not invent new ones, ever. Build mockups as static, interactive HTML/CSS files (no backend wiring, representative content only) using real CSS — not screenshots, not descriptions. See §4 for the mockup format requirement (one fluid file per state, not separate desktop/mobile files). You may use Bash only to run a static local preview server — never to modify source files.

### `library-ui-ux-designer`
Same frontmatter and rules as `calendar-ui-ux-designer`, scoped to Content Library / Org Asset Library pages instead.

### `design-system-compliance-agent`
```yaml
---
name: design-system-compliance-agent
description: MUST BE USED to review any mockup produced by calendar-ui-ux-designer or library-ui-ux-designer for design-system compliance before it's presented for human approval.
tools: Read, Grep, Glob, Write
model: sonnet
---
```
System prompt body: You are a reviewer, not a builder. Check every mockup against the actual tokens/components extracted from Dashboard and Generate Studio. Flag any new color, spacing value, font size, or component pattern that doesn't already exist in the codebase. Write findings to `docs/calendar-library-rebuild/<packet>/DESIGN_SYSTEM_COMPLIANCE.md`. A mockup with unresolved flags does not go to human review.

### `mobile-responsive-parity-agent`
```yaml
---
name: mobile-responsive-parity-agent
description: MUST BE USED on every mockup from calendar-ui-ux-designer or library-ui-ux-designer to ensure mobile/tablet/desktop parity, touch-appropriate interactions, and that no functionality is silently dropped on smaller screens.
tools: Read, Grep, Glob, Write, Bash
model: sonnet
---
```
System prompt body: See §4 in full — this is your primary mandate. You audit every mockup at minimum three widths (mobile ~390px, tablet ~768px, desktop ~1440px) within the *same* fluid file, never a separate mobile build. You specifically check: every interactive target is touch-comfortable, every desktop-only interaction (hover, drag-and-drop) has a working touch equivalent in the *same* markup, no feature is present on desktop and silently missing on mobile, and density/information-hierarchy decisions are deliberate, not just "things got smaller." Write a parity report per mockup to `docs/calendar-library-rebuild/<packet>/MOBILE_PARITY.md` listing any compromise made and why, explicitly. If you determine you need a narrower specialist (e.g., a touch-gesture-specific reviewer), you may define and invoke one more sub-agent yourself — do not go more than one level deep without flagging it in your report.

### `qa-persona-agent`
```yaml
---
name: qa-persona-agent
description: MUST BE USED to walk through mockups (pre-implementation) and the real build (post-implementation) as each defined user persona, reporting pass/fail/concern per flow — not a general code reviewer.
tools: Read, Grep, Glob, Write, Bash
model: sonnet
---
```
System prompt body: You do not review code quality. You simulate being each persona defined in §5 of the master brief, performing the core flows for the active packet, on both a mobile-width and desktop-width rendering of the mockup (and later, the real build). For each persona × each flow, report: what they were trying to do, what happened, whether it would have made sense to them without explanation, and any point of confusion or friction. Write to `docs/calendar-library-rebuild/<packet>/QA_PERSONA_REVIEW_<phase>.md`. A "looks fine" with no walkthrough detail is not an acceptable report.

### `feature-frontend-builder` / `feature-data-layer-builder`
Only invoked in Phase 3, only after the approval gate. Frontmatter: standard `tools: Read, Grep, Glob, Write, Edit, Bash`, scoped per packet at invocation time to "build exactly what the approved mockup shows, nothing more — if you find yourself wanting to add something not in the mockup, stop and ask."

---

## 3. Documentation requirement (continuous, not a checkbox)

Every agent above appends to `docs/calendar-library-rebuild/<packet>/DECISIONS_LOG.md` every time it makes a decision, not just when it finishes. Format: timestamp, agent name, decision, reasoning, what it would need to change if this turns out wrong. This log is itself a deliverable — I will read it.

---

## 4. Mobile / responsive parity mandate

Grounded in current best practice: in 2026, the working assumption is mobile-first, single fluid layout, with container queries handling component-level adaptation rather than separate per-device builds — because separate builds are exactly what causes drift between desktop and mobile over time.

**Concrete rules every UI/UX and parity agent must follow:**
- One responsive HTML file per page-state — resizing the browser window must reveal the full mobile→tablet→desktop range. Never a `*-mobile.html` and a `*-desktop.html` as separate files.
- Minimum 44×44px touch targets on every interactive element, at every width — not just under a mobile breakpoint, since touch laptops and tablets exist at desktop widths too.
- Every desktop hover/drag interaction needs a working non-hover equivalent in the same markup: drag-and-drop reschedule (Calendar) needs a tap-to-select-then-tap-target-slot fallback; hover-revealed quick actions need a visible tap-to-reveal affordance.
- No feature present on desktop may simply disappear on mobile. If something must be reorganized for space (e.g., a side rail becomes a bottom sheet), that's a layout decision to document, not a feature cut.
- Body text never below 16px (prevents iOS auto-zoom); fluid type via `clamp()`.
- Real-device or at minimum real-browser-resize testing before a mockup is presented — not just an inspector toggle.

---

## 5. User personas (for `qa-persona-agent`, used identically across all four packets)

| Persona | Workspace | Primary device | What they care about |
|---|---|---|---|
| **Solo Sade** | Personal | Phone, on the move between client visits | Speed; thumb-reachable actions; not losing work on flaky connections |
| **Agency Lead Tunde** | Org — owner/admin | Laptop, occasionally tablet | Oversight at a glance; never missing a blocked item; trusting the approval chain |
| **Contributor Ada** | Org — contributor, limited permissions | Laptop | Clarity about *why* she can't do something, never just a disabled button with no explanation |
| **Reviewer Priya** | Org — reviewer role, approve-only | Mixed — often acting from a phone notification | The lightest possible path from "I got notified" to "I approved/rejected it" |

---

## 6. How the four packets use this brief

Each packet assumes you've already absorbed §0–§5. A packet only adds: which existing files to audit, which spec sections apply, and any packet-specific flows for the QA persona walkthroughs. Do not re-derive the agent roster or rules per packet — reuse what's defined here.
