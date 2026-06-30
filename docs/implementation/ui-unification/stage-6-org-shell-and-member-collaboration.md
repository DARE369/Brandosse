# Stage 6 - Org Shell And Member Collaboration

## Objective
- Unify the shared org workspace shell and the main member-facing org routes so the navbar, sidebar, page well, and collaboration surfaces feel like one product family
- Bring `My Workspace`, `My Office`, `Common Room`, and the org composer closer to the Stage 1 shell quality and the Stage 5 creation-surface polish without changing org workflow behavior
- Keep the established org route personalities intact while making the chrome, elevation, and interaction language more consistent

## Implemented
- Added a Stage 6 org shell layer in [OrgWorkspace.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/OrgWorkspace.css:883) so the shared org navbar, menus, sidebar, content well, panel cards, and button primitives now resolve through one stronger shell treatment instead of the flatter earlier layer
- Refined the org top navbar, shell controls, sidebar, and content well in [OrgWorkspace.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/OrgWorkspace.css:922) and [OrgWorkspace.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/OrgWorkspace.css:1069)
- Refreshed the Common Room header, rail, chat surface, message cards, composer, and modal/picker shells in [CommonRoom.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/CommonRoom.css:1082) and [CommonRoom.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/CommonRoom.css:1090)
- Refreshed the `My Office` hero, shell panels, draft cards, pipeline items, and validation modal in [MyOffice.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/MyOffice.css:588) and [MyOffice.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/MyOffice.css:595)
- Refreshed the `My Workspace` hero, action cards, item cards, task cards, and pulse cards in [MyWorkspace.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/MyWorkspace.css:326) and [MyWorkspace.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/MyWorkspace.css:333)
- Refreshed the org composer overlay, header, search shell, action buttons, and meta bar in [OrgGenerateComposer.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/OrgGenerateComposer.css:259) and [OrgGenerateComposer.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/OrgGenerateComposer.css:267)

## Left Out / Deferred
- No org admin page cleanup yet; members/admin settings, roles, pipeline config, and admin-specific org pages remain for later stages
- No org asset library, org calendar, or pipeline board refresh in this pass
- No React restructuring inside the org shell or member pages; Stage 6 stayed CSS-heavy and low-risk
- No workflow logic changes in messaging, scheduling, drafts, task state, or org generation

## What Changed
- The shared org shell now feels more intentional and spatially defined, especially around the top navbar, sidebar, floating menus, and the page content well
- `My Workspace` and `My Office` now feel like they belong to that shell instead of reading as separate dark dashboards with their own independent surface rules
- Common Room now has a clearer hierarchy between its hero, channel rail, active conversation area, settings rail, and supporting pickers/modals
- The org composer now feels more connected to the refreshed shell and to the Stage 5 prompt/discovery work, especially around the overlay depth, header, search field, and action controls
- Focus and hover states now feel more consistently deliberate across the org member routes

## What Stayed The Same
- Org routing and workspace structure are unchanged
- Messaging, channel settings, draft handling, scheduling, task actions, and org generation behavior are unchanged
- Existing class names and page structure remain intact
- Route personality and accent color differences still exist; Stage 6 is about shell consistency, not flattening every org surface into one identical page

## Challenges Encountered
- The org member surfaces already had stronger route personalities than the personal app, so Stage 6 had to tighten the shared chrome without stripping away their room/workspace identity
- The shared shell and the member routes live across multiple stylesheet files, so the safest approach was to add a clear late-file Stage 6 layer instead of trying to collapse every older org rule in one pass
- These org stylesheets are currently untracked in this worktree, so the pass stayed tightly scoped to the member-facing shell and collaboration layer

## What To Notice In Review
- The org shell should feel deeper and more premium now: watch the top navbar, credit/search controls, flyout menus, sidebar links, and page well as one connected environment
- `My Workspace` should feel more clearly like the org home surface, especially around the hero block, action cards, and the right-column supporting cards
- `My Office` should feel closer to the same shell while still reading as a draft-and-pipeline workspace
- Common Room should feel more deliberate end to end, especially the header, channel list, active conversation shell, composer box, and settings side rail
- The org composer should feel more aligned with the refreshed org shell instead of floating as a separate older overlay style
- Hover and focus states across shell controls and org member actions should feel more consistent than before

## Verification Notes
- `npm run build`
- Verified the shared Stage 6 org shell layer in [OrgWorkspace.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/OrgWorkspace.css:883)
- Verified the Stage 6 Common Room refresh in [CommonRoom.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/CommonRoom.css:1082)
- Verified the Stage 6 `My Office` refresh in [MyOffice.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/MyOffice.css:588)
- Verified the Stage 6 `My Workspace` refresh in [MyWorkspace.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/MyWorkspace.css:326)
- Verified the Stage 6 org composer refresh in [OrgGenerateComposer.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/org/styles/OrgGenerateComposer.css:259)
- Manual browser smoke was not run from this terminal environment, so visual review across the org shell, `My Workspace`, `My Office`, `Common Room`, and the org composer is still recommended before approving Stage 7
