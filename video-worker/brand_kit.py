# video-worker/brand_kit.py
#
# Brand data for the render pipeline.
#
# ── Why this file exists ─────────────────────────────────────────────────────
# Until 2026-08-31 the worker held no brand data at all. Grepping `brand` across
# every Python file returned two hits, both a CORS regex. That had two live
# consequences:
#
#   1. An LLM wrote the hook title (stages/analyze.py) and it was burned into
#      H.264 (stages/render.py) without `forbidden_phrases` ever being consulted.
#      A forbidden phrase in a caption is editable; a forbidden phrase in pixels
#      needs a full re-render, which the user pays for.
#   2. Caption colours came from hardcoded viral-TikTok palettes in
#      utils/caption_generator.py, identical for every customer, regardless of
#      what they had put in `color_palette`.
#
# This module is the missing connection. It does not add fields — every value it
# reads was already being collected and stored.
#
# ── Trust model ──────────────────────────────────────────────────────────────
# The worker holds the service-role key, so this read bypasses RLS by design.
# It is always scoped by the `user_id` on the claimed job — never by anything
# supplied from outside the worker.

import re
from typing import Any, Optional

from database import get_supabase_client
from logger import log


def load_brand_kit(user_id: str) -> Optional[dict]:
    """
    Load a user's brand kit, or None if they have none.

    Never raises: brand conditioning is an enhancement to rendering, and a
    missing or unreadable kit must degrade to "no brand data" rather than fail
    a job the user has already paid for. It logs loudly instead, so the absence
    is visible rather than silent.
    """
    if not user_id:
        return None
    try:
        supabase = get_supabase_client()
        result = (
            supabase.table("brand_kit")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            log.info("brand_kit_absent", user_id=user_id)
            return None
        log.info("brand_kit_loaded", user_id=user_id)
        return rows[0]
    except Exception as e:
        log.warning("brand_kit_load_failed", user_id=user_id, error=str(e)[:200])
        return None


def _phrases(kit: Optional[dict], field: str) -> list[str]:
    """Read a text[] column defensively — the live schema has drifted from the
    migrations (see CLAUDE.md), so a column may be absent, null, or not a list."""
    if not kit:
        return []
    value = kit.get(field)
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def screen_text(text: str, kit: Optional[dict]) -> list[str]:
    """
    Return the forbidden phrases that appear in `text`. Empty list means clean.

    Matching is case-insensitive and word-boundary aware, so "ace" does not
    match "space" — a substring check would produce false positives that
    suppress legitimate titles, and a suppressed title is itself a quality
    regression.

    Only `forbidden_phrases` is screened here. `content_restrictions` holds
    prose rules ("no alcohol references") that a literal match cannot evaluate;
    enforcing those needs a semantic check and is deliberately NOT faked here —
    claiming to enforce a rule this function cannot evaluate would be worse
    than not claiming it.
    """
    if not text:
        return []
    forbidden = _phrases(kit, "forbidden_phrases")
    if not forbidden:
        return []

    hits = []
    for phrase in forbidden:
        pattern = r"\b" + re.escape(phrase) + r"\b"
        if re.search(pattern, text, flags=re.IGNORECASE):
            hits.append(phrase)
    return hits


def screen_hook_title(title: str, kit: Optional[dict], job_id: str = "") -> tuple[Optional[str], list[str]]:
    """
    Decide whether a hook title may be burned into the frame.

    Returns (title_to_use, violations).

    On a violation the title is DROPPED (None), not rewritten. Three reasons:
      - Rewriting risks producing a second violation, and the overlay is
        permanent once encoded.
      - Substituting a generic "Clip 3" is a visible quality regression the
        user did not ask for.
      - No hook card at all is strictly better than an off-brand one: the clip
        still ships with its captions, and the reason is recorded.

    The caller must log the violation. This never fails the job.
    """
    violations = screen_text(title or "", kit)
    if violations:
        log.warning(
            "hook_title_blocked_by_brand_kit",
            job_id=job_id,
            violations=violations,
            title=(title or "")[:120],
        )
        return None, violations
    return title, []


# ── Caption styling from the brand palette ──────────────────────────────────
# ASS subtitles use &HAABBGGRR — alpha, then BLUE, GREEN, RED. Note the byte
# order is reversed relative to the #RRGGBB the brand kit stores, which is the
# single easiest thing to get wrong here.

def _hex_to_ass(hex_colour: str, alpha: str = "00") -> Optional[str]:
    """Convert #RRGGBB to ASS &HAABBGGRR. Returns None if unparseable."""
    if not hex_colour:
        return None
    value = str(hex_colour).strip().lstrip("#")
    if len(value) == 3:  # #abc shorthand
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6 or not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        return None
    r, g, b = value[0:2], value[2:4], value[4:6]
    return f"&H{alpha}{b}{g}{r}".upper()


def _relative_luminance(hex_colour: str) -> Optional[float]:
    """
    WCAG relative luminance (0.0 black — 1.0 white) for an #RRGGBB colour.

    sRGB channels are gamma-encoded, so they must be linearised before
    weighting; averaging the raw bytes instead — the common shortcut — puts
    mid-blues and mid-yellows on the wrong side of any threshold, which is
    exactly the case that decides whether text is readable.
    """
    value = str(hex_colour or "").strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6 or not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        return None

    def channel(pair: str) -> float:
        c = int(pair, 16) / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = channel(value[0:2]), channel(value[2:4]), channel(value[4:6])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _first_usable_hex(kit: Optional[dict]) -> Optional[str]:
    """The brand's primary colour as #RRGGBB, preferring an explicit usage label."""
    if not kit:
        return None
    palette = kit.get("color_palette")
    if not isinstance(palette, list):
        return None

    labelled = None
    positional = None
    for entry in palette:
        if not isinstance(entry, dict):
            continue
        raw = str(entry.get("hex", "")).strip()
        if _relative_luminance(raw) is None:
            continue
        if positional is None:
            positional = raw
        usage = str(entry.get("usage", "")).lower()
        if labelled is None and ("primary" in usage or "brand" in usage):
            labelled = raw
    return labelled or positional


def hook_overlay_colors(kit: Optional[dict]) -> dict:
    """
    Colours for the burned-in hook card, as FFmpeg drawtext values.

    Returns {} when the kit has no usable palette, so the caller keeps its
    existing white-on-black default rather than rendering something
    half-branded.

    The box takes the brand colour; the TEXT colour is then *derived*, not
    chosen — black on a light box, white on a dark one. This is the whole
    reason this function exists rather than a straight substitution: the hook
    card is a solid fill, so letting a brand set both colours independently is
    how you ship white text on a pale yellow box. The brand picks the box;
    contrast is not theirs to lose.

    Alpha stays at the preset 0.55 so the underlying footage still reads
    through, which is what makes the card feel like an overlay rather than a
    banner.
    """
    brand_hex = _first_usable_hex(kit)
    if not brand_hex:
        return {}

    luminance = _relative_luminance(brand_hex)
    if luminance is None:
        return {}

    normalised = str(brand_hex).strip().lstrip("#")
    if len(normalised) == 3:
        normalised = "".join(ch * 2 for ch in normalised)

    # 0.45 rather than 0.5: the box is drawn at 55% opacity over video, which
    # lightens dark fills more than it darkens light ones, so the crossover
    # sits slightly below the midpoint.
    text_colour = "black" if luminance > 0.45 else "white"

    return {
        "boxcolor": f"0x{normalised.upper()}@0.55",
        "fontcolor": text_colour,
    }


def palette_colours(kit: Optional[dict]) -> dict:
    """
    Extract usable ASS colours from `color_palette`.

    The palette stores entries as {hex, name, usage}. `usage` is a free-text
    hint ("background", "accent", "primary"), so it is matched loosely and
    falls back to positional order — the first entry is treated as primary,
    which is how the kit is presented to users when they fill it in.

    Returns {} when nothing usable is present, so callers can keep their
    existing defaults rather than render something half-branded.
    """
    if not kit:
        return {}
    palette = kit.get("color_palette")
    if not isinstance(palette, list) or not palette:
        return {}

    primary = None
    accent = None
    for entry in palette:
        if not isinstance(entry, dict):
            continue
        ass = _hex_to_ass(entry.get("hex", ""))
        if not ass:
            continue
        usage = str(entry.get("usage", "")).lower()
        if primary is None and ("primary" in usage or "brand" in usage):
            primary = ass
        elif accent is None and ("accent" in usage or "highlight" in usage):
            accent = ass

    # Positional fallback for kits whose `usage` text does not match.
    if primary is None or accent is None:
        usable = [c for c in (_hex_to_ass(e.get("hex", "")) for e in palette if isinstance(e, dict)) if c]
        if primary is None and usable:
            primary = usable[0]
        if accent is None and len(usable) > 1:
            accent = usable[1]

    out = {}
    if primary:
        out["primary_color"] = primary
    if accent:
        out["secondary_color"] = accent
    return out
