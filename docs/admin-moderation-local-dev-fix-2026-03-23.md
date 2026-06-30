# Admin Moderation Local Dev Fix

Date: 2026-03-23

## Summary

The admin moderation page broke for three related reasons:

1. The `admin-list-posts` edge function was not available on the remote Supabase project, so browser requests to:

`https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/admin-list-posts`

were failing during preflight with a `404 Not Found`.

2. When that request failed, the React workspace component fell back to a fresh empty array on every render. Two `useEffect` blocks then kept calling `setState` even though nothing had actually changed, which caused the `Maximum update depth exceeded` loop.

3. After local fallback querying was restored, the moderation filters were still forwarding the UI sentinel value `"all"` into UUID database filters. Postgres rejected that with `invalid input syntax for type uuid: "all"`.

No database migration was required for these fixes.

## What Happened

### Edge function failure

The browser showed a CORS error, but the underlying problem was not bad CORS headers in the repo code. A direct `OPTIONS` check against the function URL returned:

- Status: `404 Not Found`
- Body: `{"code":"NOT_FOUND","message":"Requested function was not found"}`

That means the remote project does not currently have `admin-list-posts` deployed at that route.

### React render loop

In `src/admin/pages/AdminModeration/AdminModerationWorkspace.jsx`, these effects were updating state every time `rows`/`groups` changed:

- `setSelectedIds(...)`
- `setExpandedGroups(...)`

When the request failed, `rows` was resolving to a new empty array literal on every render. That made the effects run repeatedly, and each effect returned a new array/object even when the visible state was still empty, which created the infinite update loop.

### Filter normalization bug in fallback mode

The moderation UI uses `"all"` as a dropdown sentinel for filters like user and organization.

That value should never reach the database layer. The edge-function request path already stripped `"all"` while building URL query params, but the direct Supabase fallback path was reusing the raw filter object. That allowed fallback code to generate UUID comparisons like:

- `.eq("organization_id", "all")`
- `.eq("id", "all")`

Because those columns are UUIDs, Postgres correctly rejected the value and surfaced the `invalid input syntax for type uuid: "all"` error shown in the table.

## What I Changed

### 1. Stopped the render loop

Updated `src/admin/pages/AdminModeration/AdminModerationWorkspace.jsx` to:

- use a stable empty list fallback instead of a fresh `[]` every render
- return the existing `selectedIds` state when filtering does not actually remove anything
- return the existing `expandedGroups` object when no new groups were added

This prevents no-op state writes from retriggering the component forever.

### 2. Restored local-dev fallback behavior

Updated `src/admin/pages/AdminModeration/moderationApi.js` to treat browser-level fetch/CORS/network failures as edge-function-unavailable errors for this admin-posts request path.

That allows the existing direct-Supabase fallback query path to run in local development when the edge function is missing or unreachable, instead of failing hard before JavaScript can inspect the HTTP response.

### 3. Added a one-time warning

The fallback now logs a one-time console warning so the next developer can see that the app is running without the `admin-list-posts` edge function.

### 4. Normalized filter values before fallback queries

Updated `src/admin/pages/AdminModeration/moderationApi.js` so moderation filters are sanitized once before they are used anywhere.

The request layer now:

- trims string inputs
- removes empty strings
- removes `"all"` sentinel values

The same sanitized query object is now used for both the edge-function request and the direct Supabase fallback path, which keeps behavior consistent and prevents invalid UUID filters.

## Files Changed

- `src/admin/pages/AdminModeration/AdminModerationWorkspace.jsx`
- `src/admin/pages/AdminModeration/moderationApi.js`
- `docs/admin-moderation-local-dev-fix-2026-03-23.md`

## Verification

The frontend build completed successfully after the fix with:

`npm run build`

The remaining build output was only the existing large-chunk warning, not a syntax or runtime failure.

## Deployment Follow-Up

If you want the moderation page to use the intended edge function in hosted environments, deploy the missing function:

```bash
supabase functions deploy admin-list-posts
```

If this project depends on other admin edge functions that are still local-only, deploy those too.

## Why No SQL Migration Was Needed

This incident was caused by:

- a client-side state management bug
- a missing edge function deployment
- an API-layer filter normalization bug

It was not caused by a schema mismatch, missing column, broken index, or RLS policy regression inside Postgres. Because of that, no new migration was necessary.

## How To Avoid This Next Time

1. Never call `setState` inside an effect unless you return the previous state object when nothing changed.
2. Avoid inline empty-array and empty-object fallbacks for effect dependencies. Prefer stable shared constants when the empty value is part of dependency-driven logic.
3. Treat browser CORS errors carefully during local dev. A CORS message often hides the real problem, such as `404`, `401`, or an undeployed function.
4. For new edge-function-backed pages, keep a documented fallback path for local development when practical.
5. Never allow UI sentinel values like `"all"` or `""` to flow directly into typed database filters. Normalize them once in the request layer and reuse the sanitized object everywhere.
6. Add a release checklist item for new edge functions:
   - implement function
   - deploy function
   - verify `OPTIONS` and main request path
   - verify the frontend route against the deployed project
7. When a function is required in production, consider adding a health check or startup verification doc/checklist so missing deployments are caught before manual QA.
