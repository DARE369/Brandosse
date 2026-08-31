# video-worker/fonts.py
#
# Resolve a brand's font family to a real font file the renderer can use.
#
# ── Why this exists ──────────────────────────────────────────────────────────
# The brand kit stores `font_display.family` / `font_body.family` — a NAME, like
# "Poppins". FFmpeg cannot use a name: drawtext needs `fontfile=<path>` and the
# ass filter needs a directory to search. Until 2026-08-31 the render chain had
# no `fontfile=` parameter at all, so brand typography could not reach video
# even in principle. Colour was branded; letterforms were not.
#
# Google Fonts' Developer API returns direct **TTF** URLs per variant, which is
# exactly the format FFmpeg wants (the CSS endpoint serves woff2, which it
# cannot read). One API key, then download and cache.
#
# ── Failure posture ──────────────────────────────────────────────────────────
# Every function here returns None rather than raising. A font is an
# enhancement: if the key is missing, the network is down, or the family is not
# on Google Fonts, the clip must still render in the default face. What must
# NOT happen is a job failing — the user has already paid for it — or the
# pipeline silently claiming brand typography it did not apply, so every
# fallback is logged.

import json
import os
import re
import threading
import time
from typing import Optional

import httpx

from config import config
from logger import log

WEBFONTS_API = "https://www.googleapis.com/webfonts/v1/webfonts"

# Outbound timeouts are a CLAUDE.md non-negotiable. These sit well under the
# stuck-job reaper threshold so a slow font server delays a render rather than
# stranding a job.
METADATA_TIMEOUT_S = 15.0
DOWNLOAD_TIMEOUT_S = 20.0

# The catalogue is ~1,900 families and changes rarely. Re-fetching it per job
# would add a network round trip to every render for data that is effectively
# static.
CATALOGUE_TTL_S = 7 * 24 * 60 * 60

_catalogue_lock = threading.Lock()
_catalogue_cache: Optional[dict] = None


def _font_dir() -> str:
    """Directory holding downloaded TTFs. Also passed to FFmpeg as fontsdir."""
    path = os.path.join(config.temp_dir, "fonts")
    os.makedirs(path, exist_ok=True)
    return path


def _catalogue_path() -> str:
    return os.path.join(_font_dir(), "_catalogue.json")


def _safe_name(family: str) -> str:
    """Filesystem-safe filename stem for a family + variant."""
    return re.sub(r"[^A-Za-z0-9]+", "-", str(family or "")).strip("-").lower()


def _load_catalogue() -> Optional[dict]:
    """
    Family name (lowercased) -> {variant: ttf_url}.

    Cached on disk so a worker restart does not re-fetch, and in memory so
    concurrent clip renders in one process do not each hit the disk.
    """
    global _catalogue_cache

    with _catalogue_lock:
        if _catalogue_cache is not None:
            return _catalogue_cache

        cache_file = _catalogue_path()
        if os.path.exists(cache_file):
            age = time.time() - os.path.getmtime(cache_file)
            if age < CATALOGUE_TTL_S:
                try:
                    with open(cache_file, "r", encoding="utf-8") as f:
                        _catalogue_cache = json.load(f)
                    return _catalogue_cache
                except Exception as e:
                    log.warning("font_catalogue_cache_unreadable", error=str(e)[:120])

        api_key = getattr(config, "google_fonts_api_key", "")
        if not api_key:
            # Not an error. Brand typography is simply unavailable, and saying
            # so once is better than failing quietly on every job.
            log.info(
                "font_catalogue_skipped",
                reason="WORKER_GOOGLE_FONTS_API_KEY is not set — clips will render "
                       "in the default face and brand fonts will be ignored",
            )
            return None

        try:
            resp = httpx.get(
                WEBFONTS_API,
                params={"key": api_key, "sort": "popularity"},
                timeout=METADATA_TIMEOUT_S,
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
        except Exception as e:
            log.warning("font_catalogue_fetch_failed", error=str(e)[:200])
            return None

        catalogue = {}
        for item in items:
            family = item.get("family")
            files = item.get("files")
            if family and isinstance(files, dict):
                catalogue[family.strip().lower()] = files

        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(catalogue, f)
        except Exception as e:
            log.warning("font_catalogue_cache_write_failed", error=str(e)[:120])

        log.info("font_catalogue_loaded", families=len(catalogue))
        _catalogue_cache = catalogue
        return catalogue


def _pick_variant(files: dict, prefer_bold: bool) -> Optional[str]:
    """
    Choose a variant URL from the family's `files` map.

    Hook cards and captions are set bold — that is what makes them readable
    over moving footage — so a display font prefers 700 and falls back through
    the neighbouring weights before settling for regular.
    """
    if not isinstance(files, dict) or not files:
        return None
    order = (
        ["700", "800", "600", "900", "regular", "500", "400"]
        if prefer_bold
        else ["regular", "400", "500", "300", "700"]
    )
    for key in order:
        url = files.get(key)
        if url:
            return url
    # Any non-italic variant beats nothing; italics would change the design.
    for key, url in files.items():
        if "italic" not in str(key).lower():
            return url
    return None


def resolve_font_file(family: str, prefer_bold: bool = True) -> Optional[str]:
    """
    Local path to a TTF for `family`, downloading and caching on first use.

    Returns None when the family is unknown, the key is unset, or the download
    fails — the caller keeps its default font in every one of those cases.
    """
    if not family or not str(family).strip():
        return None

    key = str(family).strip().lower()
    catalogue = _load_catalogue()
    if not catalogue:
        return None

    files = catalogue.get(key)
    if not files:
        log.info("font_not_in_google_fonts", family=family)
        return None

    url = _pick_variant(files, prefer_bold)
    if not url:
        log.info("font_no_usable_variant", family=family)
        return None

    weight = "bold" if prefer_bold else "regular"
    dest = os.path.join(_font_dir(), f"{_safe_name(family)}-{weight}.ttf")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest

    # Google serves these over http in the API payload; force https.
    if url.startswith("http://"):
        url = "https://" + url[len("http://"):]

    try:
        with httpx.stream("GET", url, timeout=DOWNLOAD_TIMEOUT_S, follow_redirects=True) as r:
            r.raise_for_status()
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        # Rename only after a complete write, so an interrupted download cannot
        # leave a truncated file that every later job then treats as cached.
        os.replace(tmp, dest)
        log.info("font_downloaded", family=family, weight=weight, path=dest)
        return dest
    except Exception as e:
        log.warning("font_download_failed", family=family, error=str(e)[:200])
        try:
            if os.path.exists(dest + ".part"):
                os.remove(dest + ".part")
        except Exception:
            pass
        return None


def brand_font_family(kit: Optional[dict], role: str = "display") -> Optional[str]:
    """
    Read `font_display.family` / `font_body.family` from the kit.

    Defensive because the live schema has drifted from the migrations: the
    column may be absent, null, a plain string, or the expected object.
    """
    if not kit:
        return None
    value = kit.get(f"font_{role}")
    if isinstance(value, dict):
        family = value.get("family")
    elif isinstance(value, str):
        family = value
    else:
        return None
    family = str(family or "").strip()
    return family or None


def resolve_brand_font(kit: Optional[dict], role: str = "display") -> tuple[Optional[str], Optional[str]]:
    """
    Convenience for the render path.

    Returns (family_name, local_ttf_path). The family name is returned even
    when the file could not be resolved, so the caller can log precisely what
    was asked for and not applied — an unbranded render that says why is very
    different from one that silently ignores the kit.
    """
    family = brand_font_family(kit, role)
    if not family:
        return None, None
    return family, resolve_font_file(family, prefer_bold=(role == "display"))


def fonts_dir_if_populated() -> Optional[str]:
    """
    The fontsdir to hand FFmpeg's ass filter, or None if nothing is cached.

    Passing an empty directory is harmless but pointless; returning None keeps
    the filter string clean and makes "no brand font" visible in the command.
    """
    path = _font_dir()
    try:
        if any(name.endswith(".ttf") for name in os.listdir(path)):
            return path
    except Exception:
        pass
    return None
