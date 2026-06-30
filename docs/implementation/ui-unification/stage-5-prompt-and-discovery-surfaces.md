# Stage 5 - Prompt And Discovery Surfaces

## Objective
- Unify the personal app's prompt-entry and discovery layer so the generate dock, empty-state suggestion chips, edit-image workflow, and dashboard KPI cards feel like one designed system
- Move lingering prompt/discovery tone styling out of inline JSX and into reusable CSS variants where possible
- Keep the existing generate and dashboard behavior intact while making the most visible creation surfaces feel more deliberate

## Implemented
- Added a Stage 5 token-backed refresh layer in [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:1687) so the prompt bar shell, mode button, dropdowns, textarea, status chips, edit-image modal, prompt suggestion cards, and KPI cards now share one darker glass-card language instead of reading like separate mini-systems
- Refined the prompt bar shell, attachment preview, enhance menu, action buttons, and status strip in [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:1702), [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:1902), and [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:2063)
- Refreshed the edit-image modal shell, panels, suggestion chips, result actions, and mobile layout handling in [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:2100) and [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:2176)
- Reworked the dormant prompt-suggestion card system and dashboard KPI cards into tone-driven CSS variants in [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:2208) and [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:2341)
- Upgraded the mounted generate empty-state suggestion chips in [GenerateV2.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GenerateV2.css:3123) so the discovery prompts visible on `/app/generate` feel closer to the refreshed prompt bar
- Replaced inline tone styling with data-driven variants in [PromptSuggestions.jsx](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/components/Generate/PromptSuggestions.jsx:4) and [RealtimeKPICards.jsx](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/components/Dashboard/RealtimeKPICards.jsx:65), and removed the hidden file input inline style in [GenerationPromptBar.jsx](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/components/Generate/GenerationPromptBar.jsx:438)

## Left Out / Deferred
- No generate workflow logic changes in session handling, prompt enhancement, or edit-image apply behavior
- No swap from the current mounted `suggestion-chip` empty state to the separate `PromptSuggestions` component; Stage 5 stayed with the existing generate-page flow and polished both the live and dormant discovery surfaces
- No post-production, calendar, org, admin, or public/auth styling work in this pass
- No large-scale cleanup of every earlier duplicate rule in `GeneratePromptBar.css`; this pass adds the new canonical Stage 5 layer without rewriting unrelated selectors in the same file

## What Changed
- The prompt dock now reads more like a premium creation console: the bar, mode switcher, textarea, attachment strip, settings menu, and send action all share stronger depth, border, and accent treatment
- The prompt enhancement menu now feels like part of the same system instead of a utility popup floating beside it
- The edit-image modal now feels more aligned with the generate dock, especially around panel separation, dropzone treatment, suggestion chips, and result actions
- The visible generate empty-state discovery chips now feel more deliberate and tactile, with card-like hover and focus treatment rather than plain pills
- Dashboard KPI cards now sit closer to the generate surface language through darker tinted cards, accent-led icon treatment, and reusable tone variants
- Prompt/discovery tones now come from CSS-driven variants rather than inline background/color objects in JSX

## What Stayed The Same
- Prompt submission, prompt enhancement, edit-image application, and generation mode behavior are unchanged
- The generate page still uses the current empty-state suggestion chip flow
- Existing class names and overall React structure remain intact
- KPI card values, refresh behavior, and data sources are unchanged

## Challenges Encountered
- The prompt/discovery layer spans both the generate route and the dashboard, so Stage 5 had to make those surfaces feel related without flattening their route-specific roles
- `GeneratePromptBar.css` already carried older and newer rule layers, so the safest Stage 5 move was to establish a clear late-file canonical layer instead of risking a broad rewrite in one pass
- Several of the involved files are currently untracked in this worktree, so the pass stayed tightly scoped and avoided adjacent cleanup that was not needed for the prompt/discovery refresh

## What To Notice In Review
- The generate prompt dock should feel more intentional now: watch the shell depth, divider, mode button, textarea framing, attachment treatment, and right-side actions as one composition
- The prompt enhancement menu should feel like it belongs to the dock, especially its header, option cards, and dismiss control
- The visible suggestion chips on the empty generate state should feel richer and easier to click without becoming visually noisy
- The edit-image modal should feel closer to the same creation family as the prompt dock, especially around the dropzone, instruction chips, and accept/download actions
- Dashboard KPI cards should feel more premium and more connected to the rest of the personal app instead of standing apart as flat tinted boxes
- There should be fewer ad-hoc inline style pockets in the prompt/discovery React files now; the card tones and hidden file input behavior should resolve from CSS or native attributes instead

## Verification Notes
- `npm run build`
- Verified the Stage 5 prompt surface layer in [GeneratePromptBar.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GeneratePromptBar.css:1687)
- Verified the mounted generate discovery-chip refresh in [GenerateV2.css](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/styles/GenerateV2.css:3123)
- Verified the prompt/discovery tone cleanup in [PromptSuggestions.jsx](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/components/Generate/PromptSuggestions.jsx:4), [RealtimeKPICards.jsx](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/components/Dashboard/RealtimeKPICards.jsx:65), and [GenerationPromptBar.jsx](/c:/Users/Dare/Desktop/social-media-agent%20-%20Copy/src/components/Generate/GenerationPromptBar.jsx:438)
- Manual browser smoke was not run from this terminal environment, so visual review across `/app/generate`, the edit-image modal, and the dashboard KPI row is still recommended before approving Stage 6
