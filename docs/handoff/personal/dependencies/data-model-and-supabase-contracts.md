# Personal Workspace Data Model and Supabase Contracts

## Purpose
This document lists the personal workspace data contracts by feature, including tables, views, RPCs, edge functions, and realtime channels currently used by Stage 1 pages/workflows.

## Identity and Access
### Tables
- `profiles`
- `admin_roles`
- `organization_members`
- `organizations`
- `context_last_used`

### RPC
- `write_audit_log` (best-effort from auth context)

### Caller Surface
- `src/Context/AuthContext.jsx`
- `src/services/authService.js`
- `src/org/services/orgService.js`

## Generation and Post Lifecycle
### Tables
- `sessions`
- `generations`
- `content_plans`
- `posts`
- `content_library_items`
- `connected_accounts`
- `org_post_asset_links` (only when org runtime context exists in generate flow)

### Edge Functions
- `generateImage`
- `editImage`
- `generateVideo`
- `videoStatus`
- `generateCarouselPlan`
- `enhance-prompt`
- `mock-publish`

### Realtime
- Channel: `generations_updates` (table `generations`)
- Cross-page browser event: `socialai:data-sync`

### Caller Surface
- `src/stores/SessionStore.js`
- `src/pages/GeneratePage/GeneratePageV2.jsx`
- `src/services/freepik.service.js`
- `src/services/platforms/mockPublishService.js`
- `src/services/platforms/mockPublishWorkflow.js`

## Dashboard and KPI
### Tables/Views
- `generations`
- `posts`
- `sessions`
- `connected_accounts_health_summary`
- `profiles` (credits in KPI)

### Realtime
- Dashboard channel on:
  - `generations`
  - `posts`
  - `connected_accounts`
- KPI hook channel on:
  - `generations` filtered by user
  - `posts` filtered by user
  - `profiles` filtered by user

### Caller Surface
- `src/pages/Dashboard/UserDashboard.jsx`
- `src/components/Dashboard/RealtimeKPICards.jsx`
- `src/hooks/useRealtimeKPIs.js`

## Calendar
### Tables
- `posts`
- `ghost_slots`
- `content_pillars`
- `calendar_settings`
- `optimal_posting_times`
- `media_assets` (library-to-calendar modal)
- `connected_accounts` (library-to-calendar modal posting target selection)

### RPC
- `get_best_posting_time`

### Realtime
- Channel: `calendar_updates` on `posts` and `ghost_slots`

### Caller Surface
- `src/stores/CalendarStore.js`
- `src/pages/CalendarPage/CalendarPageV2.jsx`
- `src/pages/CalendarPage/components/SelectFromLibraryModal.jsx`

## Library
### Tables
- `posts`
- `media_assets`
- `content_templates`
- `content_pillars`
- `content_library_items`

### Storage
- Bucket: `generated_assets` (uploads from library upload flow)

### Caller Surface
- `src/stores/LibraryStore.js`
- `src/pages/LibraryPage/LibraryPageV2.jsx`

## Connected Accounts and Health
### Tables/Views
- `connected_accounts`
- `connected_accounts_health_summary` (view)
- `connection_events`
- `platform_registry`

### Helper Function (schema side)
- `can_user_post_to_account` (defined in migration, used as backend capability helper)

### Caller Surface
- `src/services/platforms/connectionService.js`
- `src/pages/Settings/ConnectedAccountsTab.jsx`
- `src/pages/Settings/OrgAccountsReadOnlyTab.jsx`
- Dashboard account health components

## Brand Kit
### Tables
- `brand_kit`
- `brand_assets`

### Storage
- Bucket: `brand_assets`

### Edge Function
- `extractBrandKit` (currently fallback scaffolding response)

### Caller Surface
- `src/stores/BrandKitStore.js`
- `src/pages/Settings/BrandKitPage.jsx`
- `src/services/brandKitLoader.js`

## Help and Complaint Flow
### Tables
- `complaints`
- `profiles` (resolved admin profile enrichment)
- `user_notifications`
- `admin_notifications` (fallback insert path)

### Storage
- Bucket: `complaint-screenshots`

### RPC
- `mark_user_complaints_viewed`

### Edge Function
- `notify-admin-event`

### Caller Surface
- `src/stores/HelpStore.js`
- `src/pages/HelpPage/HelpPage.jsx`
- `src/components/HelpPanel/HelpPanel.jsx`

## Known Contract Variants and Backward-Compatibility Paths
- `HelpStore` uses complaint select variants and legacy fallback insert paths to support schema drift.
- `authService` and `orgService` use select-variant fallback strategies to tolerate missing columns in partially migrated environments.
- `LibraryStore` treats missing optional tables (`media_assets`, `content_templates`, `content_library_items`) as non-fatal for core post listing.

## Partial/Weak Contracts to Harden
1. Prompt enhancement path:
   - Edge function `enhance-prompt` plus fallback `ApiService.enhancePrompt`.
   - Recommended: stable response schema contract and one canonical fallback layer.
2. Publish multi-account writes:
   - Multiple `posts` inserts/updates followed by mock publish attempts.
   - Recommended: idempotency keys and explicit publish attempt transaction envelope.
3. Brand extraction:
   - UI expects extracted structured brand kit, edge function currently returns fallback object.
   - Recommended: implement deterministic extraction pipeline with confidence-map guarantees.
