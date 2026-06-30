# Platform Admin Page: Analytics

## Page Purpose (Plain Language)
This page shows operational analytics for admin teams: active-user bands, generation and publish throughput, quality-score distribution, connected-account mix, and organization-level output.

## Route and Access Rules
- Route: `/app/admin/analytics`
- Parent guard: `<ProtectedRoute requireAdmin>`
- Scope behavior:
  - super admin: cross-platform aggregation
  - org admin: restricted to users in `adminAccess.organizationId`

## Component Composition
- Container: `src/admin/pages/AdminAnalyticsPage.jsx`
- Major blocks:
  - KPI cards
  - activity bands chart
  - quality distribution pie
  - platform distribution list
  - organization leaderboard
  - platform API placeholder cards

## State, Hooks, Services Used
- React state:
  - `loading`
  - `data` object (`kpis`, `activityBands`, `qualityDistribution`, `platformDistribution`, `leaderboard`)
- Data flow:
  - one `useEffect` loading pipeline with multi-table Supabase queries
- Helpers:
  - `inferActivityStatus` to normalize user activity buckets

## Data Contracts Touched
- Tables read:
  - `profiles`
  - `generations`
  - `posts`
  - `connected_accounts`
  - `content_quality_reviews`
  - `organizations`
- Writes:
  - none
- Realtime:
  - none

## Inbound Dependencies
- Entered from admin sidebar.
- Depends on admin scope in outlet context for org filtering.

## Outbound Dependencies
- None currently; page is read-only summary.

## Current Working Relationships
- KPI and chart data are derived from live internal tables.
- Activity bands use inferred activity status when explicit status is missing.
- Quality distribution is score-bucketed from `content_quality_reviews`.

## Missing or Partial Relationships
- No date-range controls; analytics window is implicit and table-wide.
- Organization leaderboard computes from current profile-org mapping only.
- External platform cards are placeholders and do not use platform API ingestion.

## No Relation Exists Yet
- No relation to `platform_analytics` table despite schema support.
- No relation from chart segments to filtered drill-down routes in logs/users/moderation.

## Recommended Wiring Contract
- Introduce explicit analytics source tags in UI (`live`, `derived`, `mock`, `unavailable`).
- Add global date-window contract and pass it to every metric query.
- Wire platform cards to `platform_analytics` with scope-safe org/user filters.

## Risks If Wired Incorrectly
- Mixing mock and live metrics without source labels can mislead decision-making.
- Aggregating without strict tenant boundaries can expose cross-org performance data.
- Drift between score bucket logic and moderation logic can produce conflicting quality narratives.
