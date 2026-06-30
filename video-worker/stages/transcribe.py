# video-worker/stages/transcribe.py
# Transcribes audio using faster-whisper (local, offline, no API costs).

import asyncio
import json
import os

from config import config
from database import update_job_progress
from errors import TranscriptionError
from logger import log

# Load model once at module level (expensive operation)
_model = None


def get_model():
    """Lazy-load faster-whisper model (shared across jobs)."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        log.info("loading_whisper_model", model_size="small")
        # "small" is 3-4x faster than "medium" on CPU with negligible accuracy loss
        # for word-level caption timestamps. cpu_threads=4 parallelises matrix ops
        # within a single transcription; num_workers stays at 1 (default) so only
        # one model instance is loaded in RAM at a time.
        _model = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=4)

    return _model


async def run_transcribe(job: dict, audio_path: str) -> dict:
    """
    Transcribe audio using faster-whisper with word-level timestamps.

    Returns:
        {
            "full_text": "complete transcript",
            "word_segments": [
                {"word": "hello", "start": 0.5, "end": 0.8},
                ...
            ],
            "language": "en",
            "duration": 123.4
        }
    """
    job_id = job["id"]

    log.info("transcription_start", job_id=job_id, audio_path=audio_path)

    # Validate audio file
    if not os.path.exists(audio_path):
        raise TranscriptionError(f"Audio file not found: {audio_path}", job_id)

    audio_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
    if audio_size_mb < 0.001:
        raise TranscriptionError(
            "Audio file is empty. The source video may have no audio track.",
            job_id
        )

    log.info("audio_file_validated", job_id=job_id, size_mb=round(audio_size_mb, 2))

    # Run transcription in thread pool (faster-whisper is CPU-bound)
    try:
        model = get_model()

        segments, info = await asyncio.to_thread(
            model.transcribe,
            audio_path,
            beam_size=1,            # Greedy decoding — 2-3x faster, near-identical word accuracy
            word_timestamps=True,   # ← CRITICAL: per-word timing for captions
            language=None,          # Auto-detect language
            vad_filter=True,        # Filter out non-speech
            vad_parameters=dict(min_silence_duration_ms=500)
        )

        # Collect word segments and full text
        word_segments = []
        full_text_parts = []

        for segment in segments:
            full_text_parts.append(segment.text)

            if hasattr(segment, 'words') and segment.words:
                # Per-word timing available
                for word in segment.words:
                    word_segments.append({
                        "word": word.word.strip(),
                        "start": round(float(word.start), 3),
                        "end": round(float(word.end), 3),
                    })
            else:
                # Fallback: approximate word timing if not available
                words = segment.text.split()
                segment_duration = segment.end - segment.start
                words_per_second = len(words) / max(segment_duration, 0.1)

                current_time = segment.start
                for word in words:
                    word_duration = 1.0 / words_per_second
                    word_segments.append({
                        "word": word,
                        "start": round(current_time, 3),
                        "end": round(current_time + word_duration, 3),
                    })
                    current_time += word_duration

        full_text = " ".join(full_text_parts).strip()

        if not full_text:
            raise TranscriptionError(
                "No speech detected in audio. The video may have no spoken content.",
                job_id
            )

        result = {
            "full_text": full_text,
            "word_segments": word_segments,
            "language": info.language or "en",
            "duration": info.duration,
        }

        # Save to database
        user_id = job.get("user_id", "")
        await asyncio.to_thread(
            lambda: update_transcript_db(job_id, user_id, result)
        )

        log.info(
            "transcription_complete",
            job_id=job_id,
            total_words=len(word_segments),
            language=result["language"],
            duration_secs=round(result["duration"], 1)
        )

        # ── Clean up audio file after transcription ──────────────────────────────
        # Pack 5: The WAV file is only needed for transcription. Delete it now to
        # reclaim disk space. The source video is still needed by the render stage.
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
                log.info("audio_temp_removed", job_id=job_id)
            except OSError as e:
                log.warning("audio_temp_removal_failed", job_id=job_id, error=str(e))

        return result

    except Exception as e:
        if isinstance(e, TranscriptionError):
            raise

        log.error("transcription_failed", job_id=job_id, error=str(e))
        raise TranscriptionError(
            f"Transcription failed: {str(e)[:200]}",
            job_id
        )


def update_transcript_db(job_id: str, user_id: str, transcript: dict) -> None:
    """Save transcript to database."""
    from database import supabase

    try:
        # word_segments passed as list (not json.dumps) so it's stored as JSONB
        # array rather than a JSONB string — reads back as list, not string.
        # on_conflict=job_id: upsert uses the UNIQUE constraint on job_id so
        # re-runs overwrite the previous transcript rather than erroring.
        supabase.table("video_transcripts").upsert({
            "job_id": job_id,
            "user_id": user_id,
            "full_text": transcript["full_text"],
            "word_segments": transcript["word_segments"],
            "language": transcript["language"],
            "duration": transcript["duration"],
        }, on_conflict="job_id").execute()

        log.info("transcript_saved_to_db", job_id=job_id)

    except Exception as e:
        log.warning("transcript_db_save_failed", job_id=job_id, error=str(e))
        # Don't fail the job if DB save fails — transcription is done
