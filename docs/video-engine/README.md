# Video Engine Documentation

This folder tracks the video repurposing engine as it is built stage by stage.

## Current Status

- Stage 1: Database foundation and local app scaffolding are present.
- Stage 2: Python worker skeleton is present.
- Stage 3: Download and audio extraction implementation is present.
- Stage 4: Mock-first transcription contract is present. Real Replicate calls are deferred.
- Stage 5: Mock-first LLM scoring engine is present. Real Anthropic calls are deferred.
- Stage 6: Rendering pipeline is present. Live FFmpeg/Supabase rendering still needs local verification.
- Stage 7: Next.js API layer scaffold is present. The repo still needs a Next runtime before these routes can run.
- Stage 8: Frontend UI is present in the existing Vite app under `/app/video/...` and `/app/billing/credits`.

The worker is a separate Python service in `video-worker/`. The current frontend is Vite-based, so the isolated local preview route is `http://localhost:5173/video-engine`.

## Documentation Map

- `build-checklist.md`: Stage 1 through current-stage status checklist.
- `setup.md`: local setup, worker env, FFmpeg, and Python 3.12 guidance.
- `user-actions.md`: manual steps you need to perform outside the codebase.
- `api-keys-and-mocks.md`: free tools, paid services, and mock-mode policy.
- `decisions.md`: decisions that future stages must preserve.
- `stage-03-download-audio.md`: Stage 3 technical details and test checklist.
- `stage-04-transcription.md`: Stage 4 mock-first transcription details.
- `stage-05-llm-scoring.md`: Stage 5 scoring prompt, clip selector, and mock/real behavior.
- `stage-06-rendering.md`: Stage 6 captions, reframing, FFmpeg render, upload, and resilience behavior.
- `stage-07-nextjs-api.md`: Stage 7 API routes, auth, worker notification, credits, and Stripe behavior.
- `stage-08-frontend-ui.md`: Stage 8 Vite frontend UI routes, realtime, gallery, downloads, and credits behavior.
- `implementation-log.md`: what was implemented, issues found, and manual follow-up.

## Local Preview Route

When the Vite dev server is running, open:

```text
http://localhost:5173/video-engine
```

This route is public, isolated from `/app`, lazy-loaded, and not part of the main navigation.

## App Routes

The current Vite app exposes the product UI inside the protected app shell:

```text
http://localhost:5173/app/video/new
http://localhost:5173/app/video/jobs
http://localhost:5173/app/billing/credits
```

## Documentation Rule After Each Stage

After every implementation stage, update:

- this overview status
- `build-checklist.md`
- the stage-specific technical page
- `implementation-log.md`
- `user-actions.md` when manual work changes
- `api-keys-and-mocks.md` when a service or key changes
