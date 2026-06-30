# Org Workspace — Technical Spec

Updated: 2026-06-23
Scope: Everything a multi-user organization (team/agency) can do in Brandosse, **excluding the Org Calendar and the Org Asset Library entirely**, and excluding Brandosse's own internal platform-staff admin panel (`src/admin/**`, which manages *all* customers and is a different product surface from the org's own admin pages). Those are out of scope here.

Companion document: `docs/PERSONAL_WORKSPACE_SPEC.md` (solo/individual side of the product).

---

## 1. Org scoping mechanics

Every org page in this document lives inside an `OrgContextProvider` (`src/org/context/OrgContextProvider.jsx`), which loads once per org route via `fetchOrganizationContext({ organizationId, userId })` and exposes:

```js
{
  organization, membership, role,              // org_owner | org_admin | editor | contributor | reviewer | member
  permissions,                                  // resolved boolean flags, see §9
  brandProjects, activeBrandProject,
  isMember, isOrgAdmin, isOrgOwner, isAgency,
  organizationId, brandProjectId,
  hasPermission(key), refresh(), setActiveBrandProjectId(id),
}
```

A parallel Zustand store, `src/org/stores/orgRuntimeStore.js`, mirrors the active `organizationId` / `brandProjectId` synchronously for code that can't `useContext` (this is what `getActiveOrgScope()` reads, which is how `SessionStore.js` — see the Personal spec, §1 — knows to switch every generation/draft/post query from personal to organization scope the instant a user enters an org).

Every org service function takes the same shape: filter by `organization_id` first, optionally narrow by `brand_project_id` second:

```js
supabase.from('assets').select('*').eq('organization_id', organizationId)
  [.eq('brand_project_id', brandProjectId)]
```

No query in `src/org/services/**` omits the `organization_id` filter — this is the enforced boundary that keeps one org's content, members, and brand kit invisible to another org, backed by Supabase RLS at the database layer. `brand_project_id` is the secondary, optional scope used by agencies running multiple client brands inside one org.

---

## 2. Roles & navigation shell

Files: `src/org/components/OrgSidebar.jsx`, `src/org/components/OrgTopNavbar.jsx`.

**Sidebar, visible to every role:**
- My Workspace, My Office, Pipeline, Calendar*, Asset Library*, Common Room.

*(Calendar and Asset Library exist in the sidebar but are out of scope for this document — see header.)*

**Visible only to `org_owner` / `org_admin`:**
- Overview, Team Activity (base nav items)
- Members, Brand Kit, Roles & Permissions, Pipelines, Credit Management, Org Settings (collapsible "admin" menu group)

Other shell details: collapse state persisted to `localStorage`; a badge on "Pipeline" sourced from `usePipelineTaskBadgeCount()`; an org switcher in the top navbar for users who belong to more than one org; active-route highlighting; mobile-responsive drawer.

---

## 3. Org Overview *(admin-facing dashboard)*

File: `src/org/pages/OrgOverview.jsx`.

Rendering branches on `isOrgAdmin`:

**Admins see** an org-wide operational view: active member count, scheduled-this-week count, an "approved queue" count (content approved but not yet placed), recent asset activity (7 days), the next 5 scheduled posts with who scheduled them, an "Ops Pulse" panel surfacing pipeline bottlenecks by stage and approval pressure, and the org-level Account Health card (§8).

**Regular members see** a narrower, personal-relevance cut of the same org: items awaiting their feedback, what's scheduled this week, what's ready to schedule, and a read-only "Workspace Pulse" with no bottleneck analytics.

Data comes from `useOrgCalendar()` (aggregated snapshot of `posts` + `pipeline_items`, scoped to `organization_id`) and `useOrgAssets()` (recent-asset counts).

---

## 4. My Office — drafting workspace

File: `src/org/pages/MyOffice.jsx`.

This is where an individual member creates and prepares content *before* it enters team review. Day-to-day actions:

1. Generate new content via `OrgGenerateComposer` (§6) or pick up an existing draft.
2. Filter drafts by brand project (or "all brands" for agencies).
3. Edit a draft through `OrgDraftWorkflowModal`.
4. **Submit a draft to the pipeline** — `submitPostToPipeline()` (`src/org/services/pipelineService.js:486`), which:
   - Resolves a `brand_project_id` if one isn't already set on the draft.
   - Picks a pipeline config (an explicit one, or the org's default if none given).
   - Computes the initial stage and writes a `pipeline_items` row with `status: 'in_review'`, the resolved assignee (role or specific user), an SLA deadline if the stage defines one, and a `history` array seeded with a `submitted` event.
   - Links the originating `posts` row to the new `pipeline_items.id`.
   - Surfaces pre-submit validation warnings (missing caption, platform not yet chosen, missing media) without blocking submission outright.
5. See their own recent submissions in a sidebar (8 most recent, filtered to `submitted_by === currentUser`).
6. Delete a draft outright (with confirmation).

Once submitted, the draft is no longer "owned" by My Office — it moves into the Pipeline (§5) for review.

---

## 5. My Workspace — action & approval hub

File: `src/org/pages/MyWorkspace.jsx`.

Where My Office is "things I'm making," My Workspace is "things that need me, today." It assembles four action queues, each capped at 2 visible items with a link to see more:

| Queue | Source filter |
|---|---|
| Revisions to pick up | `pipeline_items.status === 'revision_requested'` and `submitted_by === me` |
| Ready to schedule | `pipeline_items.status === 'approved'`, not yet scheduled, only shown if the member's role `can_schedule` |
| Tasks due soon | org tasks where `assignee_user_id === me`, sorted by due date |
| Blocked tasks | org tasks flagged blocked, with a block reason |

A revision item can be picked up and resubmitted directly ("Revise and Resubmit"). An approved item can be scheduled via a schedule modal right from this hub. Below the personal queues sits a collapsible "Team Pulse" — org-wide approved-queue size, items in review, and task health — visible to everyone but read-only for non-admins.

Per-member UI state (which alerts have been dismissed, whether Team Pulse is collapsed) persists server-side via `fetchOrgMemberDashboardState()` / `saveOrgMemberDashboardState()` (`src/org/services/memberWorkspaceService.js`), so it survives across devices/sessions rather than living in `localStorage`.

---

## 6. Org Generate Composer

File: `src/org/components/OrgGenerateComposer.jsx`.

A modal wrapper around the same Generate Studio engine documented in the Personal spec (§5), re-pointed at org scope:

- Loads the **org's** Brand Kit (§7) instead of the personal one, via `useBrandKitStore()`.
- Tags the resulting session/generation/draft with `organizationId` and the active `brand_project_id`.
- Supports four intents beyond a blank slate: `revision` (re-open a draft a reviewer kicked back, pre-loaded with the reviewer's comment as `contextNote`), `repurpose` (start from an existing published/scheduled post), and `edit` (amend an existing draft) — each driven by `editPostId` + `mode` props.
- If the org's Brand Kit isn't set up yet, offers a redirect into the personal workspace's Brand Kit setup flow (org brand kits and personal brand kits share the same underlying setup UX).
- Generation search inside the composer (e.g. "continue from a past generation") is scoped by the session store's same org/personal switch described in §1 — it is not its own separate search system.

---

## 7. Pipeline — the approval workflow

This is the org workspace's defining feature: a configurable, multi-stage approval flow that every piece of org content passes through between "drafted" and "schedulable."

### 7.1 Pipeline Board (working the queue)

File: `src/org/pages/PipelineBoard.jsx`.

Two tabs:
- **Content Pipeline**: a list of all `pipeline_items` visible to the user (filterable: All / Submitted-by-me / Needs-my-review), each opening a detail drawer with full metadata, stage-by-stage approval history, the latest revision comment if any, and action buttons — **Approve**, **Request Changes**, **Reject** — gated by `canUserReviewItem()`. That function returns true if the item is in a reviewable status (`pending`/`in_review`) *and* the current user is either elevated (owner/admin/editor), specifically assigned (`current_assignee_user_id`), or matches the stage's required role (`current_assignee_role`). Approving an item that's on its final stage clears it for scheduling; approving an intermediate stage advances `current_stage_order` and reassigns to the next stage's owner. Request Changes / Reject require a comment if the stage was configured with `require_comment_on_rejection`.
- **Tasks**: delegates to `PipelineTasksPanel` — general org task tracking (board/table views, filters, status, due dates), independent of the content-approval flow.

Stage advancement calls an `pipeline-advance` edge function; approved items expose an inline schedule action (datetime input) if the user's role permits scheduling; stages flagged `generates_client_review_link` can mint a 72-hour external review token for sharing outside the org.

### 7.2 Pipeline configuration (admin-only)

File: `src/org/admin/PipelineConfigPage.jsx`.

Org admins define one or more named pipelines, each a sequence of stages. Per stage: name, order, description, assignee (a role, or one specific person), an SLA in hours (with an optional escalation user once the SLA lapses), whether a rejection requires a comment, whether the stage is skippable, and whether it should generate a client-facing review link. One pipeline can be marked the org's default; pipelines can also be scoped to a single brand project for agencies running different approval chains per client.

Four built-in templates seed new pipelines:
- **Standard**: Editorial Review (editor, 12h) → Final Approval (org_admin, 12h)
- **Agency Client**: Contributor Review (editor, 12h) → Client Review (reviewer, 24h, generates a review link) → Final (org_admin, 12h)
- **Fast Track**: Quick Review (editor, 6h) → Publish Approval (org_admin, 6h)
- **Compliance**: Editorial (editor, 12h) → Compliance (org_admin, 24h, requires comment) → Final (org_owner, 12h)

### 7.3 Draft-level operations (outside the approval flow itself)

File: `src/org/services/orgDraftWorkflowService.js` — these run on a draft *before or independent of* pipeline submission: metadata generation, SEO optimization/scoring, and cloning a draft to target a different connected account. The data model (`workflow_state` / `seo_state` JSON columns on `posts`) mirrors the personal-workspace metadata/SEO flow described in the Personal spec §5.3 almost exactly — it's the same underlying AI capability, exposed through an org-scoped service layer instead of `SessionStore.js` directly.

---

## 8. Org Brand Kit & Account Health

File: `src/org/admin/BrandKitPage.jsx`, `src/org/services/brandKitService.js`.

The org Brand Kit is the shared identity every member's generations draw from (loaded by the Org Generate Composer, §6): brand name/tagline/voice/tone/content pillars/target audience, banned phrases, per-platform approved hashtag sets, a prompt prefix + guidelines block that seeds generation prompts directly, logo asset references, a color palette, typography/visual-style notes, and a completeness score. Editable by org admins and by any member with `can_manage_library`; an `editors` list tracks who's been granted edit access beyond that.

**Org Account Health** (`src/org/components/OrgAccountHealthCard.jsx`): connected accounts at `scope: 'organization'` are shared publishing destinations — any permitted member can publish through them, as opposed to a personal connected account which belongs to one person. The card surfaces a pill ("All org accounts healthy" / "N accounts need attention"), weekly publish volume, and per-account health score + last publisher + last publish time, pulled the same way as the personal version (`connected_accounts_health_summary`) but filtered to organization scope. Individual members' personal connected accounts never appear here.

---

## 9. Members, Roles & Permissions

Files: `src/org/admin/MembersPage.jsx`, `src/org/admin/RolesPage.jsx`, `src/org/components/InviteMemberPanel.jsx`, `src/org/constants/permissions.js`, `src/org/services/orgService.js`, `src/pages/InvitationAccept/InvitationAcceptPage.jsx`.

### 9.1 System roles & default permissions

Six permission flags, each defaulted per system role in `ORG_ROLE_DEFAULTS` (`orgService.js:4`):

| Permission | org_owner | org_admin | editor | contributor | reviewer |
|---|---|---|---|---|---|
| `can_publish` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `publish_requires_final_approval` | ✗ | ✗ | ✓ | — | — |
| `can_schedule` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `can_manage_library` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `can_approve_library_uploads` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `can_manage_tasks` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `can_invite_members` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `can_create_channels` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `monthly_credit_limit` | none | none | none | 200 | 0 |

Read this table literally: an **editor** can publish, but every publish is gated behind a final approval step; a **contributor** can never publish or schedule directly and is capped at 200 AI credits/month — their only path to "live" is through the Pipeline (§7); a **reviewer** can't generate, publish, or schedule at all (0 credit limit) — their entire job is approving/rejecting items assigned to them in the Pipeline.

### 9.2 Custom roles & per-member overrides

`RolesPage.jsx` lets admins duplicate a system role or build a new one from scratch (`createOrgRoleTemplate`), naming it and toggling the same six flags. Beyond role defaults, `MembersPage.jsx` supports a **three-way override per permission per member** — inherit the role default, force-allow, or force-block — stored in `organization_members.permissions` and resolved at runtime by merging role defaults with the member's overrides. This is what lets an org give one specific contributor scheduling rights without promoting them to editor org-wide.

### 9.3 Invitations

1. Admin enters an email + role (+ optionally restricts to specific `brand_project_ids`) in `InviteMemberPanel`.
2. `inviteOrganizationMember()` writes an `organization_invitations` row and either sends an email or returns a manual link (delivery can report `failed_provider_error` if email infra isn't configured — the invite link itself still works either way).
3. The invitee opens `InvitationAcceptPage.jsx`, signs in or creates an account, and `acceptOrganizationInvitation(token)` converts the invitation into an `organization_members` row with the assigned role.

### 9.4 Team Activity

File: `src/org/pages/TeamActivity.jsx`. A working but intentionally minimal feed — it lists the 16 most recently updated `pipeline_items` (title + status + last-updated time) via `usePipelineItems()`. There's no granular "who changed what" audit trail beyond what the Pipeline's own per-item history already records; this page is a convenience roll-up, not a separate activity-logging system.

---

## 10. Common Room — team collaboration

File: `src/org/pages/CommonRoom.jsx`, `src/org/services/commonRoomService.js`.

A channel-based messaging surface, scoped by `organization_id` like everything else, with three channel shapes:

- **Org-wide channels** (`brand_project_id: null`) — visible to the whole org.
- **Brand-scoped channels** (`brand_project_id: <uuid>`) — visible only to members with access to that brand project; relevant for agencies.
- **Private groups** (`channel_type: 'private_group'`) — closed membership list (`member_ids`), a `group_admin_user_id` who manages settings, and an optional member cap.

Messages carry a `content_type`: plain `text`, or a structured `asset_reference` / `pipeline_reference` (a clickable card linking back to a shared asset or a specific pipeline item, with status/stage shown inline) — sent via dedicated picker modals rather than pasted links. Channels can optionally have an AI assistant enabled (`is_ai_enabled`); asking it invokes an edge function and posts the reply with `sender_type: 'ai'`. Creating channels, archiving them, and managing private-group membership are all gated by the `can_create_channels` permission (§9.1) or being the channel's own manager/admin.

---

## Consolidated list of mocked / stubbed / minimal behavior

1. **Team Activity** is a real but minimal recency feed of pipeline items, not a full audit log (§9.4).
2. **Invitation email delivery** can fail silently to a provider error while the invite link itself still works — worth knowing before assuming "invite sent" means "email arrived" (§9.3).
3. **Org Generate Composer's publish/schedule paths** inherit every mocked-publishing caveat from the Personal spec (§5.4 there): OAuth connections and immediate publish are simulated, regardless of whether the content originated personally or inside an org.
4. **Per-brand-project pipelines** and **member brand-project restrictions** are fully modeled in the data layer but only partially exposed in the current admin UI — the underlying fields exist and are read elsewhere (e.g. Common Room channel visibility), but you can't yet manage every angle of them from one screen.
