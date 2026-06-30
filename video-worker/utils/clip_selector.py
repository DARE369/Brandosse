# video-worker/utils/clip_selector.py
# Post-LLM clip validation, filtering, and deduplication.

import json
import re
from typing import Optional

from logger import log


MIN_CLIP_DURATION_SECS = 30.0
MAX_CLIP_DURATION_SECS = 100.0
MIN_OVERALL_SCORE = 0.70
MAX_CLIPS_PER_JOB = 8
OVERLAP_THRESHOLD = 0.50
MAX_BOUNDARY_ADJUSTMENT_SECS = 2.0

REQUIRED_CLIP_FIELDS = {
    "clip_index",
    "title",
    "caption",
    "hook_score",
    "content_score",
    "quotability_score",
    "overall_score",
    "start_time_secs",
    "end_time_secs",
    "transcript_excerpt",
    "platform_target",
    "reasoning",
}

VALID_PLATFORM_TARGETS = {"tiktok", "reels", "shorts", "universal"}


def parse_llm_json_output(raw_output: str, job_id: str) -> tuple[Optional[list], str]:
    """
    Parse the LLM's raw text output as a JSON array.
    """
    text = raw_output.strip()

    if text.startswith("```"):
        lines = text.split("\n")
        inner_lines = []
        for line in lines[1:]:
            if line.strip() == "```":
                break
            inner_lines.append(line)
        text = "\n".join(inner_lines).strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return [parsed], ""
        if isinstance(parsed, list):
            return parsed, ""
        return None, f"JSON parsed but is not an array or object, got: {type(parsed)}"
    except json.JSONDecodeError:
        pass

    array_match = re.search(r"\[[\s\S]*\]", text)
    if array_match:
        try:
            parsed = json.loads(array_match.group())
            if isinstance(parsed, list):
                return parsed, ""
            return None, "Extracted JSON was not an array"
        except json.JSONDecodeError as exc:
            return None, f"Found array-like pattern but could not parse: {str(exc)}"

    return None, f"No valid JSON array found in output. First 200 chars: {text[:200]}"


def validate_clip(clip: dict, clip_num: int) -> tuple[bool, str]:
    """
    Validate one clip dict against schema and hard constraints.
    """
    missing = REQUIRED_CLIP_FIELDS - set(clip.keys())
    if missing:
        return False, f"Clip {clip_num} missing fields: {sorted(missing)}"

    for score_field in ["hook_score", "content_score", "quotability_score", "overall_score"]:
        try:
            value = float(clip[score_field])
        except (TypeError, ValueError):
            return False, f"Clip {clip_num}: {score_field} is not a valid float"
        if not 0.0 <= value <= 1.0:
            return False, f"Clip {clip_num}: {score_field} must be between 0.0 and 1.0"

    try:
        start = float(clip["start_time_secs"])
        end = float(clip["end_time_secs"])
    except (TypeError, ValueError):
        return False, f"Clip {clip_num}: start_time_secs and end_time_secs must be floats"

    if start < 0:
        return False, f"Clip {clip_num}: start_time_secs cannot be negative"
    if end <= start:
        return False, f"Clip {clip_num}: end_time_secs must be greater than start_time_secs"

    duration = end - start
    if duration < MIN_CLIP_DURATION_SECS:
        return False, f"Clip {clip_num}: duration {duration:.1f}s is below minimum"
    if duration > MAX_CLIP_DURATION_SECS:
        return False, f"Clip {clip_num}: duration {duration:.1f}s exceeds maximum"

    if clip["platform_target"] not in VALID_PLATFORM_TARGETS:
        return False, f"Clip {clip_num}: invalid platform_target '{clip['platform_target']}'"

    if not str(clip["title"]).strip():
        return False, f"Clip {clip_num}: title cannot be empty"
    if not str(clip["caption"]).strip():
        return False, f"Clip {clip_num}: caption cannot be empty"

    return True, ""


def _calculate_overlap_ratio(clip_a: dict, clip_b: dict) -> float:
    """
    Calculate overlap as a fraction of the shorter clip duration.
    """
    start_a = float(clip_a["start_time_secs"])
    end_a = float(clip_a["end_time_secs"])
    start_b = float(clip_b["start_time_secs"])
    end_b = float(clip_b["end_time_secs"])

    overlap_start = max(start_a, start_b)
    overlap_end = min(end_a, end_b)

    if overlap_end <= overlap_start:
        return 0.0

    overlap_duration = overlap_end - overlap_start
    shorter_duration = min(end_a - start_a, end_b - start_b)
    if shorter_duration <= 0:
        return 0.0
    return overlap_duration / shorter_duration


def deduplicate_clips(clips: list[dict]) -> list[dict]:
    """
    Remove clips that overlap more than the threshold, keeping higher scores.
    """
    if not clips:
        return clips

    sorted_clips = sorted(clips, key=lambda clip: float(clip["overall_score"]), reverse=True)
    kept = []

    for candidate in sorted_clips:
        duplicate = False
        for kept_clip in kept:
            if _calculate_overlap_ratio(candidate, kept_clip) > OVERLAP_THRESHOLD:
                duplicate = True
                break
        if not duplicate:
            kept.append(candidate)

    return kept


def align_clip_to_word_boundaries(clip: dict, word_segments: Optional[list]) -> dict:
    """
    Adjust start/end to nearby word boundaries when a close boundary exists.
    """
    if not word_segments:
        return clip

    adjusted = clip.copy()
    try:
        start = float(clip["start_time_secs"])
        end = float(clip["end_time_secs"])
    except (TypeError, ValueError):
        return adjusted

    words_with_start = [
        word for word in word_segments
        if isinstance(word, dict) and word.get("start") is not None
    ]
    words_with_end = [
        word for word in word_segments
        if isinstance(word, dict) and word.get("end") is not None
    ]

    if words_with_start:
        nearest_start = min(words_with_start, key=lambda word: abs(float(word["start"]) - start))
        nearest_value = float(nearest_start["start"])
        if abs(nearest_value - start) <= MAX_BOUNDARY_ADJUSTMENT_SECS:
            adjusted["start_time_secs"] = nearest_value

    if words_with_end:
        nearest_end = min(words_with_end, key=lambda word: abs(float(word["end"]) - end))
        nearest_value = float(nearest_end["end"])
        if abs(nearest_value - end) <= MAX_BOUNDARY_ADJUSTMENT_SECS:
            adjusted["end_time_secs"] = nearest_value

    return adjusted


def _normalize_clip(clip: dict) -> dict:
    """Convert numeric fields and trim string fields after validation."""
    normalized = clip.copy()
    for field in ["hook_score", "content_score", "quotability_score", "overall_score"]:
        normalized[field] = float(normalized[field])
    normalized["start_time_secs"] = float(normalized["start_time_secs"])
    normalized["end_time_secs"] = float(normalized["end_time_secs"])
    normalized["title"] = str(normalized["title"]).strip()
    normalized["caption"] = str(normalized["caption"]).strip()
    normalized["transcript_excerpt"] = str(normalized["transcript_excerpt"]).strip()[:120]
    normalized["reasoning"] = str(normalized["reasoning"]).strip()
    return normalized


def process_llm_clips(
    raw_clips: list[dict],
    job_id: str,
    video_duration_secs: Optional[float] = None,
    word_segments: Optional[list] = None,
) -> list[dict]:
    """
    Validate, filter, deduplicate, sort, cap, and re-index LLM clips.
    """
    valid_clips = []
    invalid_count = 0

    for index, raw_clip in enumerate(raw_clips):
        clip = align_clip_to_word_boundaries(raw_clip, word_segments)

        if video_duration_secs is not None:
            try:
                clip["end_time_secs"] = min(float(clip["end_time_secs"]), video_duration_secs)
            except (TypeError, ValueError):
                pass

        is_valid, error = validate_clip(clip, index)
        if not is_valid:
            log.warning("clip_validation_failed", job_id=job_id, clip_index=index, reason=error)
            invalid_count += 1
            continue

        valid_clips.append(_normalize_clip(clip))

    log.info(
        "clip_validation_complete",
        job_id=job_id,
        total_input=len(raw_clips),
        valid=len(valid_clips),
        invalid=invalid_count,
    )

    if not valid_clips:
        raise ValueError(f"No clips passed validation out of {len(raw_clips)} returned by LLM")

    above_threshold = [
        clip for clip in valid_clips
        if float(clip["overall_score"]) >= MIN_OVERALL_SCORE
    ]

    if not above_threshold:
        best_clip = sorted(valid_clips, key=lambda clip: float(clip["overall_score"]), reverse=True)[0]
        log.warning(
            "all_clips_below_threshold",
            job_id=job_id,
            best_score=float(best_clip["overall_score"]),
            threshold=MIN_OVERALL_SCORE,
        )
        above_threshold = [best_clip]

    deduplicated = deduplicate_clips(above_threshold)
    removed_as_duplicates = len(above_threshold) - len(deduplicated)
    if removed_as_duplicates > 0:
        log.info(
            "clips_deduplicated",
            job_id=job_id,
            removed=removed_as_duplicates,
            remaining=len(deduplicated),
        )

    final_clips = sorted(deduplicated, key=lambda clip: float(clip["overall_score"]), reverse=True)
    final_clips = final_clips[:MAX_CLIPS_PER_JOB]

    for index, clip in enumerate(final_clips):
        clip["clip_index"] = index

    log.info(
        "clip_selection_final",
        job_id=job_id,
        final_clip_count=len(final_clips),
        top_score=float(final_clips[0]["overall_score"]) if final_clips else 0,
    )

    return final_clips
