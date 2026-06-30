# SocialAI Feature Inventory

Generated on: 2026-05-08  
Repository root: `c:\Users\Dare\Desktop\social-media-agent - Copy`  
Primary stack: Next.js App Router, React 18, Zustand, React Query, Supabase, Edge Functions, Recharts, lucide-react, dnd-kit, Framer Motion, Groq, Freepik, Replicate-oriented media flows.

## Scope And Completeness Contract

This inventory covers the project as it exists in committed and local source files at the time of review. It is source-backed from:

- `app/**` native Next routes and API routes.
- `src/**` application, admin, org, service, store, hook, context, style, compatibility, and legacy files.
- `supabase/functions/**` Edge Functions and shared function modules.
- `supabase/migrations/**` database, RLS, policy, helper, view, and workflow migrations.
- `scripts/**`, `public/**`, package scripts, and existing documentation under `docs/**` and `src/admin/docs/**`.

What this cannot fully guarantee without a live environment audit:

- Live Supabase dashboard settings, deployed Edge Function versions, cron configuration, secrets, storage bucket state, or production data.
- Uncommitted files outside the current working tree scan.
- Runtime behavior that depends on missing env vars, provider credentials, or remote services.

For the user's original question: yes, a project-wide Feature Inventory is possible. To keep it truly complete over time, update this document after each route, migration, Edge Function, service, store, or workflow change; periodically compare it against `rg --files`; and run a live Supabase/deployment drift audit before using it as an operational source of truth.

## Product Model At A Glance

SocialAI is a multi-workspace content operations platform with three main audiences:

- Personal users: generate content, build brand kits, manage drafts, schedule/publish posts, review analytics, manage accounts, and submit support issues.
- Organization members/admins: collaborate across brand projects, generate drafts, route work through pipelines, manage schedules, assets, tasks, chat, credits, roles, members, brand kits, and connected accounts.
- Platform admins/super admins: monitor the whole platform, moderate content, manage users/orgs/accounts, handle complaints, inspect logs, view analytics, and maintain admin settings.

The product combines AI generation, media generation/editing, SEO/caption optimization, mock publishing, connected-account health, task/pipeline governance, asset management, help/complaints, audit trails, and notification systems.

## Route Inventory

### Public And Auth Routes

| Route | Surface | Main Files | Feature Summary |
| --- | --- | --- | --- |
| `/` | Landing | `src/pages/Landing/LandingPage.jsx` | Public landing/entry page. |
| `/login` | Login | `src/pages/Auth/Login.jsx`, `src/layouts/AuthLayout.jsx` | Email/password login, Google login, redirect preservation, pending signup handling, normalized error messaging. |
| `/register` | Registration | `src/pages/Auth/Register.jsx` | Individual/org/agency signup, org name/slug capture, password or Google signup, pending signup intent, starter-credit messaging. |
| `/forgot-password` | Password reset request | `src/pages/Auth/ForgotPassword.jsx` | Supabase reset email request. |
| `/reset-password` | Password update | `src/pages/Auth/ResetPassword.jsx` | Password update after reset flow. |
| `/auth/callback` | OAuth callback | `src/pages/Auth/AuthCallback.jsx`, `src/Context/AuthContext.jsx` | Supabase OAuth callback processing, pending signup/invite handling, post-auth routing. |
| `/complete-signup` | Org signup completion | `src/pages/Auth/CompleteSignupPage.jsx`, `src/services/signupIntentService.js` | Completes self-service org provisioning after signup and supports retry/continue fallback. |
| `/join` | Invitation acceptance | `src/pages/InvitationAccept/InvitationAcceptPage.jsx`, `src/org/services/orgService.js` | Organization invitation preview, signup/password completion, and accept flow. |
| `/review/:clientReviewToken` | External/client review | `src/pages/ClientReview/ClientReviewPage.jsx`, `src/org/services/pipelineService.js` | Client-facing pipeline review preview, approve/reject/request changes flow. |
| `/select-context` | Workspace selector | `src/pages/ContextSelector/ContextSelectorPage.jsx` | Choose personal, org, or admin workspace and persist last-used context. |
| `/generate` | Legacy redirect | `app/generate/page.jsx` | Redirects to `/app/generate`. |

### Personal App Routes

| Route | Surface | Main Files | Feature Summary |
| --- | --- | --- | --- |
| `/app` | Post-auth router | `src/utils/PostAuthRedirect.jsx` | Resolves destination based on auth, admin/org access, last context, and default landing preferences. |
| `/app/dashboard` | Personal dashboard | `src/pages/Dashboard/UserDashboard.jsx` | Onboarding checklist, KPIs, recent generations, search, quick actions, connected-account health, realtime refresh. |
| `/app/generate` | AI generation workspace | `src/pages/GeneratePage/GeneratePageV2.jsx`, `src/stores/SessionStore.js` | Session-based prompt/media generation, carousel/edit/video flows, post production, captions, SEO, draft/publish handoff, history rail, deep links. |
| `/app/generate/:sessionId` | Generation session | Same as above | Loads a specific generation session and selection. |
| `/app/calendar` | Personal calendar | `src/pages/CalendarPage/CalendarPageV2.jsx`, `src/stores/CalendarStore.js` | Month/week/day/list views, scheduling, drag/drop rescheduling, ghost slots, optimal times, library selection, filters, bulk scheduling. |
| `/app/library` | Personal content library | `src/pages/LibraryPage/LibraryPageV2.jsx`, `src/stores/LibraryStore.js` | Posts, drafts, scheduled/published/failed content, media assets, templates, pillars, upload, duplicate, retry, schedule, repurpose. |
| `/app/analytics` | Personal analytics | `src/pages/AnalyticsPage/PersonalAnalyticsPage.jsx` | App-side generated/posts/drafts/scheduled/published/failed/connected-account metrics, funnel, platform panels, recent content. |
| `/app/help` | Help and complaints | `src/pages/HelpPage/HelpPage.jsx`, `src/stores/HelpStore.js` | FAQ search, support ticket/complaint submission, screenshots, comments, status history, viewed/resolved tracking. |
| `/app/settings` | Personal settings | `src/pages/Settings.jsx` | Profile, preferences, notifications, connected accounts, read-only org account access. |
| `/app/settings/brand-kit` | Personal brand kit | `src/pages/Settings/BrandKitPage.jsx`, `src/stores/BrandKitStore.js` | Upload/manual/conversation/import setup, extraction, review form, diff/apply, dashboard, assets. |
| `/app/profile` | Alias | `app/app/profile/page.jsx` | Redirects to `/app/settings`. |

### Organization Workspace Routes

| Route | Surface | Main Files | Feature Summary |
| --- | --- | --- | --- |
| `/app/org/:orgId` | Org home redirect | `src/org/components/OrgHomeRedirect.jsx`, `src/utils/protectedRoute.jsx` | Routes users to the correct org start page based on role/default route. |
| `/app/org/:orgId/overview` | Org overview | `src/org/pages/OrgOverview.jsx` | Admin/member metrics, account health, schedule, ops pulse, bottlenecks, assets. |
| `/app/org/:orgId/workspace` | Member workspace | `src/org/pages/MyWorkspace.jsx` | Personal org dashboard, action-required items, due/blocked tasks, team pulse, upcoming schedule, generate/schedule quick actions. |
| `/app/org/:orgId/office` | My Office | `src/org/pages/MyOffice.jsx` | Member drafts, generation, metadata validation, draft workflow modal, submit to pipeline, recent pipeline context. |
| `/app/org/:orgId/pipeline` | Pipeline board | `src/org/pages/PipelineBoard.jsx` | Content review lanes, selected item drawer, approve/reject/request changes, schedule approved items, client review link, revision flow. |
| `/app/org/:orgId/pipeline/tasks` | Pipeline tasks | `src/org/components/tasks/PipelineTasksPanel.jsx` | Task list/board/table modes, create/edit/details, linked content, due/status/member filters. |
| `/app/org/:orgId/calendar` | Org calendar | `src/org/pages/OrgCalendar.jsx`, `src/org/services/orgCalendarService.js` | Calendar/week/timeline/board/queue/approval/workload/task views, saved views, drag/drop, batch schedule, library picker, task/approval surfaces. |
| `/app/org/:orgId/library` | Org asset library | `src/org/pages/OrgAssetLibrary.jsx`, `src/org/services/assetLibraryService.js` | Smart collections, folder tree, upload, search, density controls, approval, brand flag, archive/restore, provenance, links to schedule/pipeline/tasks. |
| `/app/org/:orgId/common-room` | Collaboration hub | `src/org/pages/CommonRoom.jsx`, `src/org/services/commonRoomService.js` | Org/brand/private group channels, messages, assets and pipeline references, AI replies, channel create/update/archive/leave, read state. |
| `/app/org/:orgId/common-room/:channelId` | Channel deep link | Same as above | Opens a specific Common Room channel. |
| `/app/org/:orgId/team-activity` | Team activity | `src/org/pages/TeamActivity.jsx` | Recent pipeline/team activity feed. |

### Organization Admin Routes

| Route | Surface | Main Files | Feature Summary |
| --- | --- | --- | --- |
| `/app/org/:orgId/admin/brand-kit` | Org brand kit | `src/org/admin/BrandKitPage.jsx`, `src/org/services/brandKitService.js` | Brand project-scoped kit, identity/voice/guidance/visual editor, logo asset linking, editor access, completeness score. |
| `/app/org/:orgId/admin/members` | Members and invitations | `src/org/admin/MembersPage.jsx`, `src/org/services/orgService.js` | Member table, invite links, copy/revoke/regenerate/delete invitations, role/project access, permission overrides. |
| `/app/org/:orgId/admin/roles` | Role templates | `src/org/admin/RolesPage.jsx`, `src/org/constants/permissions.js` | System/custom templates, add/edit/duplicate/delete, grouped permissions, reset defaults, member counts. |
| `/app/org/:orgId/admin/pipelines` | Pipeline configuration | `src/org/admin/PipelineConfigPage.jsx`, `src/org/services/pipelineService.js` | Template gallery, pipeline config list, stage canvas, assignment, SLA, escalation, optional/client-link/rejection rules, default pipeline. |
| `/app/org/:orgId/admin/credits` | Credit management | `src/org/admin/CreditManagementPage.jsx`, `src/org/services/creditService.js` | Credit pool, used/pending stats, approve/partial/deny credit requests. |
| `/app/org/:orgId/admin/settings` | Org settings | `src/org/admin/OrgSettingsPage.jsx` | Org plan/default pipeline/task status notes, org connected accounts, task status manager. |
| Embedded | Org connected accounts admin | `src/org/admin/ConnectedAccountsAdmin.jsx` | Org mock OAuth, account cards, health modal, reconnect/remove, grant publishing access, activity. |

### Platform Admin Routes

| Route | Surface | Main Files | Feature Summary |
| --- | --- | --- | --- |
| `/app/admin` | Admin overview | `src/admin/pages/AdminOverview.jsx`, `src/admin/AdminLayout.jsx` | KPI overview, generation trends, risk notifications, platform health, activity, at-risk users, complaints, account severity. |
| `/app/admin/users` | User management | `src/admin/pages/AdminUsersPage.jsx` | Filter/search/paginate users, export CSV, bulk select, suspend/unsuspend, password reset, scoped views. |
| `/app/admin/users/:userId` | User investigation | `src/admin/pages/AdminUserDetailPage.jsx` | Profile, platforms, posts/library moderation, calendar, activity, complaints, analytics/security, notes, notify/suspend/reset/delete request. |
| `/app/admin/accounts` | Connected account maintenance | `src/admin/pages/AdminAccountsPage.jsx` | Health overview, degraded/critical filters, unresolved alerts, reconnect/resolve actions, account details panel, CSV export. |
| `/app/admin/organizations` | Organization governance | `src/admin/pages/AdminOrgsPage.jsx`, `src/admin/services/orgAdminService.js` | Create orgs, monitor owner onboarding, invitation link regeneration, open tenant details. |
| `/app/admin/organizations/:orgId` | Organization detail | `src/admin/pages/AdminOrgDetailPage.jsx` | Owner, onboarding/provisioning status, members, complaint summary. |
| `/app/admin/moderation` | Content moderation | `src/admin/pages/AdminModeration/AdminModerationWorkspace.jsx`, `src/admin/pages/AdminModeration/moderationApi.js` | Admin content queue, filters, selection, detail drawer, metadata edits, quality drawer, readiness checks, force schedule/publish, approve/assign/archive/delete/regenerate. |
| `/app/admin/content/review` | Legacy redirect | `app/app/admin/content/review/page.jsx` | Redirects to `/app/admin/moderation`. |
| `/app/admin/complaints` | Complaint queue | `src/admin/pages/AdminComplaintsPage.jsx` | Filter by status/priority/search, mark under review, open complaint detail. |
| `/app/admin/complaints/:complaintId` | Complaint detail | `src/admin/pages/AdminComplaintDetailPage.jsx` | Status/resolution, admin assignment, screenshot signed URL, internal comments, history, linked user/post/generation routing. |
| `/app/admin/logs` | System logs | `src/admin/pages/AdminLogsPage.jsx` | Audit logs and connection events, filters, source switch, group by user/content/account, risk/severity display. |
| `/app/admin/analytics` | Admin analytics | `src/admin/pages/AdminAnalyticsPage.jsx` | Active users, generated posts, publish success, quality score, activity bands, quality distribution, platform distribution, org leaderboard. |
| `/app/admin/settings` | Admin settings | `src/admin/pages/AdminSettingsPage.jsx` | Admin profile/security/preferences/notification type toggles, self password reset, local admin preferences. |

### Fallback And Compatibility Routes

| Route | Surface | Main Files | Feature Summary |
| --- | --- | --- | --- |
| `/app/*` | App fallback | `src/components/Shared/NotFoundCard.jsx` | In-app not found state inside the protected shell. |
| `*` | Global fallback | `src/pages/NotFoundPage.jsx` | Public/global not found page. |
| Legacy invitation page module | Compatibility source | `src/pages/InvitationAcceptPage.jsx` | Older invitation accept page module retained alongside the routed `src/pages/InvitationAccept/InvitationAcceptPage.jsx`. |

## Personal Workspace Feature Inventory

| Feature Area | Included Capabilities | Primary Source |
| --- | --- | --- |
| Authentication and session state | Supabase session handling, profile fallback, admin role resolution, org membership resolution, password reset/update, Google OAuth, pending signup/invite routing, default workspace routing, audit logs. | `src/Context/AuthContext.jsx`, `src/services/authService.js`, `src/utils/authRouting.js`, `src/utils/protectedRoute.jsx` |
| App shell and context | User navbar/sidebar, theme, logout provider, workspace sync, global mock publish modal, protected app routing. | `src/App.jsx`, `src/components/User/UserNavbar.jsx`, `src/components/User/UserSidebar.jsx`, `src/Context/LogoutContext.jsx`, `src/Context/ThemeContext.jsx` |
| Dashboard | Onboarding checklist, KPI cards, recent generations/search, quick actions, health card, realtime updates. | `src/pages/Dashboard/UserDashboard.jsx`, `src/components/Dashboard/*`, `src/hooks/useRealtimeKPIs.js` |
| Generation sessions | Session history, active session loading/switching/deleting, prompt enhancement, prompt suggestions, image generation, carousel generation, image editing, video generation/status polling, generation selection, lineage. | `src/pages/GeneratePage/GeneratePageV2.jsx`, `src/stores/SessionStore.js`, `src/components/Generate/*` |
| Post production | Caption generation/optimization, metadata regeneration, SEO score/optimization, hashtags, save draft, publish handoff, selected generation hydration. | `src/components/Generate/PostProductionPanel.jsx`, `src/components/Generate/SEOPanel.jsx`, `src/stores/SessionStore.js` |
| Personal brand kit | Setup choice, document upload, extraction loader, conversation path, manual review form, dashboard, assets, diff modal, version hash support. | `src/pages/Settings/BrandKitPage.jsx`, `src/components/BrandKit/*`, `src/stores/BrandKitStore.js` |
| Personal calendar | Calendar data fetch, draft scheduling, post updates/deletes, ghost slots, best posting time, optimal times, filters, local preferences, realtime subscription. | `src/pages/CalendarPage/CalendarPageV2.jsx`, `src/pages/CalendarPage/components/*`, `src/stores/CalendarStore.js` |
| Personal library | Unified library sections for drafts/scheduled/published/failed/media/templates/pillars, upload media, create draft from media, schedule/reschedule, retry, duplicate, delete, template usage. | `src/pages/LibraryPage/LibraryPageV2.jsx`, `src/stores/LibraryStore.js` |
| Personal analytics | Generation/post counts, scheduling/publishing funnel, connected account health, platform distribution, next best actions, recent content table, native metrics placeholders. | `src/pages/AnalyticsPage/PersonalAnalyticsPage.jsx` |
| Settings | Profile display name/avatar, timezone, locale, theme, default landing route, notification toggles, personal connected accounts, org account access read-only. | `src/pages/Settings.jsx`, `src/pages/Settings/*` |
| Help and complaints | FAQ content search, tickets, complaint submission with optional screenshot, comments, status history, mark viewed, admin event notification fallback. | `src/pages/HelpPage/HelpPage.jsx`, `src/pages/HelpPage/helpContent.js`, `src/stores/HelpStore.js` |
| Publishing | Mock publish modal, post preview cards, mock publish service/workflow, idempotent publish support. | `src/components/Publishing/*`, `src/services/platforms/mockPublishService.js`, `src/services/platforms/mockPublishWorkflow.js` |

## Organization Workspace Feature Inventory

| Feature Area | Included Capabilities | Primary Source |
| --- | --- | --- |
| Org shell and context | Org membership guard, context provider, active org/brand project, sidebar, top navbar, mobile drawer, global search, notifications, credit pill, denied-access toast. | `src/layouts/OrgWorkspaceShell.jsx`, `src/org/context/OrgContextProvider.jsx`, `src/org/components/OrgSidebar.jsx`, `src/org/components/OrgTopNavbar.jsx` |
| Workspace dashboard | Member dashboard cards, assigned/action-required items, due/blocked tasks, team pulse, upcoming schedule, dismissed cards persisted per member. | `src/org/pages/MyWorkspace.jsx`, `src/org/services/memberWorkspaceService.js` |
| My Office | Draft queue, generation composer, validation warnings, draft workflow modal, delete drafts, submit drafts to pipeline, pipeline handoff. | `src/org/pages/MyOffice.jsx`, `src/org/components/OrgGenerateComposer.jsx`, `src/org/components/OrgDraftWorkflowModal.jsx` |
| Pipeline | Content lanes, selected-item drawer, reviewer status, approve/reject/request-change actions, schedule approved content, generate client review links, revise/resubmit. | `src/org/pages/PipelineBoard.jsx`, `src/org/services/pipelineService.js` |
| Pipeline tasks | Task statuses, board/table/panel views, task creation/detail drawer, notes, linked posts/pipeline items, task notifications. | `src/org/components/tasks/*`, `src/org/services/taskService.js` |
| Org calendar | Multi-view scheduling, approval tracker, status board, timeline, workload/task views, saved view presets, batch scheduling, schedule modal, library picker, bottleneck metrics, queue. | `src/org/pages/OrgCalendar.jsx`, `src/org/components/calendar/*`, `src/org/services/orgCalendarService.js` |
| Org asset library | Folders, smart collections, upload, metadata, approval, brand flag, archive/restore, move, download, provenance and linked post/pipeline/task context. | `src/org/pages/OrgAssetLibrary.jsx`, `src/org/services/assetLibraryService.js`, `src/org/components/FolderTree.jsx` |
| Common Room | Channels, group/privacy rules, messages, read state, asset picker, pipeline picker, AI channel replies, create/update/archive/leave. | `src/org/pages/CommonRoom.jsx`, `src/org/services/commonRoomService.js`, `src/org/hooks/useCommonRoom.js` |
| Team activity | Activity feed over pipeline/team work. | `src/org/pages/TeamActivity.jsx` |
| Client review | Client token preview and action submission for pipeline items. | `src/pages/ClientReview/ClientReviewPage.jsx`, `src/org/services/pipelineService.js` |
| Org notifications | Notification fetch, read/dismiss/snooze, target resolution, reminder sweep, navbar notification center. | `src/org/services/orgNotificationService.js`, `src/org/hooks/useOrgNotifications.js`, `src/org/components/OrgNotificationCenter.jsx` |
| Org global search | Search across org workspace entities with navbar navigation targets. | `src/org/services/orgSearchService.js`, `src/org/components/OrgTopNavbar.jsx` |

## Organization Admin Feature Inventory

| Feature Area | Included Capabilities | Primary Source |
| --- | --- | --- |
| Members and invites | Fetch members/invites, invite member, preview/accept invitation, revoke/delete/regenerate links, member roles, project access, overrides. | `src/org/admin/MembersPage.jsx`, `src/org/components/InviteMemberPanel.jsx`, `src/org/services/orgService.js` |
| Roles and permissions | Permission constants, role normalization, inherited/override resolution, role template CRUD, duplication and defaults. | `src/org/admin/RolesPage.jsx`, `src/org/constants/permissions.js`, `src/org/services/orgService.js` |
| Pipeline configuration | Pipeline templates, stage normalization, config CRUD, duplicate/delete/default, stage rules, edge-backed advancement/client links. | `src/org/admin/PipelineConfigPage.jsx`, `src/org/services/pipelineService.js` |
| Credits | Credit request fetch/create/review, approve/partial/deny, monthly reset backend. | `src/org/admin/CreditManagementPage.jsx`, `src/org/services/creditService.js`, `supabase/functions/credit-request-action/index.ts` |
| Org brand kit | Brand project-scoped brand kit fetch/upsert, editors sync, logo asset linking, completeness. | `src/org/admin/BrandKitPage.jsx`, `src/org/services/brandKitService.js` |
| Org accounts | Mock OAuth, org account CRUD, health status, access grants, activity, account card/health modal support. | `src/org/admin/ConnectedAccountsAdmin.jsx`, `src/services/platforms/connectionService.js`, `src/org/components/OrgAccountCard.jsx` |
| Org settings | Plan/default pipeline/task status reference, task status manager, connected accounts embedded admin. | `src/org/admin/OrgSettingsPage.jsx`, `src/org/components/tasks/TaskStatusManager.jsx` |

## Platform Admin Feature Inventory

| Feature Area | Included Capabilities | Primary Source |
| --- | --- | --- |
| Admin access/RBAC | Admin role normalization, scope label, permission groups, nav items, scoped user ids. | `src/admin/hooks/useAdminAccess.js`, `src/admin/utils/adminClient.js`, `src/admin/utils/rbac.js` |
| Admin shell | Admin navbar/sidebar, profile menu, notification center, mobile shell, outlet admin access. | `src/admin/AdminLayout.jsx`, `src/admin/components/AdminNavbar/AdminNavbar.jsx`, `src/admin/components/AdminSidebar/AdminSidebar.jsx` |
| Overview | KPI cards, generation trend, risk event counts, pending alerts modal, platform health/risk domains, activity feed, at-risk users, complaint summary. | `src/admin/pages/AdminOverview.jsx`, `src/admin/components/RiskNotificationModal/RiskNotificationModal.jsx` |
| User management | User list filters/search/pagination/export, bulk selection/actions, status patching, password reset, suspension modal. | `src/admin/pages/AdminUsersPage.jsx`, `src/admin/components/SuspendUserModal.jsx` |
| User detail | Multi-tab investigation, connected accounts, moderation embed, calendar, activity log, complaints, analytics/security, notes, notifications, account actions. | `src/admin/pages/AdminUserDetailPage.jsx`, `src/admin/components/AdminNotesPanel.jsx`, `src/admin/components/AdminNotifyUserModal.jsx`, `src/admin/components/AdminUserCalendar.jsx` |
| Moderation | Admin list posts edge function with Supabase fallback, filter options, quality reviews, readiness checks, edit metadata, rescore, force schedule/publish, approve, assign, archive, deletion requests, regeneration, uploaded media analysis, promote generated versions. | `src/admin/pages/AdminModeration/*` |
| Account maintenance | Account health overview, health summary, severity alerts, investigate panel, force reconnect, resolve alerts, export account/event CSV. | `src/admin/pages/AdminAccountsPage.jsx`, `src/admin/components/AccountMaintenancePanel.jsx`, `src/admin/components/AccountSeverityPanel.jsx` |
| Org governance | Org create, slug uniqueness, plan allocation, owner invite link, invitation audit, onboarding status, org detail. | `src/admin/pages/AdminOrgsPage.jsx`, `src/admin/pages/AdminOrgDetailPage.jsx`, `src/admin/services/orgAdminService.js` |
| Complaints | Queue filters, status normalization, under-review action, detail status/resolution, assignment, internal comments, history, screenshot signed URLs. | `src/admin/pages/AdminComplaintsPage.jsx`, `src/admin/pages/AdminComplaintDetailPage.jsx` |
| Logs | Audit logs and connection events, source switching, risk/severity filters, user/content/account grouping, domain scoping. | `src/admin/pages/AdminLogsPage.jsx` |
| Analytics | Active AI users, generation volume, publish success, quality score, activity bands, quality distribution, platform distribution, org leaderboard, mock-ready native metric cards. | `src/admin/pages/AdminAnalyticsPage.jsx` |
| Admin settings | Profile/security/preferences/notifications tabs, self password reset, local preference persistence. | `src/admin/pages/AdminSettingsPage.jsx`, `src/admin/hooks/useLocalPersist.js` |
| Legacy/admin library components | Content manager, content moderation older components, score/card/list/details panels, mocks, admin docs. | `src/admin/components/ContentManager/*`, `src/admin/components/ContentModeration/*`, `src/admin/mocks/*`, `src/admin/docs/*` |

## AI, Media, Quality, And Publishing Inventory

| Capability | Description | Primary Source |
| --- | --- | --- |
| Image generation | Generates images through Edge Function/API service and Freepik integration. | `src/services/ApiService.js`, `src/services/freepik.service.js`, `supabase/functions/generateImage/index.ts` |
| Image editing | Edit image modal/panel and `editImage` Edge Function. | `src/components/Generate/EditImageModal.jsx`, `src/components/Generate/ImageEditPanel.jsx`, `supabase/functions/editImage/index.ts` |
| Carousel generation | Carousel plan and pipeline generation. | `src/stores/SessionStore.js`, `src/services/generationPipeline.js`, `supabase/functions/generateCarouselPlan/index.ts` |
| Video generation | Video job creation, status polling, processing modal/status bar. | `src/stores/SessionStore.js`, `src/components/Generate/VideoProcessingModal.jsx`, `supabase/functions/generateVideo/index.ts`, `supabase/functions/videoStatus/index.ts` |
| Prompt enhancement | Prompt rewriting/enhancement and suggestions. | `src/services/ApiService.js`, `src/services/suggestedPrompts.js`, `src/hooks/useGroqSuggestions.js`, `supabase/functions/enhance-prompt/index.ts`, `supabase/functions/prompt-suggestions/index.ts` |
| Caption generation | Caption generation and optimization from selected content. | `src/stores/SessionStore.js`, `src/services/mediaCaptionSuggestions.js`, `supabase/functions/generate-caption/index.ts` |
| Metadata generation | Post metadata generation and status tracking for personal/org drafts. | `src/stores/SessionStore.js`, `src/org/services/orgDraftWorkflowService.js`, `supabase/functions/generate-post-metadata/index.ts` |
| SEO scoring/optimization | SEO score, optimization suggestions, apply suggestions, org draft SEO. | `src/services/ApiService.js`, `src/org/services/orgDraftWorkflowService.js`, `supabase/functions/seo-score/index.ts`, `supabase/functions/optimize-seo/index.ts` |
| Brand consistency | Brand-aware prompt building and consistency checks. | `src/services/brandKitLoader.js`, `src/services/briefBuilder.js`, `src/services/llmClient.js`, `supabase/functions/ai-brand-consistency-check/index.ts` |
| Content plans and validation | Content plan extraction/validation, quality gate support. | `src/services/contentPlanValidator.js`, `src/services/intentExtractor.js`, `src/services/qualityGate.js` |
| Session titles | Auto-generation of generation session titles. | `src/services/sessionTitleService.js`, `supabase/functions/generate-session-title/index.ts` |
| Mock publishing | Mock OAuth, publish workflow, platform registry, post preview, mock-publish Edge Function. | `src/services/platforms/*`, `src/components/Publishing/*`, `supabase/functions/mock-publish/index.ts` |
| Account health | Connection events, failure detection, health views, admin/org/personal health cards. | `src/services/platforms/connectionService.js`, `src/components/Dashboard/AccountHealthCard.jsx`, `src/org/components/OrgAccountHealthCard.jsx`, `supabase/functions/detect-account-failures/index.ts` |

## State Stores, Hooks, And Contexts

| Module | Role |
| --- | --- |
| `src/stores/SessionStore.js` | Generation sessions, generation actions, post production, video jobs, captions, SEO, draft/publish flows, subscriptions. |
| `src/stores/CalendarStore.js` | Personal calendar posts/drafts/ghost slots/pillars/optimal times/settings/realtime. |
| `src/stores/LibraryStore.js` | Personal library rows, media assets, templates, pillars, upload/schedule/duplicate/retry/delete. |
| `src/stores/BrandKitStore.js` | Personal brand kit loading/upsert, extraction/diff, asset upload/update/delete, onboarding state. |
| `src/stores/HelpStore.js` | Complaints, comments, status history, screenshot upload, admin notifications, form state. |
| `src/org/stores/orgRuntimeStore.js` | Org runtime/session context used by org-aware generation and workspace flows. |
| `src/Context/AuthContext.jsx` | Auth/session/profile/admin/org membership and routing model. |
| `src/Context/LogoutContext.jsx` | Global logout flow coordination. |
| `src/Context/ThemeContext.jsx` | User theme state. |
| `src/org/context/OrgContextProvider.jsx` | Organization, membership, permissions, brand project, and access context. |
| `src/hooks/useGroqSuggestions.js` | AI suggestions for prompts/content. |
| `src/hooks/useLogout.js` | Logout helper. |
| `src/hooks/useRealtimeKPIs.js` | Dashboard KPI realtime updates. |
| `src/org/hooks/useOrgCalendar.js` | Org calendar snapshot/actions wrapper. |
| `src/org/hooks/useOrgAssets.js` | Org asset/folder loader wrapper. |
| `src/org/hooks/useCommonRoom.js` | Channel/message loading and realtime-ish Common Room state. |
| `src/org/hooks/useOrgCredits.js` | Org credit/request state. |
| `src/org/hooks/useOrgNotifications.js` | Org notification center state. |
| `src/org/hooks/usePipelineItems.js` | Pipeline item fetch state. |
| `src/org/hooks/usePipelineTaskBadgeCount.js` | Task badge count. |
| `src/admin/hooks/useAdminAccess.js` | Admin access resolution. |
| `src/admin/hooks/useDebouncedValue.js` | Admin UI debounce helper. |
| `src/admin/hooks/useLocalPersist.js` | Local admin preference persistence. |

## Service Inventory

| Service | Purpose |
| --- | --- |
| `src/services/supabaseClient.js`, `src/services/supabaseConfig.js`, `src/services/api.js` | Supabase configuration and base API helpers. |
| `src/services/queryClient.js` | React Query client setup. |
| `src/services/authService.js` | Auth helper operations. |
| `src/services/ApiService.js` | Generation, text, video, caption, SEO, provider config, API status, cost estimation. |
| `src/services/edgeFunctionClient.js` | Edge Function invocation wrapper. |
| `src/services/freepik.service.js` | Freepik image/edit/video operations through Edge Functions. |
| `src/services/generationPipeline.js` | Generation pipeline registration and single/carousel execution. |
| `src/services/groqClient.js` | Groq content plan, revision, brand-aware prompts, JSON/vision helpers. |
| `src/services/llmClient.js` | LLM chat, brief generation, brand consistency check. |
| `src/services/briefBuilder.js` | Builds generation briefs from prompt/brand/context. |
| `src/services/brandKitConversation.js` | Brand kit conversational setup helpers. |
| `src/services/brandKitLoader.js` | Loads brand kit context for generation. |
| `src/services/contentLibraryService.js` | Library/post persistence helpers. |
| `src/services/contentPlanValidator.js` | Content plan validation. |
| `src/services/historyLoader.js` | Session/history loading helpers. |
| `src/services/intentExtractor.js` | Extracts user generation intent. |
| `src/services/mediaCaptionSuggestions.js` | Caption suggestion utilities for media. |
| `src/services/OptimalTimesService.js` | Optimal posting time utilities. |
| `src/services/qualityGate.js` | Quality gate/readiness logic. |
| `src/services/sessionTitleService.js` | Session title generation. |
| `src/services/signupIntentService.js` | Pending org signup intent persistence/provisioning. |
| `src/services/suggestedPrompts.js` | Prompt suggestion catalogue/service. |
| `src/services/userSettingsService.js` | User settings normalization/fetch/save/profile updates. |
| `src/services/MockOAuthService.js` | Older/mock OAuth service entry. |
| `src/services/platforms/connectionService.js` | Personal/org connected account CRUD, access grants, account health. |
| `src/services/platforms/mockOAuthProvider.js` | Mock provider authentication/token behavior. |
| `src/services/platforms/mockPublishService.js` | Mock publish invocation. |
| `src/services/platforms/mockPublishWorkflow.js` | Publish summaries, attempts, lifecycle events. |
| `src/services/platforms/platformRegistry.js` | Platform metadata registry. |
| `src/services/platforms/platformUtils.js` | Platform/account normalization and labels. |
| `src/org/services/orgService.js` | Org context, membership, members, roles, invitations, org drafts. |
| `src/org/services/pipelineService.js` | Pipeline configs/items/submission/advancement/client review. |
| `src/org/services/orgCalendarService.js` | Org schedule snapshot, presets, batch schedule, updates, publish. |
| `src/org/services/orgScheduleService.js` | Schedule modal context and destination options. |
| `src/org/services/assetLibraryService.js` | Org assets/folders/upload/link sync/provenance. |
| `src/org/services/commonRoomService.js` | Channels, messages, members, AI replies, read state. |
| `src/org/services/taskService.js` | Org task statuses, tasks, task notes, notifications. |
| `src/org/services/brandKitService.js` | Org brand kit fetch/upsert/editor sync. |
| `src/org/services/creditService.js` | Credit request fetch/create/review. |
| `src/org/services/memberWorkspaceService.js` | Persisted member dashboard state. |
| `src/org/services/orgNotificationService.js` | Org notifications/read/snooze/dismiss/reminders. |
| `src/org/services/orgSearchService.js` | Org global search. |
| `src/admin/utils/adminClient.js` | Admin access, notifications, search, audit, counts, user actions, complaints, user activity/calendar, notes, schedule updates. |
| `src/admin/services/orgAdminService.js` | Super admin org creation, owner invite flow, plan allocation, slug uniqueness, invite audit. |
| `src/admin/pages/AdminModeration/moderationApi.js` | Moderation data, filters, quality, edits, readiness, force actions, approvals, assignments, deletion/archive, regeneration. |

## Component And UI Inventory

### Shared And Personal Components

- Brand kit: `AssetUploader`, `BrandKitConversation`, `BrandKitDashboard`, `BrandKitDiffModal`, `BrandKitExtractLoader`, `BrandKitForm`, `BrandKitLivePreview`, `BrandKitOnboardingModal`, `BrandKitReviewForm`, `BrandKitSaveWarning`, `BrandKitSetupChoice`.
- Dashboard: `AccountHealthCard`, `RealtimeKPICards`.
- Generate: `AspectRatioIcons`, `BatchGenerationGrid`, `EditImageModal`, `GenerationCanvas`, `GenerationPromptBar`, `ImageEditPanel`, `IntentClarificationPanel`, `PostProductionPanel`, `PromptSuggestions`, `SEOPanel`, `SessionHistoryRail`, `VideoProcessingModal`.
- Publishing: `MockPublishModal`, `PostPreviewCard`.
- Shared: `AuthLoadingOverlay`, `HelpPanel`, `NotFoundCard`, `PlatformIcon`, `ScheduleModal`, `StatusBadge`, `ThemeToggle`, `WorkspaceSwitcherMenu`, shared UI primitives.
- User shell: `AIResultPreviewer`, `KpiCard`, `ProfileMenu`, `PromptTemplateBuilder`, `TrendsPanel`, `UserNavbar`, `UserSidebar`.
- Calendar V2 components: `BulkScheduleModal`, `CalendarDetailPanel`, `CalendarGrid`, `CalendarView`, `DraftsSidebar`, `GhostSlotCard`, `GhostSlotsToggle`, `OptimalTimesPanel`, `PostCard`, `ScheduleModal`, `SelectFromLibraryModal`.
- Settings connected accounts: `AccountConnectionForm`, `AccountHealthModal`, `ConnectedAccountCard`, `MockOAuthScreen`, `PlatformGrid`.

### Organization Components

- Shell/shared: `BrandKitPanel`, `BrandProjectSelector`, `ContentQueuePanel`, `ContextCard`, `CreditPill`, `OrgEmptyState`, `OrgGenerateComposer`, `OrgHomeRedirect`, `OrgNotificationCenter`, `OrgSelect`, `OrgSidebar`, `OrgStatCard`, `OrgTopNavbar`.
- Calendar: `CalendarApprovalTracker`, `CalendarBatchScheduleModal`, `CalendarContentCard`, `CalendarDetailDrawer`, `CalendarLibraryPicker`, `CalendarSavedViewsMenu`, `CalendarStatusBoard`, `CalendarTimelineView`, `OrgScheduleModal`, `PostPreview`, `SchedulePicker`.
- Common Room: `CommonRoomAssetPicker`, `CommonRoomChannelModal`, `CommonRoomPipelinePicker`.
- Assets/accounts: `FolderCreateModal`, `FolderTree`, `GrantAccessModal`, `MoveAssetModal`, `OrgAccountCard`, `OrgAccountHealthCard`, `OrgAssetUploadModal`.
- Draft workflow: `OrgDraftWorkflowModal`.
- Tasks: `PipelineTasksPanel`, `TaskBoardView`, `TaskCreateModal`, `TaskDetailDrawer`, `TaskStatusManager`, `TaskTableView`.

### Admin Components

- Shell: `AdminNavbar`, `AdminSidebar`, `AdminProfileMenu`, `AdminNotificationCenter`.
- User/account/support: `AccountMaintenancePanel`, `AccountSeverityPanel`, `ActivityStatusBadge`, `AdminNotesPanel`, `AdminNotifyUserModal`, `AdminRiskBadge`, `AdminUserCalendar`, `QualityScoreBadge`, `SuspendUserModal`.
- Org admin support: `CreateOrgPanel`, `OrgInvitePanel`.
- Moderation/content manager: `ContentManager`, `ContentDataGrid`, `ContentFilterBar`, `ContentQuickActions`, `ContentReadinessCheck`, `ContentSchedulerTimeline`, `MetadataEditDrawer`, `ApiLogExpander`, `StatusBadge`, `ContentReviewModal`, `EditModal`, `FilterBar`, `ModerationQueue`, `PreviewPane`, `PublicationModal`, `UploadWizard`.
- Analytics/cards/common: `KpiCard`, `ScoreCard`, `Pagination`, `Badge`, `Button`, `Modal`, `ContentAnalytics`, `ContentCharts`, `RiskNotificationModal`.
- Legacy/detail panels: `UserDetailsPanel`, `SocialMediaTile`, `UserListPanel`, `UserListRow`.

## Supabase Edge Function Inventory

Purpose is inferred from function name and client usage.

| Function | Purpose |
| --- | --- |
| `admin-account-action` | Super admin connected-account actions such as reconnect/resolve alert. |
| `admin-list-posts` | Admin moderation list endpoint with filters/pagination. |
| `admin-notify-user` | Sends admin-to-user notifications. |
| `admin-seed-connected-account` | Seeds mock connected account data. |
| `adminStats` | Admin stats endpoint. |
| `ai-brand-consistency-check` | Checks content against brand kit. |
| `ai-generate-brief` | Generates AI brief content. |
| `ai-org-chat` | Common Room AI assistant replies. |
| `credit-monthly-reset` | Scheduled/operational credit reset. |
| `credit-request-action` | Approve/deny/partial credit requests. |
| `daily-analysis` | Daily analysis job. |
| `detect-account-failures` | Detects account failures and health events. |
| `editImage` | Image edit provider function. |
| `enhance-prompt` | Prompt enhancement. |
| `extractBrandKit` | Brand kit extraction from uploaded materials. |
| `generate-caption` | Caption generation. |
| `generate-post-metadata` | Post metadata generation. |
| `generate-session-title` | Session title generation. |
| `generateCarouselPlan` | Carousel plan generation. |
| `generateContent` | General content generation. |
| `generateImage` | Image generation. |
| `generateVideo` | Video job creation. |
| `healthCheck` | Edge/service health check. |
| `mock-publish` | Mock publishing workflow endpoint. |
| `notify-admin-event` | Creates/admin-notifies operational events. |
| `optimize-seo` | SEO optimization suggestions. |
| `org-accept-invitation` | Accepts org invitation. |
| `org-asset-upload` | Organization asset upload with storage/database handling. |
| `org-brand-kit-upsert` | Organization brand kit upsert. |
| `org-calendar-publish` | Publishes org calendar/pipeline content. |
| `org-complete-invitation-signup` | Completes invited-member signup. |
| `org-delete-invitation` | Deletes org invitation. |
| `org-get-schedule-context` | Org schedule modal context and destinations. |
| `org-global-search` | Org workspace global search. |
| `org-invite-member` | Creates/sends org member invitation. |
| `org-revoke-invitation` | Revokes org invitation. |
| `org-self-signup` | Self-service org signup/provisioning. |
| `org-setup` | Organization setup/bootstrap. |
| `org-task-notify` | Task notification dispatch. |
| `pipeline-advance` | Pipeline item advancement/review actions. |
| `pipeline-client-action` | Client review action submission. |
| `pipeline-generate-client-link` | Client review link generation. |
| `process-risk-alerts` | Risk alert processing. |
| `prompt-suggestions` | Prompt suggestion generation. |
| `seo-score` | SEO scoring. |
| `start-generation` | Generation start endpoint. |
| `videoStatus` | Video job status polling. |
| `webhook-handler` | External webhook handler. |

Shared function modules:

- `_shared/auth-users.ts`, `_shared/connectionHelpers.ts`, `_shared/env.ts`, `_shared/freepik.service.ts`, `_shared/http.ts`, `_shared/llm.ts`, `_shared/mail.ts`, `_shared/mockPublish.ts`, `_shared/org.ts`, `_shared/org-bootstrap.ts`, `_shared/pipeline.ts`, `_shared/storage.ts`, `_shared/supabase.ts`.
- Function-side SQL references: `supabase/functions/schema.sql`, `supabase/functions/policies.sql`, `supabase/functions/README.md`.

## Supabase Migration Inventory

| Migration | Feature Area |
| --- | --- |
| `001_audit_triggers.sql` | Audit trigger foundation. |
| `002_user_notifications.sql` | User notification foundation. |
| `003_admin_notes.sql` | Admin notes. |
| `20260220041938_brand_kit.sql` | Personal brand kit schema. |
| `20260222013000_storage_buckets_and_policies.sql` | Storage buckets and policies. |
| `20260227090000_calendar_library_alignment.sql` | Calendar/library alignment. |
| `20260227103000_generation_post_unification_and_rls.sql` | Generation/post unification and RLS. |
| `20260302110000_profile_provisioning_and_status_domain.sql` | Profile provisioning and status domain. |
| `20260312153000_admin_foundation.sql` | Admin foundation. |
| `20260313090000_admin_rls_recursion_hotfix.sql` | Admin RLS recursion hotfix. |
| `20260313103000_profiles_contact_and_activity_backfill.sql` | Profile contact/activity backfill. |
| `20260321113000_admin_moderation_schema_alignment.sql` | Admin moderation schema alignment. |
| `20260321153000_admin_v4_notifications_notes_and_activity.sql` | Admin notifications, notes, activity. |
| `20260323100000_risk_notifications_and_help_system_core.sql` | Risk notifications and help system core. |
| `20260323101000_risk_notifications_and_help_system_policies.sql` | Risk/help policies. |
| `20260323102000_complaint_workflow_and_audit_functions.sql` | Complaint workflow and audit functions. |
| `20260323103000_risk_cron_and_legacy_table_deprecation.sql` | Risk cron and legacy deprecation. |
| `20260324100000_org_workspace_foundation.sql` | Org workspace foundation. |
| `20260324110000_org_pipeline_tables.sql` | Org pipeline tables. |
| `20260324120000_org_common_room_tables.sql` | Org Common Room tables. |
| `20260324130000_org_asset_library_table.sql` | Org asset library table. |
| `20260324140000_org_credit_tables.sql` | Org credit tables. |
| `20260324150000_org_posts_generations_columns.sql` | Org columns on posts/generations. |
| `20260324160000_org_rls_policies.sql` | Org RLS policies. |
| `20260324170000_org_helper_functions.sql` | Org helper functions. |
| `20260324180000_org_seed_plan_data.sql` | Org plan seed data. |
| `20260324190000_org_invitation_owner_provisioning.sql` | Org invitation/owner provisioning. |
| `20260324200000_org_calendar_schedule_write_policy.sql` | Org calendar schedule write policy. |
| `20260325110000_org_calendar_view_presets_and_asset_links.sql` | Org calendar view presets and asset links. |
| `20260325130000_common_room_reads_and_summaries.sql` | Common Room reads/summaries. |
| `20260326110000_org_asset_library_permission_alignment.sql` | Org asset permission alignment. |
| `20260327010000_org_brand_kit_stage1.sql` | Org brand kit stage 1. |
| `20260327020000_org_asset_folders_stage2.sql` | Org asset folders stage 2. |
| `20260327021000_org_permission_template_backfill.sql` | Org permission template backfill. |
| `20260327022000_org_asset_folder_rls_recursion_fix.sql` | Asset folder RLS recursion fix. |
| `20260327030000_org_tasks_stage4.sql` | Org task system. |
| `20260327040000_common_room_groups_stage5.sql` | Common Room groups. |
| `20260327050000_org_member_workspace_state_stage6.sql` | Org member workspace state. |
| `20260328000000_connected_accounts_foundation.sql` | Connected accounts foundation. |
| `20260328002000_settings_connected_accounts_indexes.sql` | Connected account indexes/settings support. |
| `20260328004000_health_card_views.sql` | Account health card views. |
| `20260328005000_org_accounts_helpers.sql` | Org account helper functions. |
| `20260328006000_admin_accounts_views.sql` | Admin account health views. |
| `20260328010000_org_notification_center_stage7.sql` | Org notification center. |
| `20260329010000_connected_account_admin_read_policies.sql` | Connected account admin read policies. |
| `20260330110000_mock_publish_idempotency.sql` | Mock publish idempotency. |
| `20260330111000_brand_kit_version_hash.sql` | Brand kit version hash. |
| `20260330112000_posts_assigned_moderator.sql` | Assigned moderator on posts. |
| `20260330113000_admin_notifications_canonicalization.sql` | Admin notification canonicalization. |
| `20260404120000_org_workflow_stabilization.sql` | Org workflow stabilization. |
| `20260404134000_stage2_task_access_alignment.sql` | Task access alignment. |
| `20260408210000_stage11_user_settings_foundation.sql` | User settings foundation. |

## Utility, Styling, Assets, And Tests

| Area | Files/Notes |
| --- | --- |
| Package scripts | `dev`, `build`, `preview`, `deploy`, `check:status-literals`, `check:ui-consistency`. |
| Utility scripts | `scripts/check-status-literals.cjs`, `scripts/check-ui-consistency.cjs`, `scripts/fix-moderation-empty-state.cjs`, `scripts/fix-moderation-empty-state.mjs`, `scripts/render_markdown_pdf.py`, `scripts/seed-mock-connected-accounts.mjs`, `scripts/seed-mock-connected-accounts.example.json`. |
| Public assets | `public/index.html`, `public/manifest.json`, `public/favicon.ico`, `public/assets/profile.png`, `public/assets/Profile.svg`. |
| Global styles | `src/index.css`, `src/styles/App.css`, `global.css`, `theme.css`, `tokens.css`, `variables.css`, `design-system.css`, `responsive-contract.css`, plus page/surface CSS for auth, dashboard, generate, calendar, library, settings, help, account health, org workspace, admin shell. |
| Org styles | `src/org/styles/*` for workspace, office, calendar, pipeline, common room, asset library, brand kit, org admin, draft workflow, generate composer. |
| Admin styles | `src/admin/styles/*`, `src/admin/pages/AdminModeration/AdminModerationPage.css`, `AdminModeration.scss`, component CSS. |
| Constants/utilities | `src/constants/statusEnums.js`, `src/constants/statuses.js`, `src/utils/*`, `src/org/utils/*`, `src/admin/utils/*`. |
| Legacy code | `src/legacy/generation/generationMachine.js`, `src/legacy/generation/useGenerationService.js`, `src/legacy/supabase.js`, `src/admin/AdminDashboard.jsx`, `src/admin/adminRoutes.jsx`, `src/pages/InvitationAcceptPage.jsx`, legacy admin content components/mocks. |
| Tests | `src/admin/components/AdminNavbar/AdminNavbar.test.jsx` is the only test file found by the source scan. |

## Existing Documentation Inventory

Documentation already exists in several layers:

- Current/root docs for dashboard, calendar, generate, user dashboard, MVP/current work, weekly audits, schema/database consistency, connected-account rollout, Freepik setup, Groq prompting, post/generation lifecycle, theming, mobile/tablet layout, and implementation reports.
- Handoff docs under `docs/handoff/` for `personal`, `org-member`, `org-admin`, `platform-admin`, and `shared`, including page docs, workflow docs, dependency/data model docs, coverage checklists, wiring gaps, and audit maps.
- Implementation docs under `docs/implementation/socialai-full-fix/` and `docs/implementation/ui-unification/`.
- Org rollout docs for stages 1 through 8, org UI refresh phases, org calendar, org admin handoff, and workspace/office/common-room/asset-library references.
- Admin docs under `src/admin/docs/` for API contracts, CSS guidelines, install notes, and RBAC.
- Component README files under admin component folders.

This Feature Inventory does not replace the detailed handoff docs; it indexes the whole product and points to the source areas where each feature lives.

## Known Mock, Placeholder, Or Environment-Dependent Areas

- Social platform integrations are currently mock-oriented in the UI/services, with mock OAuth and mock publishing flows.
- Native platform analytics cards are explicitly marked as mock-ready/placeholders until real platform APIs are connected.
- Admin settings avatar upload and 2FA session management are visible/pending backend support.
- Some admin content manager/moderation components and mocks are legacy or secondary to the routed `AdminModerationWorkspace`.
- Supabase Edge Functions, storage policies, cron jobs, and provider keys must be deployed/configured in the active Supabase project for the related features to work at runtime.
- Test coverage is very thin from the file scan; most coverage is documentation, migration, and UI/source implementation rather than automated tests.

## Traceability Checklist

This inventory includes:

- All production app route groups from `app/**`.
- All main page groups under `src/pages`, `src/org/pages`, `src/org/admin`, and `src/admin/pages`.
- All Zustand stores under `src/stores` plus org runtime store.
- All React contexts under `src/Context` and org context provider.
- All hooks under `src/hooks`, `src/org/hooks`, and `src/admin/hooks`.
- All service groups under `src/services`, `src/org/services`, and `src/admin/services`/`src/admin/utils`.
- All Supabase Edge Function folders and shared modules.
- All Supabase migrations.
- Utility scripts, public assets, style systems, constants, utilities, legacy code, and discovered tests.

Recommended upkeep process:

1. Run `rg --files src supabase scripts public docs` before each inventory refresh.
2. Diff route changes in `app/**`.
3. Diff schema changes in `supabase/migrations`.
4. Diff Edge Function folders in `supabase/functions`.
5. Reconcile new pages/components/services/stores/hooks against the tables above.
6. For production accuracy, compare this source inventory against deployed Supabase functions, secrets, storage buckets, cron jobs, and RLS policies.
