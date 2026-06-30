# Connected Accounts Mock Rollout — Stage 0 to Stage 2

## Scope
- This pass implements the rollout foundation, the mock connection service layer, QA seeding, and the personal Settings connected-accounts UI.
- It does **not** complete Stage 3 to Stage 6 yet. Publish-flow wiring, org account management UI, health cards on dashboards, and the super-admin console remain separate follow-up stages.

## Implemented

### Stage 0 — Foundation + Compatibility Layer
- Added `supabase/migrations/20260328000000_connected_accounts_foundation.sql`
- Added `supabase/migrations/20260328002000_settings_connected_accounts_indexes.sql`
- Added `supabase/migrations/20260328004000_health_card_views.sql`
- Added `supabase/migrations/20260328005000_org_accounts_helpers.sql`
- Added `supabase/migrations/20260328006000_admin_accounts_views.sql`
- Extended `public.connected_accounts` in a compatibility-safe way instead of recreating it
- Added:
  - `platform_registry`
  - `connection_events`
  - `mock_publish_logs`
  - `account_severity_alerts`
  - `admin_account_actions`
- Seeded all 8 mock platforms as active
- Preserved raw status compatibility:
  - connected semantic states: `active`, `mock`
  - disconnected semantic state: `revoked`
  - supported degraded states: `expired`, `error`, `reconnecting`

### Stage 1 — Service Layer + QA Seeding
- Added `src/services/platforms/platformUtils.js`
- Added `src/services/platforms/platformRegistry.js`
- Added `src/services/platforms/mockOAuthProvider.js`
- Added `src/services/platforms/connectionService.js`
- Added `src/services/platforms/mockPublishService.js`
- Replaced `src/services/MockOAuthService.js` with a compatibility wrapper over `connectionService`
- Added shared edge-function helpers in `supabase/functions/_shared/connectionHelpers.ts`
- Added:
  - `supabase/functions/mock-publish/index.ts`
  - `supabase/functions/detect-account-failures/index.ts`
  - `supabase/functions/admin-seed-connected-account/index.ts`
- Added QA seeding CLI:
  - `scripts/seed-mock-connected-accounts.mjs`

### Stage 2 — Personal Settings Connected Accounts
- Replaced the legacy hardcoded Settings connected-accounts page in `src/pages/Settings.jsx`
- Added:
  - `src/pages/Settings/ConnectedAccountsTab.jsx`
  - `src/pages/Settings/components/PlatformGrid.jsx`
  - `src/pages/Settings/components/MockOAuthScreen.jsx`
  - `src/pages/Settings/components/AccountConnectionForm.jsx`
  - `src/pages/Settings/components/ConnectedAccountCard.jsx`
  - `src/pages/Settings/components/AccountHealthModal.jsx`
  - `src/styles/ConnectedAccounts.css`
- Updated `src/components/Shared/PlatformIcon.jsx` so all 8 platforms render cleanly in the new UI

## Manual Steps

### 1. Apply database migrations
Run:

```bash
supabase db push
```

Required migration files for this rollout:
- `supabase/migrations/20260328000000_connected_accounts_foundation.sql`
- `supabase/migrations/20260328002000_settings_connected_accounts_indexes.sql`
- `supabase/migrations/20260328004000_health_card_views.sql`
- `supabase/migrations/20260328005000_org_accounts_helpers.sql`
- `supabase/migrations/20260328006000_admin_accounts_views.sql`

### 2. Deploy the new edge functions
Run:

```bash
supabase functions deploy mock-publish
supabase functions deploy detect-account-failures
supabase functions deploy admin-seed-connected-account
```

### 3. Configure pg_cron for failure detection
This rollout follows the existing repo convention and expects:
- `app.edge_function_base_url`
- `app.service_role_key`

Register the job:

```sql
DO $$
DECLARE
  edge_base_url text := current_setting('app.edge_function_base_url', true);
  service_role_key text := current_setting('app.service_role_key', true);
BEGIN
  IF edge_base_url IS NULL OR service_role_key IS NULL THEN
    RAISE NOTICE 'Skipping detect-account-failures cron registration because app.edge_function_base_url or app.service_role_key is not configured.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('detect-account-failures');

  PERFORM cron.schedule(
    'detect-account-failures',
    '0 */6 * * *',
    format(
      $job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', %L
        ),
        body := '{}'::jsonb
      );
      $job$,
      edge_base_url || '/functions/v1/detect-account-failures',
      'Bearer ' || service_role_key
    )
  );
END
$$;
```

Verify:

```sql
SELECT jobname, schedule
FROM cron.job
WHERE jobname = 'detect-account-failures';
```

### 4. Seed mock accounts for QA
Required env vars:
- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Example:

```bash
node scripts/seed-mock-connected-accounts.mjs --file ./scripts/seed-mock-connected-accounts.example.json
```

## QA Seeding Format
Seed file can be either an array or `{ "accounts": [...] }`.

Supported fields:
- `target_user_id`
- `scope`: `personal` or `organization`
- `organization_id` for org-scoped accounts
- `brand_project_id`
- `platform`
- `display_name`
- `username`
- `profile_type`
- `follower_count`
- `account_category`
- `profile_picture_url`
- `connection_status`
- `health_score`
- `consecutive_failure_count`
- `last_failure_reason`

## Smoke Test

### Personal account
1. Open `/app/settings`
2. Connect one of the 8 platforms from the mock OAuth flow
3. Confirm a `connected_accounts` row is created
4. Confirm a `connection_events` row with `event_type='connected'` is created
5. Confirm reconnect, edit, remove, and health modal all work

### Seeded account
1. Run the seeding script for a target user
2. Confirm the seeded row appears in `connected_accounts`
3. Confirm the target user sees it in `/app/settings`
4. Confirm the seeded connection also has a `connection_events` row

## Build Validation
- `npm run build` passes after this pass

## Remaining Stages
- Stage 3: publish-flow wiring + publish success/failure modal
- Stage 4: dashboard/admin health cards and connection event log surfacing
- Stage 5: org account management and member read-only org account views
- Stage 6: super-admin connected accounts console and admin maintenance actions
