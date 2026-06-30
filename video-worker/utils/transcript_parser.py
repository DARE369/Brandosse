# video-worker/utils/transcript_parser.py
# Parses raw WhisperX output into the standard transcript contract used by Stage 5.

import re
from typing import Optional

from logger import log


HALLUCINATION_PATTERNS = [
    re.compile(r'(thank you\.?\s*){4,}', re.IGNORECASE),
    re.compile(r'(thanks for watching\.?\s*){3,}', re.IGNORECASE),
    re.compile(r'(subtitles by\s+\w+\s*){2,}', re.IGNORECASE),
    re.compile(r'(www\.\w+\.com\s*){3,}', re.IGNORECASE),
    re.compile(r'(\.\s*){10,}'),
]


def _detect_hallucinations(text: str) -> tuple[bool, Optional[str]]:
    """Detect known Whisper repeated-text hallucination patterns."""
    for pattern in HALLUCINATION_PATTERNS:
        if pattern.search(text):
            return True, f"Repeated phrase pattern detected: {pattern.pattern[:50]}"
    return False, None


def _check_segment_repetition(segments: list) -> tuple[bool, Optional[str]]:
    """Detect five or more identical transcript segments in a row."""
    if len(segments) < 5:
        return False, None

    texts = [segment.get("text", "").strip().lower() for segment in segments]
    max_consecutive = 1
    current_count = 1
    repeated_text = None

    for index in range(1, len(texts)):
        if texts[index] == texts[index - 1] and texts[index]:
            current_count += 1
            if current_count > max_consecutive:
                max_consecutive = current_count
                repeated_text = texts[index]
        else:
            current_count = 1

    if max_consecutive >= 5:
        return True, f"Segment repeated {max_consecutive} times: '{repeated_text[:50]}'"

    return False, None


def _remove_hallucinated_segments(segments: list) -> tuple[list, bool, Optional[str]]:
    """
    Remove repeated hallucinated segments while keeping the first occurrence.
    """
    if not segments:
        return segments, False, None

    cleaned = []
    index = 0
    removed_count = 0

    while index < len(segments):
        current_text = segments[index].get("text", "").strip().lower()
        next_index = index + 1

        while (
            next_index < len(segments)
            and segments[next_index].get("text", "").strip().lower() == current_text
        ):
            next_index += 1

        consecutive_count = next_index - index

        if consecutive_count >= 3 and current_text:
            cleaned.append(segments[index])
            removed_count += consecutive_count - 1
            index = next_index
        else:
            cleaned.append(segments[index])
            index += 1

    if removed_count > 0:
        return cleaned, True, f"Removed {removed_count} repeated hallucinated segments"

    return cleaned, False, None


def _float_or_default(value: object, default: float) -> float:
    """Convert a value to float while tolerating missing WhisperX fields."""
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_whisperx_output(raw_output: dict, job_id: str) -> dict:
    """
    Parse raw WhisperX output into the standard transcript shape.

    The returned dict always includes:
    full_text, segments, word_segments, speakers, detected_language,
    total_words, hallucination_warning, and hallucination_details.
    """
    if not raw_output:
        raise ValueError("WhisperX returned empty output")

    detected_language = raw_output.get("detected_language", "unknown")
    log.info("transcript_language_detected", job_id=job_id, language=detected_language)

    raw_segments = raw_output.get("segments", [])
    if not raw_segments:
        raise ValueError("WhisperX returned no segments. Audio may be silent or empty.")

    repetition_found, repetition_description = _check_segment_repetition(raw_segments)
    if repetition_found:
        log.warning("hallucination_detected", job_id=job_id, description=repetition_description)
        raw_segments, _, clean_description = _remove_hallucinated_segments(raw_segments)
        hallucination_warning = True
        hallucination_details = clean_description or repetition_description
    else:
        hallucination_warning = False
        hallucination_details = None

    parsed_segments = []
    all_word_segments = []
    speakers_seen = set()

    for segment in raw_segments:
        speaker = segment.get("speaker", None)
        if speaker:
            speakers_seen.add(speaker)

        segment_start = _float_or_default(segment.get("start"), 0.0)
        segment_end = _float_or_default(segment.get("end"), segment_start)
        segment_words = []

        for word in segment.get("words", []):
            word_entry = {
                "word": word.get("word", "").strip(),
                "start": _float_or_default(word.get("start"), segment_start),
                "end": _float_or_default(word.get("end"), segment_end),
                "score": _float_or_default(word.get("score"), 0.0),
            }
            segment_words.append(word_entry)
            all_word_segments.append({**word_entry, "speaker": speaker})

        parsed_segments.append(
            {
                "id": segment.get("id", len(parsed_segments)),
                "start": segment_start,
                "end": segment_end,
                "text": segment.get("text", "").strip(),
                "speaker": speaker,
                "words": segment_words,
            }
        )

    if not all_word_segments and "word_segments" in raw_output:
        for word in raw_output["word_segments"]:
            speaker = word.get("speaker", None)
            if speaker:
                speakers_seen.add(speaker)
            all_word_segments.append(
                {
                    "word": word.get("word", "").strip(),
                    "start": _float_or_default(word.get("start"), 0.0),
                    "end": _float_or_default(word.get("end"), 0.0),
                    "score": _float_or_default(word.get("score"), 0.0),
                    "speaker": speaker,
                }
            )

    if not all_word_segments:
        raise ValueError(
            "WhisperX output is missing word-level timestamps. "
            "Word-level data is required for precise video cutting."
        )

    full_text = " ".join(
        segment["text"] for segment in parsed_segments if segment["text"]
    ).strip()

    text_hallucination, text_description = _detect_hallucinations(full_text)
    if text_hallucination and not hallucination_warning:
        hallucination_warning = True
        hallucination_details = text_description
        log.warning("text_hallucination_detected", job_id=job_id, description=text_description)

    result = {
        "full_text": full_text,
        "segments": parsed_segments,
        "word_segments": all_word_segments,
        "speakers": sorted(list(speakers_seen)),
        "detected_language": detected_language,
        "total_words": len(all_word_segments),
        "hallucination_warning": hallucination_warning,
        "hallucination_details": hallucination_details,
    }

    log.info(
        "transcript_parsed",
        job_id=job_id,
        total_segments=len(parsed_segments),
        total_words=len(all_word_segments),
        speakers_detected=len(speakers_seen),
        hallucination_warning=hallucination_warning,
        language=detected_language,
    )

    return result


def get_transcript_for_llm(parsed_transcript: dict) -> str:
    """
    Format the parsed transcript into timestamped text for Stage 5.
    """
    has_speakers = len(parsed_transcript.get("speakers", [])) > 1
    lines = []

    for segment in parsed_transcript.get("segments", []):
        text = segment["text"].strip()
        if not text:
            continue

        start_secs = segment["start"]
        end_secs = segment["end"]
        start_str = f"{int(start_secs // 60):02d}:{int(start_secs % 60):02d}"
        end_str = f"{int(end_secs // 60):02d}:{int(end_secs % 60):02d}"

        if has_speakers and segment.get("speaker"):
            line = f"[{start_str} - {end_str}] {segment['speaker']}: {text}"
        else:
            line = f"[{start_str} - {end_str}] {text}"

        lines.append(line)

    return "\n".join(lines)
