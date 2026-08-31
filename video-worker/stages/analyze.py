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
from typing import Optional

from brand_kit import _phrases, load_brand_kit, neutral_title, screen_text

MIN_CLIP_SECONDS = 15
# The prompt ASKS for 90 seconds; this ENFORCES it. Measured 2026-08-23: asked
# for a 90s maximum, Claude returned clips of 92s and 111s — a prompt is a
# request, not a constraint, and the longest clips cost the most to render for
# the content least likely to be watched through.
MAX_CLIP_SECONDS = 90


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

    # Auto mode used to allow 15 clips. A 20-minute source produced NINE, each
    # up to 2 minutes — 11.4 minutes of output video to encode on one shared
    # vCPU, which took over an hour and kept being interrupted. Nobody posts
    # nine clips from one video anyway; the tail is filler by definition.
    # Scale to the source and cap hard: ~1 clip per 4 minutes, at most 6.
    _src_minutes = (total_duration or 0) / 60.0
    auto_clip_cap = max(2, min(6, int(_src_minutes // 4) or 2))

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
            f"up to {auto_clip_cap} clips maximum. "
            "Quality determines quantity — if only 2 moments are truly strong "
            "as standalone short-form content, return 2. Prefer FEWER, stronger "
            "clips over more, weaker ones. "
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
            "its natural conclusion. Minimum 15 seconds. Maximum 90 seconds — "
            "retention on short-form collapses past about 90s, and a 2-minute "
            "clip costs proportionally more to render for content nobody "
            "finishes watching."
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


async def _semantic_violations(
    titles: list[str], restrictions: list[str], client, job_id: str
) -> dict:
    """
    Ask the model which titles break the brand's prose restrictions.

    Returns {index: reason}. Batched into ONE call for the whole job rather
    than one per title — the restrictions are identical across clips, so
    per-title calls would pay N times for the same context.

    Only runs when the brand actually wrote prose restrictions, so the common
    case costs nothing. Never raises: a failed screen degrades to "no semantic
    violations found" and logs, because the deterministic phrase screen has
    already run and a job the user paid for must not die here.
    """
    if not titles or not restrictions:
        return {}

    numbered = "\n".join(f"{i}: {t}" for i, t in enumerate(titles) if t)
    if not numbered.strip():
        return {}

    rules = "\n".join(f"- {r}" for r in restrictions)
    try:
        message = await client.messages.create(
            model="claude-sonnet-4-6",
            # short-output: a compliance verdict, not content — a handful of
            # {index, reason} pairs. Truncation is detected below.
            max_tokens=1000,
            system=(
                "You check short video hook titles against a brand's content "
                "restrictions. Return ONLY JSON: "
                '{"violations": [{"index": <int>, "reason": "<short>"}]}. '
                "Report a title only when it clearly breaks a stated rule. "
                "Do not flag a title for being dull, vague or lowercase — you "
                "are checking compliance, not quality, and a false positive "
                "silently discards a good title."
            ),
            messages=[{
                "role": "user",
                "content": f"Restrictions:\n{rules}\n\nTitles:\n{numbered}",
            }],
        )
        if message.stop_reason == "max_tokens":
            log.warning("title_semantic_screen_truncated", job_id=job_id)
            return {}

        raw = message.content[0].text.strip()
        start, end = raw.find("{"), raw.rfind("}") + 1
        if start == -1 or end <= start:
            return {}
        parsed = json.loads(raw[start:end])

        out = {}
        for entry in parsed.get("violations", []):
            try:
                out[int(entry["index"])] = str(entry.get("reason", "restricted content"))[:120]
            except (KeyError, TypeError, ValueError):
                continue
        return out
    except Exception as e:
        log.warning("title_semantic_screen_failed", job_id=job_id, error=str(e)[:160])
        return {}


async def _regenerate_title(original: str, problem: str, client, job_id: str) -> Optional[str]:
    """One replacement attempt for a title that broke a brand rule."""
    try:
        message = await client.messages.create(
            model="claude-sonnet-4-6",
            # short-output: one 5-10 word title. Truncation is detected below.
            max_tokens=200,
            system=(
                "Rewrite a short video hook title so it no longer breaks a "
                "brand rule, keeping the same subject and energy. 5-10 words. "
                "Return ONLY the new title, with no quotes or explanation."
            ),
            messages=[{
                "role": "user",
                "content": f'Title: "{original}"\nRule it breaks: {problem}',
            }],
        )
        if message.stop_reason == "max_tokens":
            return None
        text = message.content[0].text.strip().strip('"').strip()
        return text or None
    except Exception as e:
        log.warning("title_regeneration_failed", job_id=job_id, error=str(e)[:160])
        return None


async def _enforce_title_policy(clips: list, kit, client, job_id: str) -> None:
    """
    Bring every hook title into compliance, in place.

    Escalation, cheapest first:
      1. Deterministic phrase screen — free.
      2. Semantic screen against prose restrictions — one batched call, and
         only when the brand wrote any.
      3. One regeneration per offending title, told what it broke.
      4. Re-screen the replacement. Still bad -> a neutral placeholder.

    Two attempts is the limit by design: at that point the model has twice
    produced something the brand forbids, and a third guess is likelier to
    violate again than to land. Every substitution is logged — a title the
    brand never approved must not appear silently.
    """
    if not clips:
        return

    restrictions = _phrases(kit, "content_restrictions") if kit else []
    titles = [str(c.get("title") or "") for c in clips]

    problems: dict = {}
    for i, title in enumerate(titles):
        hits = screen_text(title, kit)
        if hits:
            problems[i] = f"uses the forbidden phrase(s): {', '.join(hits)}"

    for idx, reason in (await _semantic_violations(titles, restrictions, client, job_id)).items():
        if 0 <= idx < len(clips):
            problems.setdefault(idx, reason)

    if not problems:
        return

    log.warning(
        "hook_titles_violate_brand_rules",
        job_id=job_id,
        count=len(problems),
        total=len(clips),
    )

    for idx, reason in problems.items():
        original = titles[idx]
        replacement = await _regenerate_title(original, reason, client, job_id)

        if replacement and not screen_text(replacement, kit):
            clips[idx]["title"] = replacement
            log.info("hook_title_regenerated", job_id=job_id, clip_index=idx)
            continue

        clips[idx]["title"] = neutral_title(idx)
        log.warning(
            "hook_title_replaced_with_placeholder",
            job_id=job_id,
            clip_index=idx,
            reason=reason,
            message="Two attempts broke the brand's rules; using a neutral title.",
        )


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
    # user_id lets it remove the FILES too, not just the rows — a reprocessed
    # job used to orphan its previous clips in storage forever (L7.4).
    delete_clips_for_job(job_id, job.get("user_id") if isinstance(job, dict) else None)

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

    # Call Claude with retry logic.
    #
    # LOCK L1.4 — the key now comes from `config`, not a raw os.environ read.
    # Previously this bypassed WorkerConfig entirely, which meant the startup
    # credential validation could not protect this stage: a worker with no
    # Anthropic key booted cleanly and failed here at job runtime instead.
    # Routing through config makes the startup guarantee real.
    #
    # This stage deliberately has NO mock branch. Clip scoring is the product's
    # core intelligence; a silent fallback to fabricated scores is never an
    # acceptable degradation. (The old mock path lived in utils/llm_client.py,
    # which returned hardcoded scores and fixed timestamps. That module was dead
    # code and was DELETED under LOCK L3.2 on 2026-08-22, along with
    # clip_selector.py, transcript_parser.py and video_reframer.py — ~1,015
    # lines that no longer had a caller.) If the real API is unavailable the job
    # must fail loudly, which it does below.
    clips_analysis = None

    if not config.anthropic_api_key:
        raise AnalysisError(
            "WORKER_ANTHROPIC_API_KEY is not configured — clip analysis cannot run. "
            "This stage never falls back to simulated scores.",
            job_id,
        )

    client = AsyncAnthropic(api_key=config.anthropic_api_key)

    for attempt in range(3):
        try:
            log.info("claude_api_call", job_id=job_id, attempt=attempt + 1)

            message = await client.messages.create(
                model="claude-sonnet-4-6",
                # LOCK L5.3a — was 4096, which silently truncated the clip list on
                # long sources. A 60-minute podcast asked for ~10 clips, each with a
                # title, caption and four scores; the response ran past 4096 tokens
                # and the tail was cut. Nothing detected it: the parser below takes
                # rfind("}") and either raised (→ 3 retries → job failed with a
                # misleading "invalid JSON") or, worse, parsed a short list and the
                # job "succeeded" having lost real moments.
                #
                # 16000 is the SDK's documented non-streaming default and is ample
                # for the largest clip list this prompt can request. Above ~64000
                # the SDK requires streaming to avoid HTTP timeouts, which this call
                # does not use — so this value must not be raised much further
                # without switching to client.messages.stream().
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}]
            )

            # Truncation must never be parsed. `stop_reason == "max_tokens"` means
            # the model was cut off mid-JSON; whatever survives is an incomplete
            # clip list, and accepting it is exactly the silent data loss this lock
            # exists to close. Fail loudly instead — law 3.
            if message.stop_reason == "max_tokens":
                raise AnalysisError(
                    "Clip analysis was truncated by the output token limit "
                    f"(max_tokens=16000, stop_reason=max_tokens). The clip list is "
                    "incomplete and will not be used. This means the source produced "
                    "more analysis than the current limit allows — raise max_tokens "
                    "and switch this call to streaming.",
                    job_id,
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

        except AnalysisError:
            # Truncation (L5.3a) and any other deliberate analysis failure must
            # propagate immediately. Retrying cannot help — the same prompt at the
            # same max_tokens truncates identically — and the generic handler below
            # would rewrite the cause as "Claude API failed", hiding it.
            raise

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

    # ── Brand policy on hook titles ──────────────────────────────────────────
    # Titles are written by the model above and burned into H.264 downstream,
    # where they cannot be corrected without a paid re-render. Enforce the
    # brand's rules here, while regeneration is still cheap and the client is
    # already open.
    await _enforce_title_policy(
        clips_analysis,
        load_brand_kit(job.get("user_id") if isinstance(job, dict) else None),
        client,
        job_id,
    )

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
