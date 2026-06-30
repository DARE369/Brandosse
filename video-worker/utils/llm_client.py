# video-worker/utils/llm_client.py
# Anthropic API client wrapper for video engine scoring.

import json
import time

from config import config
from errors import AnalysisError
from logger import log


SCORING_MODEL = "claude-sonnet-4-20250514"

MAX_TRANSCRIPT_TOKENS_SINGLE_CALL = 80_000
CHUNK_SIZE_TOKENS = 60_000
CHUNK_OVERLAP_TOKENS = 5_000

MAX_RETRIES = 3
BASE_BACKOFF_SECONDS = 5


def get_anthropic_client(job_id: str):
    """
    Create an authenticated Anthropic client for real scoring mode.
    """
    if not config.anthropic_api_key:
        raise AnalysisError(
            "WORKER_ANTHROPIC_API_KEY is not set. Keep WORKER_USE_MOCK_ANTHROPIC=true "
            "or add an Anthropic key before enabling real scoring.",
            job_id,
        )

    try:
        from anthropic import Anthropic
    except ImportError as exc:
        raise AnalysisError(
            "The anthropic package is not installed. Run pip install -r requirements.txt "
            "inside a Python 3.12 worker venv.",
            job_id,
        ) from exc

    return Anthropic(api_key=config.anthropic_api_key)


def estimate_tokens(text: str) -> int:
    """
    Estimate token count for a string.

    Uses tiktoken when available and falls back to a rough 4 chars/token
    estimate so local mock-mode tests can run before dependencies install.
    """
    if not text:
        return 0

    try:
        import tiktoken

        encoding = tiktoken.get_encoding("cl100k_base")
        base_count = len(encoding.encode(text))
        return int(base_count * 1.1)
    except Exception:
        return max(1, len(text) // 4)


def _mock_claude_response() -> str:
    """Return deterministic JSON for mock Anthropic mode."""
    clips = [
        {
            "clip_index": 0,
            "title": "The Moment Everything Clicked",
            "caption": "This is the kind of insight that changes how you see the whole problem. #creator #strategy #insight",
            "hook_score": 0.88,
            "content_score": 0.84,
            "quotability_score": 0.82,
            "overall_score": 0.85,
            "start_time_secs": 0.0,
            "end_time_secs": 60.0,
            "transcript_excerpt": "Mock scoring is active and this placeholder clip proves the analysis contract is working.",
            "platform_target": "universal",
            "reasoning": "The clip opens with clear context and gives a complete standalone insight.",
        },
        {
            "clip_index": 1,
            "title": "Why Most People Miss This",
            "caption": "A sharp reframe for anyone trying to turn long-form content into stronger short-form moments. #shorts #content #growth",
            "hook_score": 0.82,
            "content_score": 0.80,
            "quotability_score": 0.78,
            "overall_score": 0.80,
            "start_time_secs": 90.0,
            "end_time_secs": 150.0,
            "transcript_excerpt": "The mock analyzer creates realistic scores, timestamps, and platform targets without calling Claude.",
            "platform_target": "shorts",
            "reasoning": "The clip is framed as a practical lesson with broad educational appeal.",
        },
        {
            "clip_index": 2,
            "title": "A Better Way To Choose Clips",
            "caption": "The best clips feel chosen by an editor, not chopped out by a timer. #videoediting #reels #marketing",
            "hook_score": 0.78,
            "content_score": 0.76,
            "quotability_score": 0.74,
            "overall_score": 0.76,
            "start_time_secs": 180.0,
            "end_time_secs": 240.0,
            "transcript_excerpt": "This mock result keeps the scoring pipeline testable while paid LLM calls remain disabled.",
            "platform_target": "reels",
            "reasoning": "The clip has a clear editorial point and a quotable sentence about clip selection.",
        },
    ]
    return json.dumps(clips)


def call_claude(
    system_prompt: str,
    user_message: str,
    job_id: str,
    max_tokens: int = 4000,
) -> str:
    """
    Make a Claude API call with retry logic, or return mock JSON in mock mode.
    """
    if config.use_mock_anthropic:
        log.info(
            "claude_mock_response",
            job_id=job_id,
            model=SCORING_MODEL,
            input_tokens=estimate_tokens(system_prompt + user_message),
        )
        return _mock_claude_response()

    try:
        from anthropic import APIConnectionError, APIError, RateLimitError
    except ImportError as exc:
        raise AnalysisError(
            "The anthropic package is not installed. Run pip install -r requirements.txt "
            "inside a Python 3.12 worker venv.",
            job_id,
        ) from exc

    client = get_anthropic_client(job_id)
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            log.info(
                "claude_api_call",
                job_id=job_id,
                attempt=attempt + 1,
                model=SCORING_MODEL,
            )

            response = client.messages.create(
                model=SCORING_MODEL,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )

            content = response.content[0].text

            log.info(
                "claude_api_success",
                job_id=job_id,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                stop_reason=response.stop_reason,
            )

            return content

        except RateLimitError as exc:
            backoff = BASE_BACKOFF_SECONDS * (2 ** attempt)
            log.warning(
                "claude_rate_limited",
                job_id=job_id,
                attempt=attempt + 1,
                backoff_seconds=backoff,
            )
            last_error = exc
            time.sleep(backoff)

        except APIConnectionError as exc:
            backoff = BASE_BACKOFF_SECONDS * (2 ** attempt)
            log.warning(
                "claude_connection_error",
                job_id=job_id,
                attempt=attempt + 1,
                backoff_seconds=backoff,
                error=str(exc),
            )
            last_error = exc
            time.sleep(backoff)

        except APIError as exc:
            status_code = getattr(exc, "status_code", "unknown")
            log.error("claude_api_error", job_id=job_id, status_code=status_code, error=str(exc))
            raise AnalysisError(
                f"Anthropic API error (HTTP {status_code}): {str(exc)[:200]}",
                job_id,
            ) from exc

    raise AnalysisError(
        f"Anthropic API failed after {MAX_RETRIES} attempts: {str(last_error)[:200]}",
        job_id,
    )


def chunk_transcript(formatted_transcript: str) -> list[str]:
    """
    Split a long transcript into overlapping chunks at newline boundaries.
    """
    total_tokens = estimate_tokens(formatted_transcript)
    if total_tokens <= MAX_TRANSCRIPT_TOKENS_SINGLE_CALL:
        return [formatted_transcript]

    lines = formatted_transcript.split("\n")
    chunks = []
    current_chunk_lines = []
    current_tokens = 0
    overlap_lines = []

    for line in lines:
        line_tokens = estimate_tokens(line)

        if current_tokens + line_tokens > CHUNK_SIZE_TOKENS and current_chunk_lines:
            chunks.append("\n".join(current_chunk_lines))
            current_chunk_lines = overlap_lines.copy()
            current_tokens = estimate_tokens("\n".join(current_chunk_lines))

        current_chunk_lines.append(line)
        current_tokens += line_tokens

        overlap_lines.append(line)
        while overlap_lines and estimate_tokens("\n".join(overlap_lines)) > CHUNK_OVERLAP_TOKENS:
            overlap_lines.pop(0)

    if current_chunk_lines:
        chunks.append("\n".join(current_chunk_lines))

    log.info("transcript_chunked", total_tokens=total_tokens, chunk_count=len(chunks))
    return chunks
