# Mobile + Tablet Layout Contract

## Supported Width Ranges

- `0-599px` phone
- `600-899px` large phone / small tablet
- `900-1199px` tablet (portrait + landscape)
- `1200px+` desktop

## Panel Behavior Rules

- Generate workspace:
  - `1200px+`: canvas is primary, session rail + post panel are side overlays.
  - `<1200px`: session rail width scales down; post panel narrows before full-screen.
  - `<900px`: post panel is full-width drawer; settings row scrolls horizontally (no clipping).
- Calendar hub:
  - `1200px+`: drafts panel is docked on the left.
  - `<1180px`: drafts panel becomes a drawer; calendar remains the primary pane.
  - `<900px`: drag-and-drop is disabled; tap-to-reschedule is the supported interaction.
- Admin control plane:
  - `1200px+`: sidebar is docked.
  - `<1024px`: sidebar is off-canvas with backdrop.
  - `<900px`: moderation and analytics tables switch to compact/stacked behavior.

## Workflow Accessibility Guarantees

- All schedule actions are reachable without drag-and-drop.
- Modal flows (schedule, bulk schedule, publication, edit) remain usable at `320px` width.
- Focusable controls are keyboard reachable after responsive reflow.
- No critical action is hidden behind hover-only affordances.

## Do / Don't for Future UI Changes

- Do prefer `minmax(0, 1fr)`, `min-width: 0`, and scrollable inner regions over fixed panel widths.
- Do treat side panels as drawers below tablet landscape.
- Do keep action labels visible or provide explicit icon button `aria-label`s.
- Don't add fixed `width` + `min-width` pairs for primary layout columns below desktop.
- Don't rely on drag-and-drop as the only path for scheduling.
