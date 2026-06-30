# Page: `/app/dashboard`

## Page Purpose (Plain Language)
This is the personal home screen. It shows KPI metrics, recent generations, quick actions, and connected account health.

## Route and Access Rules
- Route: `/app/dashboard`
- Access: authenticated user under `/app` protected shell.

## Component Composition
- `src/pages/Dashboard/UserDashboard.jsx`
- Shared shell: `UserNavbar`, `UserSidebar`
- Feature components:
  - `RealtimeKPICards`
  - `AccountHealthCard`
  - onboarding checklist and recent generation panel

## State, Hooks, Services
- Local state for stats/search/recent generation index.
- Uses `useAuth()` profile for user display and credits.
- Uses `useRealtimeKPIs` for real-time KPI cards.
- Direct Supabase queries in page component for dashboard aggregates.

## Data Contracts Touched
- Tables/views:
  - `generations`
  - `posts`
  - `sessions`
  - `connected_accounts_health_summary`
  - `profiles` (via KPI hook)
- Realtime channels:
  - `dashboard-realtime` channel on `generations`, `posts`, `connected_accounts`.
  - KPI hook channel on `generations`, `posts`, `profiles`.
- RPC/edge functions: none directly.

## Inbound Dependencies
- Post-auth routing lands users here by default for personal context.
- Search selection and quick actions from navbar/sidebar drive navigation to detail pages.

## Outbound Dependencies
- Navigate targets:
  - `/app/generate`
  - `/app/generate/:sessionId#generationId`
  - `/app/settings`
  - `/app/analytics` (alias redirect to `/app/calendar`)

## Current Working Relationships
- Dashboard reflects real-time generation/post/account changes.
- Recent generation click opens matching generate session and selected item.
- Account health card links to settings account management.

## Missing or Partial Relationships
- "View Analytics" quick action targets `/app/analytics`, which is currently alias redirect to calendar, not analytics module.
- Credits card uses profile credits but no breakdown timeline to explain credit changes.

## No Relation Exists Yet
- No direct relationship between dashboard KPI cards and a dedicated drill-down analytics page.

## Recommended Wiring Contract
- Replace alias analytics route with dedicated analytics page contract:
  - KPI source definitions
  - drill-down filters
  - attribution windows.

## Risks if Wired Incorrectly
- Alias replacement without preserving old route can break existing bookmarks and internal links.
- Incorrect KPI query semantics can produce conflicting numbers across dashboard and other pages.
