# Post and Generation Lifecycle Reference

Updated: 2026-03-02  
Scope: Week 1 canonical lifecycle closure

## Canonical Statuses

### Generation lifecycle (`GENERATION_STATUS`)
- `processing`
- `completed`
- `failed`

### Post lifecycle (`POST_STATUS`)
- `draft`
- `scheduled`
- `publishing`
- `published`
- `failed`

`archived` is intentionally removed from the active lifecycle domain.

## Allowed Transitions

### Generation
- `processing -> completed`
- `processing -> failed`
- `failed -> processing` (retry path)

### Post
- `draft -> scheduled`
- `draft -> published` (admin/post-now path)
- `scheduled -> publishing` (worker path)
- `publishing -> published`
- `publishing -> failed`
- `scheduled -> draft` (unschedule path)
- `failed -> scheduled` (reschedule path)

## Implementation Rules

1. Import canonical constants from `src/constants/statuses.js` in active flows.
2. Do not use raw lifecycle literals in status read/write queries.
3. UI copy should use `Published` (not `Posted`) for post terminal success state.
4. Any new lifecycle state requires:
- Constants update.
- DB domain update.
- UI badge/label update.
- Regression checklist update.

## Guardrail

Run:

```bash
npm run check:status-literals
```

This check fails when active Week 1 scope files introduce raw status literals in status queries/writes.
