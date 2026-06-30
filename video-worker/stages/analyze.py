# video-worker/stages/analyze.py
# Real Claude-based clip scoring with professional rubric.

import asyncio
import json
import os
import re

from config import config
from database import supabase, delete_clips_for_job
from errors import AnalysisError
from logger import log
from anthropic import AsyncAnthropic

MIN_CLIP_SECONDS = 15
MAX_CLIP_SECONDS = 240


def _get_job_field(job, field, fallback=None):
    """Safe field reader that handles dict, object, and None job values."""
    if job is None:
        return fallback
    if isinstance(job, dict):
        return job.get(field, fallback)
    return getattr(job, field, fallback)


SYSTEM_PROMPT = """You are an expert short-form video editor with deep experience creating viral content \
for TikTok, Instagram Reels, and YouTube Shorts. You have edited thousands of long-form \
videos into high-performing clips.

Your job is to read a timed transcript and identify every genuinely compelling moment that \
would make strong standalone short-form vertical content. You score each clip on four dimensions:

HOOK SCORE (0–100):
How strongly do the first 3 seconds grab attention?
- 80–100: Opens with a bold claim, surprising fact, relatable problem, or emotional hook
- 50–79:  Opens on something interesting but not immediately arresting
- 0–49:   Opens with a greeting, preamble, or slow build-up

FLOW SCORE (0–100):
Does the clip tell a complete story with a clear beginning, middle, and end?
- 80–100: Clear setup → development → satisfying conclusion or punchline
- 50–79:  Mostly complete but slightly abrupt start or end
- 0–49:   Cuts in the middle of a thought or ends without resolution

VALUE SCORE (0–100):
How useful, educational, entertaining, or emotionally resonant is this content?
- 80–100: Actionable insight, surprising revelation, funny moment, or emotional story
- 50–79:  Moderately interesting, some useful information
- 0–49:   Generic, filler, or content the viewer would skip

TREND SCORE (0–100):
How well does this match content that currently performs on short-form video platforms?
- 80–100: Universal relatability, hot topic, surprising twist, or satisfying demonstration
- 50–79:  Moderate appeal, niche but engaged audience
- 0–49:   Very niche, heavily jargon-dependent, or format that does not work in short form

OVERALL SCORE = (hook × 0.35) + (flow × 0.25) + (value × 0.25) + (trend × 0.15)
Round overall_score to the nearest integer.

You must return ONLY a valid JSON object. No preamble, no explanation, no markdown \
code fences. Start your response with { and end with }."""


def build_analyze_prompt(title: str, full_text: str, word_segments: list, total_duration: float, job=None) -> str:
    """
    Build a timed transcript that Claude can reference.

    Shows text broken into ~10-second chunks with timestamps,
    so Claude can identify exact clip boundaries.
    """
    # ── Read user preferences and build dynamic instructions ─────────────────
    clip_count_target = _get_job_field(job, 'clip_count_target')
    min_duration_secs = _get_job_field(job, 'min_duration_secs')
    max_duration_secs = _get_job_field(job, 'max_duration_secs')
    specific_moments  = _get_job_field(job, 'specific_moments')

    if clip_count_target and isinstance(clip_count_target, int) and clip_count_target > 0:
        clip_count_instruction = (
            f"Identify exactly {clip_count_target} clip"
            f"{'s' if clip_count_target != 1 else ''} from this video. "
            f"If the video does not contain {clip_count_target} genuinely strong moments, "
            f"return the best ones available rather than padding with weak content."
        )
    else:
        clip_count_instruction = (
            "Identify every genuinely compelling moment this video contains, "
            "up to 15 clips maximum. "
            "Quality determines quantity — if only 2 moments are truly strong "
            "as standalone short-form content, return 2. "
            "If 11 moments are excellent, return 11. "
            "Do not pad the list with weak clips to reach a minimum."
        )

    has_min = min_duration_secs and isinstance(min_duration_secs, int) and min_duration_secs > 0
    has_max = max_duration_secs and isinstance(max_duration_secs, int) and max_duration_secs > 0

    if has_min and has_max:
        duration_instruction = (
            f"Each clip must be between {min_duration_secs} and {max_duration_secs} seconds long. "
            f"Start each clip at the beginning of a complete thought. "
            f"End each clip at its natural conclusion within the time limit."
        )
    elif has_min and not has_max:
        duration_instruction = (
            f"Each clip must be at least {min_duration_secs} seconds long. "
            f"End each clip at its natural conclusion — no hard maximum."
        )
    elif has_max and not has_min:
        duration_instruction = (
            f"Each clip must be no longer than {max_duration_secs} seconds. "
            f"Start each clip at the beginning of a complete thought. "
            f"A 15-second minimum applies: do not return clips shorter than 15 seconds."
        )
    else:
        duration_instruction = (
            "Each clip must be as long as the natural thought or story arc requires. "
            "A punchy point might be 20 seconds. A complete how-to explanation might "
            "be 2 minutes. Start at the beginning of a complete thought and end at "
            "its natural conclusion. Minimum 15 seconds. Maximum 4 minutes."
        )

    if specific_moments and str(specific_moments).strip():
        specific_instruction = (
            f"\nADDITIONAL INSTRUCTION FROM USER: {str(specific_moments).strip()}\n"
            "Prioritise moments that match this instruction above the general scoring criteria."
        )
    else:
        specific_instruction = ""

    # Group words by time (every ~10 seconds)
    timed_lines = []
    current_line = []
    line_start = 0

    for w in word_segments:
        current_line.append(w["word"])

        # Break line every 10 seconds or at end
        if w["end"] - line_start >= 10 or w == word_segments[-1]:
            timestamp_secs = int(w['start'])
            timed_lines.append(f"[{timestamp_secs}s] {' '.join(current_line)}")
            current_line = []
            line_start = w["end"]

    timed_transcript = "\n".join(timed_lines)

    prompt = f"""Analyze this video and identify every genuinely compelling moment for short-form social media.

VIDEO: {title}
TOTAL DURATION: {int(total_duration)} seconds

TIMED TRANSCRIPT (timestamp = seconds from video start):
{timed_transcript}

INSTRUCTIONS:
1. {clip_count_instruction}
2. {duration_instruction}{specific_instruction}
3. Each clip MUST start and end on a complete sentence or natural pause.
   Do not cut a clip in the middle of a word or thought.
4. Avoid starting clips in the first 20 seconds of the video unless the hook is
   exceptionally strong — most videos have introductions that do not clip well.
5. No two clips may overlap in time.
6. The "title" field must be a compelling hook that makes someone want to watch —
   not a generic label like "Main Point" or "Clip 2". Write what the viewer gains.
7. The "caption" field must be a platform-ready social media caption: 1–2 sentences,
   conversational tone, may include 1–2 relevant emojis, ends with a question or CTA.
8. The "why_this_works" field must be one sentence explaining the specific reason
   this moment was selected (reference something concrete from the content).

Return this exact JSON structure (no markdown fences):
{{
  "clips": [
    {{
      "start_secs": 47.2,
      "end_secs": 112.8,
      "title": "The mistake I made for 3 years that cost me everything",
      "caption": "I wish someone had told me this earlier 😤 What would you have done differently?",
      "hook_score": 88,
      "flow_score": 76,
      "value_score": 91,
      "trend_score": 72,
      "why_this_works": "Opens mid-confession which creates instant intrigue, then delivers a clear lesson with a before/after structure."
    }}
  ]
}}"""

    return prompt


def snap_to_word_boundary(target_time: float, word_segments: list, snap_type: str = "start") -> float:
    """
    Snap a time to the nearest word boundary to avoid cutting mid-word.

    snap_type: "start" finds closest word start, "end" finds closest word end
    """
    if not word_segments:
        return target_time

    if snap_type == "end":
        return min(word_segments, key=lambda w: abs(w["end"] - target_time))["end"]
    else:
        return min(word_segments, key=lambda w: abs(w["start"] - target_time))["start"]


async def run_analyze(job: dict, transcript: dict) -> list[dict]:
    """
    Analyze transcript and identify viral clip candidates.

    Returns list of clips with complete metadata.
    """
    job_id = job["id"]
    source_title = job.get("source_title") or "Untitled Video"

    log.info("analysis_start", job_id=job_id, source_title=source_title[:60])

    # Delete any clip rows left over from a previous attempt on this job
    # (crash recovery resets status → queued without cleaning up old clips,
    # which would cause clip_count_mismatch and rendering the wrong rows).
    delete_clips_for_job(job_id)

    # Extract data from transcript
    full_text = transcript.get("full_text", "")
    word_segments = transcript.get("word_segments", [])
    total_duration = transcript.get("duration", 0)

    if not word_segments or not full_text:
        raise AnalysisError("Empty transcript data", job_id)

    # Build prompt
    prompt = build_analyze_prompt(
        source_title,
        full_text,
        word_segments,
        total_duration,
        job=job,
    )

    # Call Claude with retry logic
    clips_analysis = None
    client = AsyncAnthropic(api_key=os.environ.get("WORKER_ANTHROPIC_API_KEY"))

    for attempt in range(3):
        try:
            log.info("claude_api_call", job_id=job_id, attempt=attempt + 1)

            message = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}]
            )

            # Parse response
            response_text = message.content[0].text.strip()

            # Remove markdown code fences if present
            response_text = re.sub(r'^```json\s*|\s*```$', '', response_text, flags=re.MULTILINE)
            response_text = re.sub(r'^```\s*|\s*```$', '', response_text, flags=re.MULTILINE)

            # Find JSON in response
            start_idx = response_text.find("{")
            end_idx = response_text.rfind("}") + 1
            if start_idx != -1 and end_idx > start_idx:
                response_text = response_text[start_idx:end_idx]

            clips_data = json.loads(response_text)

            if isinstance(clips_data, dict) and "clips" in clips_data:
                clips_list = clips_data["clips"]
            elif isinstance(clips_data, list):
                clips_list = clips_data
            else:
                clips_list = []

            log.info("claude_response_parsed", job_id=job_id, clip_count=len(clips_list))
            clips_analysis = clips_list
            break

        except json.JSONDecodeError as e:
            log.warning("claude_json_parse_failed", job_id=job_id, attempt=attempt + 1, error=str(e)[:100])
            if attempt == 2:
                raise AnalysisError(
                    f"Claude returned invalid JSON after 3 attempts",
                    job_id
                )
            await asyncio.sleep(1)

        except Exception as e:
            log.warning("claude_api_error", job_id=job_id, attempt=attempt + 1, error=str(e)[:100])
            if attempt == 2:
                raise AnalysisError(
                    f"Claude API failed after 3 attempts: {str(e)[:100]}",
                    job_id
                )
            await asyncio.sleep(1)

    if not clips_analysis:
        raise AnalysisError("No clips returned from Claude", job_id)

    # Validate and create clip records
    created_clips = []

    for i, clip in enumerate(clips_analysis):
        try:
            # Ensure scores are in valid range (0-100)
            hook_score = max(0, min(100, int(round(clip.get("hook_score", 50)))))
            flow_score = max(0, min(100, int(round(clip.get("flow_score", 50)))))
            value_score = max(0, min(100, int(round(clip.get("value_score", 50)))))
            trend_score = max(0, min(100, int(round(clip.get("trend_score", 50)))))

            # Recalculate overall_score using specified weights
            overall_score = int(round(
                hook_score * 0.35 +
                flow_score * 0.25 +
                value_score * 0.25 +
                trend_score * 0.15
            ))

            # Enforce duration limits
            start_secs = float(clip.get("start_secs", 0))
            end_secs = float(clip.get("end_secs", start_secs + 60))
            duration = end_secs - start_secs

            if duration < MIN_CLIP_SECONDS:
                log.warning(
                    "clip_too_short_skipped",
                    job_id=job_id,
                    start=clip.get("start_secs"),
                    end=clip.get("end_secs"),
                    duration=round(duration, 1),
                )
                continue
            elif duration > MAX_CLIP_SECONDS:
                end_secs = start_secs + MAX_CLIP_SECONDS
                log.warning("clip_truncated_to_max", job_id=job_id, duration_before=round(duration, 1))

            # Clamp to video bounds
            start_secs = max(0, min(start_secs, total_duration))
            end_secs = max(start_secs + 10, min(end_secs, total_duration))

            # Snap to word boundaries
            start_secs = snap_to_word_boundary(start_secs, word_segments, "start")
            end_secs = snap_to_word_boundary(end_secs, word_segments, "end")

            # Create clip record (scores are 0-100, not 0-1)
            clip_record = {
                "job_id": job_id,
                "user_id": job["user_id"],
                "clip_index": i,
                "start_time_secs": start_secs,
                "end_time_secs": end_secs,
                "duration_secs": end_secs - start_secs,
                "ai_title": clip.get("title", f"Clip {i+1}")[:100],
                "ai_caption": clip.get("caption", "")[:500],
                "hook_score": hook_score,
                "flow_score": flow_score,
                "content_score": value_score,
                "trend_score": trend_score,
                "overall_score": overall_score,
                "why_this_works": clip.get("why_this_works", "")[:500],
                "render_status": "pending",
            }

            # Insert into database
            await asyncio.to_thread(
                lambda: insert_clip_to_db(clip_record)
            )

            created_clips.append(clip_record)

            log.info(
                "clip_created",
                job_id=job_id,
                clip_index=i,
                start=start_secs,
                end=end_secs,
                score=overall_score,
                title=clip.get("title", "")[:60]
            )

        except Exception as e:
            log.warning("clip_record_creation_failed", job_id=job_id, clip_index=i, error=str(e))
            continue

    if not created_clips:
        raise AnalysisError("No valid clips could be created from Claude response", job_id)

    log.info(
        "analysis_complete",
        job_id=job_id,
        clips_created=len(created_clips),
        top_score=max(c["overall_score"] for c in created_clips)
    )

    return created_clips


def insert_clip_to_db(clip_record: dict) -> None:
    """
    Insert clip record into database.
    """
    try:
        supabase.table("video_clips").insert(clip_record).execute()
        log.info("clip_inserted_to_db", job_id=clip_record["job_id"], clip_index=clip_record["clip_index"])

    except Exception as e:
        log.warning("clip_db_insert_failed", job_id=clip_record["job_id"], error=str(e))
        raise
