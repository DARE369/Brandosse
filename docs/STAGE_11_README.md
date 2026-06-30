# Stage 11 - Personal Settings Foundation (Phase 1)

## Summary
Stage 11 implements Phase 1 from the Stage 10 settings plan by adding a real personal settings foundation in `/app/settings`.

Delivered scope:

1. New personal settings tabs:
   - Profile
   - Preferences
   - Notifications
   - Connected Accounts (existing)
2. Persistent settings storage in `public.user_settings`.
3. Profile update flow (`profiles.full_name`, `profiles.avatar_url`).
4. Personal default landing route preference wired into auth redirect resolution.

## Files Added
- `supabase/migrations/20260408210000_stage11_user_settings_foundation.sql`
- `src/services/userSettingsService.js`
- `src/pages/Settings/PersonalSettingsFoundationTab.jsx`
- `docs/STAGE_11_README.md`
- `docs/STAGE_11_IMPLEMENTATION_REPORT_2026-04-08.md`

## Files Modified
- `src/pages/Settings.jsx`
- `src/styles/Settings.css`
- `src/Context/AuthContext.jsx`

## Database Changes
- Migration: `supabase/migrations/20260408210000_stage11_user_settings_foundation.sql`
- New table/policies:
  - `public.user_settings`
  - row ownership RLS policies (`auth.uid() = user_id`)
  - update timestamp trigger

## Tables Used
- `public.user_settings`
- `public.profiles`

## How to verify this stage is working

### Step 1 - Settings tabs are expanded
1. Open `/app/settings`.

Expected:
- Tabs render: `Profile`, `Preferences`, `Notifications`, `Connected Accounts`.
- `Organization Accounts` still appears when the user has org memberships.

### Step 2 - Profile settings save
1. Open `Profile`.
2. Edit full name and/or avatar URL.
3. Save.

Expected:
- Success toast.
- Updated values persist after refresh.

### Step 3 - Preferences save
1. Open `Preferences`.
2. Change timezone, locale, theme, and default landing page.
3. Save.

Expected:
- Success toast.
- Theme preference applies immediately.
- Values persist after refresh/relogin.

### Step 4 - Notification preferences save
1. Open `Notifications`.
2. Toggle preference switches.
3. Save.

Expected:
- Success toast.
- Toggles persist after refresh.

### Step 5 - Default landing route behavior
1. Set default landing route to something other than dashboard (for example `/app/calendar`).
2. Sign out and sign in.

Expected:
- Personal workspace redirect uses the saved default route when no higher-priority context route overrides it.

## Required deploy/apply steps

1. Apply migration:
   - `supabase db push`
2. Deploy frontend changes.

No new edge function deployment is required in Stage 11.
