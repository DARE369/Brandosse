# video-worker/stages/transcribe.py
# Transcribes audio using Groq's Whisper API.
# Handles files larger than Groq's 25MB limit by splitting into 30-min chunks.

import asyncio
import os
import subprocess
import httpx

from config import config
from errors import TranscriptionError
from logger import log

GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"
CHUNK_DURATION_SECS = 1800  # 30-min chunks — at 64kbps MP3 this is ~14MB, well under 25MB limit


async def run_transcribe(job: dict, audio_path: str) -> dict:
    """
    Transcribe audio using Groq Whisper API with word-level timestamps.
    Automatically chunks audio > 25MB so any video length is supported.

    Returns:
        {
            "full_text": "complete transcript",
            "word_segments": [{"word": "hello", "start": 0.5, "end": 0.8}, ...],
            "language": "en",
            "duration": 123.4
        }
    """
    job_id = job["id"]

    if not os.path.exists(audio_path):
        raise TranscriptionError(f"Audio file not found: {audio_path}", job_id)

    audio_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
    if audio_size_mb < 0.001:
        raise TranscriptionError(
            "Audio file is empty. The source video may have no audio track.", job_id
        )

    if not config.groq_api_key:
        raise TranscriptionError("WORKER_GROQ_API_KEY is not set.", job_id)

    log.info("transcription_start", job_id=job_id, size_mb=round(audio_size_mb, 2))

    temp_dir = os.path.dirname(audio_path)

    try:
        # ── Get audio duration ────────────────────────────────────────────────
        duration = await _get_audio_duration(audio_path)
        log.info("audio_duration", job_id=job_id, duration_secs=round(duration, 1))

        # ── Split into chunks and transcribe ─────────────────────────────────
        num_chunks = max(1, int(duration / CHUNK_DURATION_SECS) + 1)
        log.info("transcription_plan", job_id=job_id, chunks=num_chunks, model=GROQ_MODEL)

        all_words = []
        all_text_parts = []
        detected_language = "en"

        for i in range(num_chunks):
            start_secs = i * CHUNK_DURATION_SECS
            if start_secs >= duration:
                break

            chunk_duration = min(CHUNK_DURATION_SECS, duration - start_secs)
            chunk_path = os.path.join(temp_dir, f"chunk_{i}.mp3")

            # Extract chunk as MP3 (64kbps mono 16kHz — small enough for Groq, good enough for speech)
            await _extract_chunk(audio_path, chunk_path, start_secs, chunk_duration)

            log.info("transcribing_chunk", job_id=job_id, chunk=i + 1, of=num_chunks,
                     start_secs=round(start_secs, 1))

            chunk_result = await _transcribe_chunk(chunk_path, job_id)

            # Offset word timestamps by chunk start time
            for word in chunk_result.get("words", []):
                all_words.append({
                    "word": word["word"].strip(),
                    "start": round(float(word["start"]) + start_secs, 3),
                    "end": round(float(word["end"]) + start_secs, 3),
                })

            if chunk_result.get("text"):
                all_text_parts.append(chunk_result["text"].strip())

            if chunk_result.get("language"):
                detected_language = chunk_result["language"]

            # Clean up chunk file immediately to save disk
            try:
                os.remove(chunk_path)
            except OSError:
                pass

        full_text = " ".join(all_text_parts).strip()
        if not full_text:
            raise TranscriptionError(
                "No speech detected. The video may have no spoken content.", job_id
            )

        # If Groq didn't return word-level timestamps, approximate from segments
        if not all_words and full_text:
            all_words = _approximate_word_timing(full_text, duration)

        result = {
            "full_text": full_text,
            "word_segments": all_words,
            "language": detected_language,
            "duration": duration,
        }

        # Save to DB
        user_id = job.get("user_id", "")
        await asyncio.to_thread(lambda: _save_transcript_db(job_id, user_id, result))

        log.info("transcription_complete", job_id=job_id,
                 total_words=len(all_words), language=detected_language,
                 duration_secs=round(duration, 1))

        # Clean up audio file — only needed for transcription
        try:
            os.remove(audio_path)
            log.info("audio_temp_removed", job_id=job_id)
        except OSError as e:
            log.warning("audio_temp_removal_failed", job_id=job_id, error=str(e))

        return result

    except TranscriptionError:
        raise
    except Exception as e:
        log.error("transcription_failed", job_id=job_id, error=str(e))
        raise TranscriptionError(f"Transcription failed: {str(e)[:200]}", job_id)


async def _get_audio_duration(audio_path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", audio_path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, _ = await proc.communicate()
    return float(stdout.decode().strip())


async def _extract_chunk(audio_path: str, chunk_path: str, start: float, duration: float) -> None:
    """Extract a time slice of audio and encode as 64kbps mono MP3."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", audio_path,
        "-t", str(duration),
        "-ar", "16000",   # 16kHz sample rate (Whisper's native rate)
        "-ac", "1",       # mono
        "-b:a", "64k",    # 64kbps — ~14MB per 30 min, well under Groq's 25MB limit
        chunk_path,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL
    )
    await proc.communicate()
    if proc.returncode != 0:
        raise TranscriptionError(f"ffmpeg chunk extraction failed (exit {proc.returncode})", "")


async def _transcribe_chunk(chunk_path: str, job_id: str) -> dict:
    """Send one audio chunk to Groq Whisper API and return the response."""
    async with httpx.AsyncClient(timeout=300.0) as client:
        with open(chunk_path, "rb") as f:
            response = await client.post(
                GROQ_ENDPOINT,
                headers={"Authorization": f"Bearer {config.groq_api_key}"},
                files={"file": (os.path.basename(chunk_path), f, "audio/mpeg")},
                data={
                    "model": GROQ_MODEL,
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "word",
                },
            )

    if response.status_code != 200:
        raise TranscriptionError(
            f"Groq API error {response.status_code}: {response.text[:300]}", job_id
        )

    return response.json()


def _approximate_word_timing(full_text: str, duration: float) -> list:
    """Fallback: evenly distribute word timestamps across the full duration."""
    words = full_text.split()
    if not words:
        return []
    word_duration = duration / len(words)
    result = []
    for i, word in enumerate(words):
        start = i * word_duration
        result.append({
            "word": word,
            "start": round(start, 3),
            "end": round(start + word_duration, 3),
        })
    return result


def _save_transcript_db(job_id: str, user_id: str, transcript: dict) -> None:
    """Save transcript to database."""
    from database import supabase
    try:
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
