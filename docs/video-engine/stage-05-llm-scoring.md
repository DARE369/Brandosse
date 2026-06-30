# Stage 5 - Mock-First LLM Scoring Engine

Last updated: 2026-05-09 13:38 +01:00

Stage 5 adds the scoring brain for the video engine. It identifies candidate short-form clips, scores them, validates constraints, deduplicates overlaps, and returns rows compatible with `save_clips()`.

## What Was Implemented

- Added `anthropic==0.34.2` and `tiktoken==0.7.0` to worker requirements.
- Added `utils/llm_client.py` for Anthropic calls, retry logic, token estimation, and chunking.
- Added `utils/clip_selector.py` for JSON parsing, validation, filtering, overlap dedupe, and re-indexing.
- Replaced `stages/analyze.py` with the Stage 5 scoring implementation.
- Kept paid Claude calls disabled by default through `WORKER_USE_MOCK_ANTHROPIC=true`.

## Default Mock Behavior

When `WORKER_USE_MOCK_ANTHROPIC=true`, the analyzer:

1. Formats the parsed transcript for LLM consumption.
2. Estimates transcript tokens and chooses single-call or chunked strategy.
3. Uses deterministic Claude-style JSON from the mock Anthropic path.
4. Parses, validates, filters, deduplicates, and sorts clips.
5. Returns database-compatible clip dictionaries.

Mock mode does not:

- call Anthropic
- require `WORKER_ANTHROPIC_API_KEY`
- spend money

## Real Anthropic Mode

Real mode is deferred until final MVP/proof-of-concept validation.

To enable later:

```env
WORKER_USE_MOCK_ANTHROPIC=false
WORKER_ANTHROPIC_API_KEY=your_key_here
```

Real mode will:

- call Claude with retry on rate limits and connection errors
- estimate transcript tokens with `tiktoken`
- chunk transcripts above 80,000 estimated tokens
- retry once when the model returns malformed JSON
- raise `AnalysisError` if output is still unparseable

## Clip Contract

The LLM-facing contract includes:

- `clip_index`
- `title`
- `caption`
- `hook_score`
- `content_score`
- `quotability_score`
- `overall_score`
- `start_time_secs`
- `end_time_secs`
- `transcript_excerpt`
- `platform_target`
- `reasoning`

The database save path currently persists the fields supported by `video_clips`. `quotability_score` and `reasoning` are returned for logs/future UI but do not have dedicated database columns yet.

## Validation Rules

- Clips under 30 seconds are discarded.
- Clips over 100 seconds are discarded.
- Clips below 0.70 overall score are filtered unless every clip is below threshold.
- If every valid clip is below threshold, the single highest-scoring clip is kept.
- Clips overlapping more than 50% of the shorter clip are deduplicated.
- Maximum final clips per job: 8.

## Known Limits

- Real Anthropic scoring is scaffolded but not live-tested.
- The current `video_clips` table does not store `quotability_score` or `reasoning`.
- Prompt quality still needs real-video evaluation before paid mode is enabled.
- Python 3.12 and FFmpeg local setup are still required before end-to-end worker testing.

## Lightweight Tests

Syntax check:

```powershell
cd video-worker
python -m py_compile stages\analyze.py utils\llm_client.py utils\clip_selector.py
```

Selector smoke test:

```powershell
cd video-worker
python -c "from utils.clip_selector import parse_llm_json_output; clips, err = parse_llm_json_output('[{\"clip_index\":0,\"title\":\"Test\",\"caption\":\"Test #tag\",\"hook_score\":0.9,\"content_score\":0.8,\"quotability_score\":0.8,\"overall_score\":0.84,\"start_time_secs\":0,\"end_time_secs\":60,\"transcript_excerpt\":\"Test\",\"platform_target\":\"universal\",\"reasoning\":\"Strong hook\"}]', 'test'); print(len(clips), err)"
```
