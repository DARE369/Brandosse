# SocialAI — Project Context Reference

## What This App Is
SocialAI is a social media content generation and publishing platform. Users generate AI-powered posts, schedule them to connected social platforms, and manage their content library. Admins oversee moderation, support, analytics, and platform-wide governance.

## Two Workspaces
User Workspace (`/app/dashboard`, `/app/generate`, `/app/calendar`, `/app/library`, `/app/settings`)
- Regular users only
- Scoped to one user's own data through RLS

Admin Workspace (`/app/admin/*`)
- `super_admin` and `org_admin` roles only
- Cross-user data access within admin scope
- Users cannot access these routes

## Core Data Model
- `generations` → canonical AI creation artifact
- `posts` → canonical publishing lifecycle record
- `profiles` → user identity and activity metadata
- `connected_accounts` → linked social platforms
- `content_library_items` → library index
- `content_quality_reviews` → Grok quality scores
- `content_versions` → version history
- `audit_logs` → immutable activity log
- `organizations` → tenant grouping
- `complaints` → support tickets and escalations

## Key Lifecycle
User generates content → `generations` row created → DB trigger creates draft `posts` row on completion → user or admin edits/schedules/publishes the post → lifecycle advances `draft → scheduled → publishing → published | failed`.

## Realtime Strategy
- Use Supabase realtime subscriptions for live updates
- Patch individual records in React Query cache on subscription event
- Never trigger a full list refetch on realtime event
- System logs should queue new rows behind a manual “load new events” action
- Public routes do not subscribe to realtime feeds

## Quality Scoring
- Generations can be scored by Grok after completion
- Score bands: Ready (85+), Minor Review (70–84), Needs Revision (50–69), Regenerate (<50)
- Admins can re-trigger scoring manually
- Low scores should surface in admin moderation and notifications

## Regeneration Flow
- Admin triggers regeneration from moderation or user detail views
- Original version remains intact
- New variants are stored in `content_versions`
- Admin compares variants side-by-side before promotion

## Deletion Policy
- Never hard-delete from client code
- Posts are soft-deleted first
- User deletions flow through `admin_action_requests` and approval checks
- High-risk deletes must write `audit_logs` rows with elevated risk levels

## Frontend Architecture Notes
- React Query is the server-state layer for admin pages
- `AuthContext` owns auth session state
- `LogoutContext` owns the cancellable logout banner and cache clearing flow
- Admin shell uses fixed navbar + fixed sidebar + scrollable content area only
- Role isolation happens in `src/utils/protectedRoute.jsx`
