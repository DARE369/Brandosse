# Stage 7 - Calendar Density + Timeline Readability

## Summary
Stage 7 focuses on operational UX polish for the org calendar surfaces:

1. Reduced calendar card density in month and week views.
2. Fixed week-view card spacing and visual rhythm.
3. Improved timeline lane spacing and text overflow handling.
4. Stabilized calendar filter layout so controls no longer break into awkward flex lines.

This stage is a usability pass on top of the Stage 6 workflow features.

## Files Added
- `docs/STAGE_7_README.md`
- `docs/STAGE_7_IMPLEMENTATION_REPORT_2026-04-08.md`

## Files Modified
- `src/org/pages/OrgCalendar.jsx`
- `src/org/components/calendar/CalendarContentCard.jsx`
- `src/org/components/calendar/CalendarTimelineView.jsx`
- `src/org/styles/OrgCalendar.css`

## Database Changes
- Migration: none in Stage 7.
- RLS changes: none in Stage 7.

## Tables Used (read path)
- `public.posts`
- `public.pipeline_items`
- `public.pipeline_configs`
- `public.organization_members`
- `public.org_tasks`

## How to verify this stage is working

### Step 1 - Month view is less dense
1. Open org calendar in `Master Calendar`.
2. Inspect day cells with many items.

Expected:
- Each day shows up to 3 compact cards (previously more).
- Cards prioritize title readability.
- Overflow uses `+N more`.

### Step 2 - Week view spacing and card readability
1. Switch to `Week` view.
2. Inspect multiple scheduled cards in one day.

Expected:
- Cards use cleaner week-style layout (title + lightweight metadata).
- Better spacing/padding between cards and sections.
- Reduced visual clutter versus full ops cards in weekly stack.

### Step 3 - Timeline readability
1. Switch to `Timeline` view with many records.
2. Scroll across lanes.

Expected:
- Bars have more vertical breathing room.
- Title/meta text truncates cleanly instead of overlapping.
- Day grid spacing is easier to scan.

### Step 4 - Filter layout behavior
1. Open filter popover.
2. Resize screen from desktop to tablet/mobile widths.

Expected:
- Filter controls align in a grid (3 -> 2 -> 1 columns by breakpoint).
- No awkward single-control flex wrapping.

## Known limitations / follow-up
- Month view intentionally hides additional items after 3 to reduce density; users still access full details via `+N more`.
- Timeline remains an approximation lane view and not a strict per-minute scheduler.
