# SocialAI User Personas

Generated on: 2026-05-08  
Repository root: `c:\Users\Dare\Desktop\social-media-agent - Copy`  
Primary audience: product, design, engineering, QA, support, and implementation agents.

## 1. Purpose

This document defines the core user personas for SocialAI and maps them to product goals, workflows, access levels, routes, permissions, UX expectations, and known product constraints.

Use this document when:

- planning new features
- reviewing UI and workflow decisions
- deciding which user journey should be simplest
- designing permissions, onboarding, and empty states
- testing role-based access and navigation
- writing release notes, help docs, or sales/demo scripts
- updating `docs/FEATURE_INVENTORY.md` or handoff documentation

The goal is to answer four questions:

1. Who are we building for?
2. What job are they trying to complete?
3. What can they access?
4. What would make the product feel successful to them?

## 2. Documentation Plan

This personas document is organized in implementation-friendly layers:

| Section | Purpose |
| --- | --- |
| Persona Summary | Quick map of all user types and their core jobs. |
| Persona to System Role Map | Connects human personas to app roles, org roles, and route families. |
| Detailed Persona Profiles | Goals, pain points, workflows, success criteria, and UX needs. |
| Workflow Matrix | Shows how each persona moves through SocialAI. |
| Feature Relevance Matrix | Indicates which product areas matter most to each persona. |
| Permissions and Access Matrix | Documents what each persona should and should not access. |
| UX Implications | Converts persona needs into interface rules. |
| MVP and Product Constraints | Captures current mock, missing, or partial areas that affect each persona. |
| Open Questions | Tracks persona assumptions that need product validation. |

## 3. Source Basis

The personas are inferred from the current SocialAI product model and source-backed documentation:

- `docs/CURRENT_MVP_DOCUMENTATION.md`
- `docs/FEATURE_INVENTORY.md`
- `docs/TECHNICAL_CONSTRAINTS.md`
- `docs/handoff/shared/route-ownership-matrix.md`
- `docs/handoff/personal/**`
- `docs/handoff/org-member/**`
- `docs/handoff/org-admin/**`
- `docs/handoff/platform-admin/**`
- `src/router/router.jsx`
- `src/constants/statuses.js`
- `src/org/constants/permissions.js`
- `src/org/services/orgService.js`
- `src/utils/authRouting.js`
- `src/utils/protectedRoute.jsx`

This document describes current and intended personas. Where capabilities are mock, partial, or not production-ready, that is called out explicitly.

## 4. Persona Summary

| Persona | System Role / Access | Primary Job | Main Success Signal |
| --- | --- | --- | --- |
| Solo Creator | Personal `user` | Generate, organize, and schedule content without a team. | Creates usable content and schedules it quickly. |
| Small Business Owner | Personal `user`, future or current `org_owner` | Keep brand content consistent while running the business. | Has a reliable weekly content plan with minimal manual coordination. |
| Org Contributor | Org `contributor` or `member` | Create drafts, complete assigned work, and submit content for review. | Drafts move through review without confusion or lost context. |
| Editor / Reviewer | Org `editor` or `reviewer` | Review, refine, approve, reject, or request changes on team content. | Review decisions are clear, timely, and traceable. |
| Org Owner / Admin | Org `org_owner` or `org_admin` | Manage people, permissions, brand standards, pipelines, credits, and shared accounts. | The team operates safely without bottlenecks or brand drift. |
| External Client Reviewer | Tokenized `/review/:clientReviewToken` visitor | Approve or request changes without learning the full app. | Completes review in one focused session. |
| Platform Admin / Operator | `super_admin` or admin-capable scoped role | Govern users, orgs, moderation, complaints, account health, logs, and platform risk. | Resolves operational issues quickly with audit visibility. |

## 5. Persona to System Role Map

| Persona | App Context | Route Family | Role / Permission Source |
| --- | --- | --- | --- |
| Solo Creator | Personal workspace | `/app/dashboard`, `/app/generate`, `/app/calendar`, `/app/library`, `/app/analytics`, `/app/settings`, `/app/help` | Supabase Auth user plus profile/settings. |
| Small Business Owner | Personal or organization workspace | Personal routes plus `/app/org/:orgId/*` when org exists | `user`, `org_owner`, or owner membership. |
| Org Contributor | Organization workspace | `/app/org/:orgId/workspace`, `/office`, `/pipeline`, `/calendar`, `/library`, `/common-room`, `/team-activity` | `organization_members.role`, role templates, permission overrides. |
| Editor / Reviewer | Organization workspace | Org member routes, especially `/pipeline`, `/calendar`, `/library`, `/common-room` | `editor` or `reviewer`; editor defaults include publishing/scheduling permissions, reviewer defaults do not. |
| Org Owner / Admin | Organization admin workspace | `/app/org/:orgId/overview`, `/admin/brand-kit`, `/admin/members`, `/admin/roles`, `/admin/pipelines`, `/admin/credits`, `/admin/settings` | `org_owner` or `org_admin`; full default org permissions. |
| External Client Reviewer | Public external review | `/review/:clientReviewToken` | Tokenized review access through pipeline/client review service. |
| Platform Admin / Operator | Platform admin workspace | `/app/admin/*` | `super_admin` or admin-capable role resolved by auth/admin helpers. |

## 6. Primary Personas

### 6.1 Solo Creator

**Persona label:** Independent creator, freelancer, consultant, or solo marketer.  
**Access model:** Authenticated personal user.  
**Primary workspace:** Personal workspace.

**Background**

The Solo Creator is responsible for their own content production. They may not have a marketing team, designer, strategist, or operations assistant. Their main constraint is time: they need to create enough content to stay visible without spending the whole day planning posts.

**Goals**

- Generate useful captions, images, videos, and post ideas quickly.
- Keep a small content library organized.
- Schedule content ahead of time.
- Maintain brand voice without re-explaining it every session.
- Understand what is drafted, scheduled, published, or failed.
- Connect social accounts when real OAuth becomes available.

**Pain Points**

- Blank-page anxiety when creating posts.
- Inconsistent tone between posts.
- Manual file and caption organization.
- Forgetting what is already scheduled.
- Low tolerance for setup complexity.
- Confusion if mock publishing looks like real publishing.

**Primary Routes**

- `/app/dashboard`
- `/app/generate`
- `/app/generate/:sessionId`
- `/app/calendar`
- `/app/library`
- `/app/analytics`
- `/app/settings`
- `/app/settings/brand-kit`
- `/app/help`

**Primary Workflows**

1. Sign up or log in.
2. Complete or update brand kit.
3. Generate content from a prompt.
4. Select or revise the output.
5. Add caption, hashtags, SEO, or metadata.
6. Save as draft or schedule.
7. Review drafts and scheduled posts in calendar/library.
8. Check dashboard and analytics for progress.

**Features They Use Most**

- Generation workspace
- Brand kit
- Calendar
- Library
- Personal settings
- Connected accounts
- Help and complaints
- Dashboard KPIs

**Success Criteria**

- Can create a draft in minutes.
- Can schedule several posts without leaving the app.
- Can find previous content easily.
- Understands whether content is draft, scheduled, publishing, published, or failed.
- Does not need to understand org/admin concepts.

**UX Expectations**

- Fast, creative, and low-friction.
- Clear empty states with immediate actions.
- Minimal operational jargon.
- Strong visual preview of generated media.
- Obvious next step after generation.
- Gentle recovery paths when AI, media, or Edge Functions fail.

**Product Risks**

- If generation fails silently, trust drops quickly.
- If scheduling/publishing states are unclear, the creator may duplicate posts.
- If mock publishing is not labeled clearly, expectations can become misaligned.

### 6.2 Small Business Owner

**Persona label:** Owner-operator, founder, local business owner, agency founder, or lean marketing lead.  
**Access model:** Personal user, organization owner, or organization admin depending on account maturity.  
**Primary workspace:** Personal workspace first, organization workspace as team grows.

**Background**

The Small Business Owner cares less about content tooling for its own sake and more about business consistency. They may delegate content to a staff member or freelancer, but they still need control over brand quality, publishing cadence, and account access.

**Goals**

- Keep content going every week.
- Make sure posts sound like the business.
- Avoid missed campaigns or forgotten drafts.
- Delegate content creation safely.
- Review work before it goes live.
- Control shared accounts, credits, and member access.

**Pain Points**

- No time to micromanage content.
- Team members may not understand brand voice.
- Content approvals happen in chats, email, or spreadsheets.
- Shared social credentials are risky.
- Publishing confidence is low without visibility.

**Primary Routes**

Personal stage:

- `/app/dashboard`
- `/app/generate`
- `/app/calendar`
- `/app/library`
- `/app/settings/brand-kit`

Organization stage:

- `/app/org/:orgId/overview`
- `/app/org/:orgId/calendar`
- `/app/org/:orgId/pipeline`
- `/app/org/:orgId/admin/brand-kit`
- `/app/org/:orgId/admin/members`
- `/app/org/:orgId/admin/settings`

**Primary Workflows**

1. Create personal content and brand kit.
2. Upgrade into organization or agency-style workspace.
3. Invite collaborators.
4. Set roles and permissions.
5. Configure brand kit and pipeline.
6. Review upcoming calendar and approvals.
7. Approve or request changes.
8. Monitor account health and credit usage.

**Features They Use Most**

- Brand kit
- Calendar
- Pipeline
- Org overview
- Members and invitations
- Roles and permissions
- Shared connected accounts
- Credits

**Success Criteria**

- Knows what is going out and when.
- Can delegate without losing control.
- Can approve content before publishing.
- Can see whether the team is blocked.
- Can keep brand voice consistent across contributors.

**UX Expectations**

- Summary-first screens.
- Clear operational alerts.
- Simple approve/request-change actions.
- Role and permission language that does not require technical knowledge.
- Reliable audit/history for important decisions.

**Product Risks**

- If org setup feels too technical, owners will stay in personal mode.
- If approvals are buried, business-critical review will happen outside the app.
- If role permissions are unclear, admins may over-permission team members.

### 6.3 Org Contributor

**Persona label:** Content producer, junior marketer, social media assistant, freelancer, or team member.  
**Access model:** Organization member, usually `contributor` or `member`.  
**Primary workspace:** Organization member workspace.

**Background**

The Org Contributor creates and updates content assigned by an organization. They need enough context to do good work, but they should not need broad admin permissions. They usually submit work into a pipeline instead of publishing directly.

**Default Role Behavior**

Default contributor/member permissions are intentionally limited:

- cannot publish
- cannot schedule
- cannot manage library
- cannot approve library uploads
- cannot manage tasks
- cannot invite members
- cannot create channels
- has a default monthly credit limit

Actual permissions can be changed by role templates and member overrides.

**Goals**

- Understand assigned work.
- Generate or draft content using brand/project context.
- Use approved assets.
- Submit work for review.
- Respond to revision requests.
- Avoid accidentally publishing or changing shared settings.

**Pain Points**

- Unclear assignment ownership.
- Not knowing which brand/project context applies.
- Review feedback scattered across tools.
- Limited permissions without explanation.
- Task and draft status confusion.

**Primary Routes**

- `/app/org/:orgId/workspace`
- `/app/org/:orgId/office`
- `/app/org/:orgId/pipeline`
- `/app/org/:orgId/calendar`
- `/app/org/:orgId/library`
- `/app/org/:orgId/common-room`
- `/app/org/:orgId/team-activity`

**Primary Workflows**

1. Accept invitation at `/join`.
2. Land in org workspace.
3. Review assigned tasks and action-required items.
4. Create content in My Office.
5. Attach relevant assets or context.
6. Submit draft to pipeline.
7. Receive revision request.
8. Update draft and resubmit.

**Features They Use Most**

- My Workspace
- My Office
- Org Generate Composer
- Pipeline
- Task board/panel
- Asset library
- Common Room
- Notifications

**Success Criteria**

- Always knows what to work on next.
- Can create and submit content without admin help.
- Can see why a draft was rejected or returned.
- Does not accidentally publish content.
- Can find brand and asset context quickly.

**UX Expectations**

- Task-oriented dashboard.
- Clear role-aware permissions.
- Strong labels for draft, review, revision, approved, and scheduled states.
- Feedback tied directly to the draft or pipeline item.
- No noisy admin controls.

**Product Risks**

- If permissions block a workflow without explanation, contributors may think the app is broken.
- If revision feedback is not attached to the content, quality loops become slow.
- If brand context is hidden, generated content may drift.

### 6.4 Editor / Reviewer

**Persona label:** Content editor, marketing lead, compliance reviewer, brand reviewer, or senior team member.  
**Access model:** Organization `editor` or `reviewer`.  
**Primary workspace:** Organization member workspace with review emphasis.

**Background**

The Editor / Reviewer protects quality. They decide whether content is ready, needs revisions, or should be rejected. Editors may have broader scheduling and publishing rights, while reviewers may only inspect and comment.

**Default Role Behavior**

Editor defaults:

- can publish
- requires final approval before publishing
- can schedule
- can manage library
- can manage tasks
- can create channels

Reviewer defaults:

- cannot publish
- cannot schedule
- cannot manage library
- cannot manage tasks
- cannot create channels
- monthly credit limit is 0

Actual behavior can be customized by role templates and overrides.

**Goals**

- Review submitted content quickly.
- Compare draft, caption, media, platform, brand guidance, and schedule context.
- Approve, reject, or request changes with clear feedback.
- Keep review queues moving.
- Route items into client review when needed.
- Prevent off-brand or incomplete posts from publishing.

**Pain Points**

- Review context split across draft, task, asset, and calendar pages.
- Vague revision requests.
- No single view of bottlenecks.
- Hard to know whether a client already reviewed something.
- Overlapping internal review and external review responsibilities.

**Primary Routes**

- `/app/org/:orgId/workspace`
- `/app/org/:orgId/pipeline`
- `/app/org/:orgId/calendar`
- `/app/org/:orgId/library`
- `/app/org/:orgId/common-room`
- `/app/org/:orgId/team-activity`

**Primary Workflows**

1. Open review queue.
2. Inspect submitted item.
3. Check brand, media, platform, and caption readiness.
4. Add reviewer comment.
5. Approve, reject, or request revision.
6. Generate or monitor client review link when needed.
7. Move approved content toward schedule/publish flow if permitted.

**Features They Use Most**

- Pipeline board
- Calendar approval tracker/status board
- Task views
- Asset library
- Common Room references
- Client review link workflows
- Notifications

**Success Criteria**

- Review decisions take minutes, not meetings.
- Feedback is specific and visible to contributors.
- Review backlog is easy to scan.
- Approved content is ready for scheduling.
- Client review state is visible where relevant.

**UX Expectations**

- Dense but readable review surfaces.
- Side-by-side content and metadata.
- One clear place for reviewer feedback.
- Strong status badges and filters.
- Keyboard and mobile access for simple approve/request-change actions.

**Product Risks**

- If review state is unclear, teams may publish unfinished content.
- If the review UI hides platform or brand context, quality decisions weaken.
- If client review is not visible to internal reviewers, duplicate review loops may happen.

### 6.5 Org Owner / Admin

**Persona label:** Organization owner, agency operator, team admin, marketing operations lead.  
**Access model:** `org_owner` or `org_admin`.  
**Primary workspace:** Organization admin workspace.

**Background**

The Org Owner / Admin configures the operating system for the team. They do not necessarily create every post, but they decide who can do what, how approvals work, how brand rules are enforced, and how shared resources are managed.

**Default Role Behavior**

Org owner/admin defaults include:

- can publish
- can schedule
- can manage library
- can approve library uploads
- can manage tasks
- can invite members
- can create channels
- no default monthly credit cap

**Goals**

- Invite and manage members.
- Assign roles and permissions safely.
- Configure review pipelines.
- Maintain brand kit and brand projects.
- Manage shared connected accounts.
- Track credits and usage.
- Monitor team workload, schedule, and bottlenecks.
- Keep organization content inside the correct brand/project scope.

**Pain Points**

- Permission systems can be confusing.
- Role changes may have hidden workflow effects.
- Credit usage can be hard to govern.
- Shared account failures can block publishing.
- Brand governance often depends on manual reminders.

**Primary Routes**

- `/app/org/:orgId/overview`
- `/app/org/:orgId/admin/brand-kit`
- `/app/org/:orgId/admin/members`
- `/app/org/:orgId/admin/roles`
- `/app/org/:orgId/admin/pipelines`
- `/app/org/:orgId/admin/credits`
- `/app/org/:orgId/admin/settings`
- `/app/org/:orgId/calendar`
- `/app/org/:orgId/library`
- `/app/org/:orgId/pipeline`

**Primary Workflows**

1. Create or receive organization ownership.
2. Configure brand kit and default brand project.
3. Invite members.
4. Assign role templates and project scope.
5. Configure pipeline stages, assignments, SLAs, and client review steps.
6. Connect or manage shared accounts.
7. Review org overview and calendar pressure.
8. Approve credit requests or adjust limits.
9. Resolve bottlenecks across tasks, review, assets, and schedule.

**Features They Use Most**

- Org overview
- Members and invitations
- Roles
- Pipeline configuration
- Org brand kit
- Credit management
- Connected accounts admin
- Task status management
- Org calendar and asset library

**Success Criteria**

- Team members have the right access.
- Review pipeline matches the team's actual process.
- Brand rules are visible where content is created.
- Shared accounts and credits are controlled.
- Operational bottlenecks are visible before deadlines slip.

**UX Expectations**

- Structured, operational, and reliable.
- Strong confirmation patterns for destructive or permission-changing actions.
- Clear role impact previews.
- Tables and filters that support repeated admin work.
- Audit-oriented copy for invitations, role edits, credit decisions, and shared account actions.

**Product Risks**

- If role templates are too abstract, admins may misconfigure access.
- If pipeline configuration is disconnected from runtime behavior, teams will lose trust.
- If credits page stays read-only, admins cannot complete governance tasks in one place.

### 6.6 External Client Reviewer

**Persona label:** Client, stakeholder, executive approver, brand partner, or external reviewer.  
**Access model:** Tokenized public route.  
**Primary workspace:** External review page only.

**Background**

The External Client Reviewer is not a normal app user. They need to approve, reject, or request changes on a specific content item without learning SocialAI, joining the org workspace, or seeing internal operational details.

**Goals**

- Open a secure review link.
- Understand what content is being reviewed.
- Preview the draft and caption.
- Approve or request revisions.
- Leave clear feedback.
- Finish quickly.

**Pain Points**

- Too many app controls.
- Unclear context for what they are approving.
- Needing to create an account for a one-off review.
- Losing the review link.
- No confidence that feedback was received.

**Primary Routes**

- `/review/:clientReviewToken`

**Primary Workflows**

1. Receive review link from team.
2. Open public review page.
3. Preview content and context.
4. Approve or request changes.
5. Submit feedback.
6. See confirmation.

**Features They Use Most**

- Client review preview
- Approve action
- Request-change action
- Feedback input
- Token validation and confirmation states

**Success Criteria**

- Completes review without login friction.
- Understands exactly what they are approving.
- Feedback returns to the internal pipeline.
- Expired or invalid links explain next steps.

**UX Expectations**

- Minimal and focused.
- Branded enough to build trust.
- No sidebar, admin controls, workspace navigation, or unrelated app complexity.
- Clear success and error states.
- Mobile-friendly because many clients review from email or chat links.

**Product Risks**

- If the link expires or fails without useful messaging, clients contact the team outside the app.
- If internal-only information appears, org trust is damaged.
- If feedback is too unstructured, reviewers create vague revision loops.

### 6.7 Platform Admin / Operator

**Persona label:** Internal admin, support operator, moderation reviewer, platform operations lead, or super admin.  
**Access model:** Platform admin workspace.  
**Primary workspace:** Admin control plane.

**Background**

The Platform Admin / Operator manages SocialAI as a service. They investigate user issues, monitor risk, moderate content, inspect logs, support organizations, handle complaints, and maintain connected-account health.

**Role Scope**

- `super_admin` has platform-wide scope.
- `org_admin` is admin-capable in current route/RBAC helpers, with scoped behavior depending on admin access resolution.
- Admin navigation distinguishes some super-admin-only pages, such as connected account maintenance and organization governance.

**Goals**

- Monitor platform health.
- Investigate users and organizations.
- Moderate content and publishing state.
- Triage complaints.
- Notify users.
- Inspect audit logs and connection events.
- Maintain connected accounts.
- Create or support organization onboarding.

**Pain Points**

- Need dense information without losing context.
- Risk of taking destructive action on the wrong user/content/org.
- Partial mock analytics can confuse operational confidence.
- Edge Function availability can affect moderation and account workflows.
- Admin settings are partly local-only.

**Primary Routes**

- `/app/admin`
- `/app/admin/users`
- `/app/admin/users/:userId`
- `/app/admin/accounts`
- `/app/admin/organizations`
- `/app/admin/organizations/:orgId`
- `/app/admin/moderation`
- `/app/admin/complaints`
- `/app/admin/complaints/:complaintId`
- `/app/admin/logs`
- `/app/admin/analytics`
- `/app/admin/settings`

**Primary Workflows**

1. Open admin overview.
2. Inspect alerts, complaints, or account severity.
3. Search for a user, organization, post, complaint, or log event.
4. Review content, metadata, account health, and audit history.
5. Take action: notify, suspend, assign, approve, archive, force schedule/publish, resolve, or escalate.
6. Confirm action and verify audit/log outcome.

**Features They Use Most**

- Admin overview
- User directory and user detail
- Moderation workspace
- Complaints queue/detail
- Logs
- Admin analytics
- Connected account maintenance
- Organization governance
- Admin notifications and notes

**Success Criteria**

- Can find the relevant user/content/org quickly.
- Can understand why something failed or was flagged.
- Can take action with confirmation and auditability.
- Can separate real data from mock/placeholder analytics.
- Can recover from missing optional Edge Functions gracefully.

**UX Expectations**

- Dense, searchable, filterable.
- Tables, drawers, detail panels, and audit trails over marketing-style layouts.
- Clear severity, risk, and status labels.
- Confirmation before destructive or high-impact actions.
- Strong source-of-truth indicators and timestamps.

**Product Risks**

- If admin roles are ambiguous, data exposure risk increases.
- If actions lack audit trails, operational accountability weakens.
- If mock data is not labeled, admins may make wrong decisions.

## 7. Secondary and Adjacent Personas

| Persona | Why They Matter | Current Product Fit |
| --- | --- | --- |
| Agency Account Manager | Manages multiple client brands and approval loops. | Partially supported through org/agency plan concepts, brand projects, pipelines, and client review links. |
| Brand Manager | Owns voice, visual rules, and quality standards. | Supported through personal/org brand kit, review workflows, and asset library. |
| Support Reporter | User who submits a help issue or complaint. | Supported through `/app/help`, complaint categories, screenshots, comments, and admin complaint workflows. |
| Developer / Implementer | Maintains and extends the product. | Supported through technical docs, handoff docs, feature inventory, and constraints docs. |

These are not separate primary personas yet, but they should influence roadmap and support documentation.

## 8. Persona Priority by Product Stage

| Stage | Highest Priority Personas | Reason |
| --- | --- | --- |
| Demo-ready MVP | Solo Creator, Small Business Owner, Platform Admin | Demonstrates core generation, scheduling, and oversight value. |
| Operational MVP | Solo Creator, Org Contributor, Editor / Reviewer, Org Owner / Admin | Proves team collaboration and workflow governance. |
| Agency / Team Scale | Org Owner / Admin, Editor / Reviewer, External Client Reviewer | Enables multi-person approvals and client-facing review. |
| Production Operations | Platform Admin / Operator, Support Reporter | Ensures reliability, trust, moderation, account health, and complaint handling. |

## 9. Key Workflows by Persona

| Workflow | Solo Creator | Small Business Owner | Org Contributor | Editor / Reviewer | Org Owner / Admin | External Client | Platform Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sign up / login | Primary | Primary | Primary via invite | Primary via invite | Primary | None or link-only | Primary |
| Complete brand kit | Primary | Primary | Reference only | Reference only | Primary | None | Low |
| Generate content | Primary | Medium | Primary | Medium | Medium | None | Low |
| Save draft | Primary | Medium | Primary | Medium | Medium | None | Low |
| Submit to pipeline | None in personal | Medium | Primary | Medium | Medium | None | Low |
| Review or request revision | Self-review | Medium | Responds to review | Primary | Primary | Primary on token | Medium |
| Schedule content | Primary | Primary | Usually no | Editor/admin only | Primary | None | Force/admin path |
| Publish content | Mock/pending live | Mock/pending live | Usually no | Editor/admin only | Primary | None | Force/admin path |
| Manage members | None | If org owner | None | None | Primary | None | Support/escalation |
| Manage roles | None | If org owner | None | None | Primary | None | Support/escalation |
| Manage complaints | Submit only | Submit only | Submit only | Submit only | Org context only | None | Primary |
| Investigate users/orgs | None | None | None | None | Own org only | None | Primary |

## 10. Feature Relevance Matrix

Legend: `High` = core workflow, `Medium` = useful or occasional, `Low` = rare/supporting, `None` = should not be exposed.

| Feature Area | Solo Creator | Small Business Owner | Org Contributor | Editor / Reviewer | Org Owner / Admin | External Client | Platform Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Personal dashboard | High | High | Low | Low | Low | None | Low |
| Generate workspace | High | Medium | High | Medium | Medium | None | Low |
| Brand kit | High | High | Reference | Reference | High | Low | Low |
| Personal calendar | High | High | None | None | None | None | Low |
| Personal library | High | Medium | None | None | None | None | Low |
| Org workspace home | None | Medium | High | Medium | Medium | None | Low |
| My Office | None | Medium | High | Medium | Low | None | Low |
| Pipeline board | None | Medium | Medium | High | High | None | Medium |
| Org calendar | None | High | Medium | High | High | None | Medium |
| Org asset library | None | Medium | Medium | High | High | None | Low |
| Common Room | None | Medium | Medium | Medium | Medium | None | Low |
| Members and roles | None | High | None | Low | High | None | Medium |
| Pipeline configuration | None | High | None | Low | High | None | Low |
| Credits | Medium | High | Low | Low | High | None | Medium |
| Client review page | None | Medium | Low | High | High | High | Low |
| Help and complaints | Medium | Medium | Medium | Medium | Medium | None | High |
| Admin moderation | None | None | None | None | None | None | High |
| Admin logs/analytics | None | None | None | None | None | None | High |

## 11. Permissions and Access Matrix

| Capability | Personal User | Contributor / Member | Reviewer | Editor | Org Owner / Admin | External Client | Platform Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Access personal workspace | Yes | Yes, if account exists | Yes, if account exists | Yes, if account exists | Yes, if account exists | No | Yes, if user account |
| Access org workspace | No unless member | Yes | Yes | Yes | Yes | No | Only through admin/support surfaces unless also member |
| Access org admin pages | No | No | No | No by default | Yes | No | Platform admin surfaces only |
| Generate personal content | Yes | Yes in personal context | Yes in personal context | Yes in personal context | Yes in personal context | No | Not primary |
| Generate org-scoped content | No | Yes, subject to credits/context | Usually no or limited | Yes, if allowed | Yes | No | Not primary |
| Publish personal content | Yes in mock/current scope | Personal only | Personal only | Personal only | Personal only | No | Admin force actions only |
| Publish org content | No | No by default | No by default | Yes by default, final approval required | Yes | No | Admin force actions only |
| Schedule org content | No | No by default | No by default | Yes by default | Yes | No | Admin force actions only |
| Manage org library | No | No by default | No by default | Yes by default | Yes | No | Support/admin only |
| Invite members | No | No by default | No by default | No by default | Yes | No | Org onboarding support |
| Manage roles | No | No | No | No | Yes | No | Support/admin only |
| Review via public token | No | If link holder | If link holder | If link holder | If link holder | Yes | If link holder |
| Moderate platform content | No | No | No | No | No | No | Yes |
| View audit/log data | Own workflow only | Own/org workflow only | Own/org workflow only | Own/org workflow only | Org-level where surfaced | No | Yes |

## 12. UX Implications

### 12.1 Personal Workspace UX

Design for speed and confidence:

- Start from creation, not configuration.
- Keep generation, post-production, schedule, and library handoff obvious.
- Explain missing integrations or mock publishing without blame.
- Make brand kit setup feel like a creative helper, not an admin chore.
- Keep org/admin concepts out of personal pages unless the user explicitly switches context.

### 12.2 Organization Contributor UX

Design for task clarity:

- Show assigned work and review status first.
- Make permission restrictions understandable.
- Keep brand/project context visible in drafting.
- Attach reviewer comments to the exact content item.
- Make resubmission obvious after revision requests.

### 12.3 Reviewer UX

Design for judgment:

- Present content, caption, platform, assets, schedule, and brand context together.
- Make approve, reject, and request-change actions easy to distinguish.
- Require useful feedback when rejecting or requesting revision.
- Expose queue filters and status transitions.
- Avoid hiding client-review state in a separate disconnected surface.

### 12.4 Org Admin UX

Design for control and safety:

- Show the impact of role and permission edits.
- Confirm destructive or high-impact actions.
- Surface bottlenecks across pipeline, calendar, tasks, assets, and account health.
- Keep member, role, pipeline, credit, and shared-account controls consistent.
- Use audit-friendly language and timestamps.

### 12.5 External Reviewer UX

Design for one task:

- No full app navigation.
- Clear content preview and action buttons.
- Minimal required fields.
- Mobile-first review experience.
- Clear confirmation, expired link, and invalid token states.

### 12.6 Platform Admin UX

Design for high-volume operations:

- Search, filter, sort, and drill down quickly.
- Keep source labels clear when data is mock, computed, or live.
- Show severity, risk, status, and timestamps consistently.
- Provide safe confirmations for destructive actions.
- Make audit trails and notes visible near action surfaces.

## 13. Persona-Specific Success Metrics

| Persona | Useful Metrics |
| --- | --- |
| Solo Creator | Time to first draft, generations per session, drafts scheduled, brand kit completion, failed generation recovery rate. |
| Small Business Owner | Weekly scheduled posts, approval turnaround time, brand kit completeness, account health, delegation activity. |
| Org Contributor | Assigned tasks completed, drafts submitted, revision cycle count, time from draft to review, credit usage. |
| Editor / Reviewer | Review queue size, approval/revision/rejection count, average review time, overdue reviews, client-review completion rate. |
| Org Owner / Admin | Members active, pipeline throughput, credit usage, account health, blocked items, role/permission changes. |
| External Client Reviewer | Link open rate, review completion rate, approve vs change-request ratio, expired/invalid token rate. |
| Platform Admin / Operator | Complaint resolution time, moderation backlog, account severity resolution, audit coverage, user/org investigation time. |

## 14. Current Product Constraints by Persona

| Constraint | Affected Personas | Impact |
| --- | --- | --- |
| Real social OAuth is not complete. | Solo Creator, Small Business Owner, Org Owner / Admin | Connected accounts and publishing remain mock-oriented. |
| Live auto-publishing is not complete. | Solo Creator, Org Editor/Admin, Platform Admin | Publishing status must be presented carefully. |
| Some analytics are mock or placeholder. | Small Business Owner, Org Admin, Platform Admin | Analytics should not be used as production truth without validation. |
| Credits page is partially read-only in org admin docs. | Org Owner / Admin | Credit governance is not fully self-service everywhere. |
| Client-review generation and visibility are partially wired in some member surfaces. | Editor / Reviewer, Org Admin, External Client | Review link workflow may need clearer UI ownership. |
| Automated test coverage is thin. | All personas indirectly | Persona flows need manual QA and targeted regression checks. |
| Role/admin scope has compatibility nuances. | Org Admin, Platform Admin | Access behavior must be tested carefully when changing RBAC. |

## 15. Manual QA Scenarios by Persona

### Solo Creator

1. Register or log in.
2. Complete brand kit.
3. Generate content.
4. Save draft.
5. Schedule draft.
6. Confirm dashboard, calendar, and library reflect the same lifecycle.

### Small Business Owner

1. Create or access org.
2. Configure brand kit.
3. Invite contributor.
4. Assign role.
5. Review upcoming calendar and pipeline.
6. Approve or request changes.

### Org Contributor

1. Accept invitation.
2. Open workspace.
3. Create draft in My Office.
4. Submit to pipeline.
5. Receive revision request.
6. Update and resubmit.

### Editor / Reviewer

1. Open pipeline queue.
2. Inspect draft details and brand context.
3. Request changes with comment.
4. Approve a revised item.
5. Confirm item appears correctly in calendar/review state.

### Org Owner / Admin

1. Open org overview.
2. Invite member.
3. Update role template.
4. Configure pipeline.
5. Manage connected account or task statuses.
6. Verify member access reflects the changes.

### External Client Reviewer

1. Open tokenized review link.
2. Preview content.
3. Submit approval.
4. Open another token and request changes.
5. Confirm invalid or expired token behavior is clear.

### Platform Admin / Operator

1. Open admin overview.
2. Search user.
3. Open user detail.
4. Review moderation item.
5. Update complaint status.
6. Inspect logs or connection events.
7. Confirm action is auditable.

## 16. Content and Messaging Guidance

| Persona | Preferred Messaging |
| --- | --- |
| Solo Creator | Action-oriented, encouraging, creative, plain language. |
| Small Business Owner | Outcome-oriented, time-saving, control without complexity. |
| Org Contributor | Clear task instructions, permission explanations, feedback loops. |
| Editor / Reviewer | Precise review language, quality and readiness labels. |
| Org Owner / Admin | Operational clarity, policy impact, governance language. |
| External Client Reviewer | Minimal, direct, confidence-building. |
| Platform Admin / Operator | Dense, factual, audit-ready, severity-aware. |

Avoid using the same copy style everywhere. A creator needs momentum; an admin needs certainty.

## 17. Product Decisions This Document Should Influence

1. **Navigation:** Users should only see routes that match their workspace and permissions.
2. **Empty states:** Empty states should be persona-specific, such as "create first draft" for creators and "invite first member" for org admins.
3. **Permissions:** Denied actions should explain whether the user lacks access, needs approval, or is in the wrong workspace.
4. **Status labels:** Lifecycle language must stay consistent across personas.
5. **Onboarding:** Personal signup, org invitation, and external review should remain separate flows.
6. **Mobile:** External review and personal creation flows must work well on small screens.
7. **Admin UX:** Admin pages should favor dense scanning and filters over decorative layouts.
8. **Mock states:** Mock publishing and placeholder analytics must be labeled clearly for all affected personas.

## 18. Open Questions

These questions should be answered through product decisions, user interviews, or implementation planning:

1. Should agencies become a separate primary persona with multi-client workflows?
2. Should External Client Reviewers ever have accounts, or should they remain token-only?
3. Should reviewer and editor be split into separate first-class product personas?
4. Should org admins and platform admins share any UI patterns, or remain visually distinct control planes?
5. What is the exact boundary between `org_admin` as organization admin and `org_admin` as admin-capable platform role?
6. Which persona is the primary revenue buyer: Solo Creator, Small Business Owner, Agency Owner, or Internal Marketing Team?
7. Which analytics are safe to present as production truth before real platform APIs are connected?
8. What upgrade path should move a Solo Creator into an organization workspace?

## 19. Maintenance Checklist

Update this document when:

- a new route family is added
- org roles or permissions change
- platform admin role behavior changes
- real OAuth or real publishing is implemented
- client review flows change
- onboarding or invitation behavior changes
- a new buyer segment becomes a product priority
- `docs/FEATURE_INVENTORY.md` changes the product model

## 20. Bottom Line

SocialAI serves two linked worlds:

- creators and teams trying to produce better content faster
- admins and operators trying to keep content, access, review, and publishing safe

The product should stay fast and creative for personal users, structured and collaborative for organization members, controlled and auditable for organization admins, minimal for external reviewers, and dense but reliable for platform operators.

