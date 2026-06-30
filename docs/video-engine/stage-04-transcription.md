# Stage 4 - Mock-First Transcription

Last updated: 2026-05-09 13:23 +01:00

Stage 4 introduces the transcript contract that later WhisperX transcription will produce, while keeping Replicate mocked by default to avoid paid API calls.

## What Was Implemented

- Added `replicate==0.34.1` to `video-worker/requirements.txt`.
- Added MP3 compression helper `compress_audio_for_upload()` in `utils/ffmpeg_utils.py`.
- Added `utils/transcript_parser.py` to parse and validate WhisperX-style output.
- Replaced the transcription stub with mock-first logic in `stages/transcribe.py`.
- Kept real Replicate transcription behind explicit opt-in configuration.

## Default Mock Behavior

When `WORKER_USE_MOCK_REPLICATE=true`, the worker:

1. Validates that `audio.wav` exists and is not empty.
2. Builds a realistic WhisperX-like transcript payload.
3. Parses it through the shared transcript parser.
4. Returns the same structure that real mode will return.

Mock mode does not:

- call Replicate
- require a Replicate token
- upload audio
- spend money

## Returned Contract

`run_transcription()` returns:

```python
{
    "raw_transcript": dict,
    "word_segments": list,
    "speaker_segments": list,
    "detected_language": str,
    "full_text": str,
    "parsed": dict,
}
```

The `parsed` dict includes:

- `full_text`
- `segments`
- `word_segments`
- `speakers`
- `detected_language`
- `total_words`
- `hallucination_warning`
- `hallucination_details`

## Real Replicate Mode

Real mode is deferred until final MVP/proof-of-concept validation.

To enable later:

1. Set `WORKER_USE_MOCK_REPLICATE=false`.
2. Add `WORKER_REPLICATE_API_TOKEN`.
3. Replace `PASTE_YOUR_VERSION_HASH_HERE` in `WHISPERX_MODEL_VERSION`.
4. Run a very short job first.

Real mode will:

- compress WAV to 64kbps mono MP3
- upload audio to Replicate Files API
- submit an async prediction
- poll for completion up to 15 minutes
- delete the uploaded Replicate file after completion
- parse and validate output before saving

## Known Limits

- Real Replicate behavior is scaffolded but not live-tested.
- The Replicate API can change, so verify current Replicate docs before disabling mock mode.
- Local install is still blocked until Python 3.12 is installed and the venv is recreated.
- FFmpeg must be installed before the worker can start.

## Lightweight Tests

Syntax check:

```powershell
cd video-worker
python -m py_compile stages\transcribe.py utils\transcript_parser.py utils\ffmpeg_utils.py
```

Parser check:

```powershell
cd video-worker
python -c "from utils.transcript_parser import parse_whisperx_output; data={'detected_language':'en','segments':[{'id':0,'start':0,'end':1,'text':'Hello world','speaker':'SPEAKER_00','words':[{'word':'Hello','start':0,'end':0.4,'score':0.99},{'word':'world','start':0.5,'end':1,'score':0.99}]}]}; print(parse_whisperx_output(data, 'test')['total_words'])"
```

Expected output:

```text
2
```
