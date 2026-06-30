# video-worker/utils/url_validator.py
# Validates submitted URLs and detects their source platform.
# Called by the download stage before any download attempt.

import re
from typing import Optional

YOUTUBE_PATTERNS = [
    re.compile(r'^https?://(www\.)?youtube\.com/watch\?.*v=[\w-]{11}'),
    re.compile(r'^https?://youtu\.be/[\w-]{11}'),
    re.compile(r'^https?://(www\.)?youtube\.com/shorts/[\w-]{11}'),
    re.compile(r'^https?://(www\.)?youtube\.com/live/[\w-]{11}'),
]

TWITTER_PATTERNS = [
    re.compile(r'^https?://(www\.)?twitter\.com/\w+/status/\d+'),
    re.compile(r'^https?://(www\.)?x\.com/\w+/status/\d+'),
]


def detect_platform(url: str) -> Optional[str]:
    """
    Detect the platform from a URL string.
    Returns 'youtube', 'twitter', or None if unrecognized.
    Does not validate that the video actually exists.
    """
    if not url or not isinstance(url, str):
        return None

    url = url.strip()

    for pattern in YOUTUBE_PATTERNS:
        if pattern.match(url):
            return 'youtube'

    for pattern in TWITTER_PATTERNS:
        if pattern.match(url):
            return 'twitter'

    return None


def validate_url_for_platform(url: str, claimed_platform: str) -> tuple[bool, str]:
    """
    Validate that a URL matches the claimed platform.

    Returns:
        (True, "") if valid
        (False, "error message") if invalid
    """
    if claimed_platform == 'upload':
        if not url or len(url) < 10:
            return False, "Invalid upload path"
        return True, ""

    detected = detect_platform(url)

    if detected is None:
        return False, "URL does not match any supported platform. Supported: YouTube, Twitter/X"

    if detected != claimed_platform:
        return False, f"URL appears to be from {detected} but platform is set to {claimed_platform}"

    return True, ""
