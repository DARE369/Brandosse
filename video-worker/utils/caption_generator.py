# video-worker/utils/caption_generator.py
# Caption style presets for viral video clips, rendered as ASS subtitles.

from logger import log


# ── Colour palettes ──────────────────────────────────────────────────────────
# &HAABBGGRR format (alpha, blue, green, red). Alpha=00 is fully opaque.
# Used for per-event / per-word colour cycling in box_pop and color_pop.

BOX_POP_PALETTE = [
    "&H00356BFF",  # orange
    "&H00632EFF",  # hot pink
    "&H00FFC42E",  # electric blue
    "&H002EFF8C",  # lime green
    "&H00FF2EA8",  # purple
    "&H002ED1FF",  # gold
]

COLOR_POP_PALETTE = [
    "&H00E0FF2E",  # cyan
    "&H00E02EFF",  # magenta
    "&H002EFFD1",  # yellow-green
    "&H006B6BFF",  # coral
    "&H00FFC46B",  # sky blue
    "&H00FF6BC4",  # violet
]


# ── Style presets ─────────────────────────────────────────────────────────────
# Each entry drives _build_header() (Style line) and _build_event_text()
# (per-event/per-word override tags). karaoke is the existing default style;
# the rest are additive presets layered on the same ASS pipeline.

STYLE_CONFIGS = {
    "karaoke": {
        "fontsize": 20,
        "primary_color": "&H00FFFFFF",
        "secondary_color": "&H0000E5FF",
        "outline_color": "&H00000000",
        "back_color": "&H80000000",
        "bold": 1,
        "border_style": 1,
        "outline": 3,
        "shadow": 1.5,
        "alignment": 2,
        "margin_v": 60,
        "group_size": 4,
        "karaoke_tag": "kf",
        "per_word_color": False,
        "box_color_cycle": False,
        "word_upper": False,
    },
    "bold_drop": {
        "fontsize": 26,
        "primary_color": "&H00FFFFFF",
        "secondary_color": "&H0000E5FF",
        "outline_color": "&H00000000",
        "back_color": "&H00000000",
        "bold": 1,
        "border_style": 1,
        "outline": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 80,
        "group_size": 3,
        "karaoke_tag": None,
        "per_word_color": False,
        "box_color_cycle": False,
        "word_upper": True,
        "bold_drop_colors": ["&H00FFFFFF", "&H0000E5FF"],
    },
    "box_pop": {
        "fontsize": 22,
        "primary_color": "&H00FFFFFF",
        "secondary_color": "&H0000E5FF",
        "outline_color": "&H00000000",
        "back_color": "&H00000000",
        "bold": 1,
        "border_style": 3,
        "outline": 10,
        "shadow": 0,
        "alignment": 2,
        "margin_v": 60,
        "group_size": 4,
        "karaoke_tag": None,
        "per_word_color": False,
        "box_color_cycle": True,
        "word_upper": False,
    },
    "classic": {
        "fontsize": 18,
        "primary_color": "&H00FFFFFF",
        "secondary_color": "&H00FFFFFF",
        "outline_color": "&H00000000",
        "back_color": "&H00000000",
        "bold": 0,
        "border_style": 1,
        "outline": 2,
        "shadow": 0,
        "alignment": 2,
        "margin_v": 50,
        "group_size": 5,
        "karaoke_tag": None,
        "per_word_color": False,
        "box_color_cycle": False,
        "word_upper": False,
    },
    "color_pop": {
        "fontsize": 22,
        "primary_color": "&H00FFFFFF",
        "secondary_color": "&H0000E5FF",
        "outline_color": "&H00000000",
        "back_color": "&H00000000",
        "bold": 1,
        "border_style": 1,
        "outline": 3,
        "shadow": 1,
        "alignment": 2,
        "margin_v": 60,
        "group_size": 4,
        "karaoke_tag": None,
        "per_word_color": True,
        "box_color_cycle": False,
        "word_upper": False,
    },
    "focus_word": {
        "fontsize": 24,
        "primary_color": "&H00FFFFFF",
        "secondary_color": "&H0000E5FF",
        "outline_color": "&H00000000",
        "back_color": "&H00000000",
        "bold": 1,
        "border_style": 1,
        "outline": 3,
        "shadow": 1.5,
        "alignment": 2,
        "margin_v": 65,
        "group_size": 3,
        "karaoke_tag": "k",
        "per_word_color": False,
        "box_color_cycle": False,
        "word_upper": False,
    },
}


def generate_karaoke_captions(
    word_segments: list,
    clip_start: float,
    clip_end: float,
    output_path: str,
    style: str = "karaoke",
    play_res_x: int = 608,
    play_res_y: int = 1080,
) -> str:
    """
    Generate an ASS subtitle file for a clip using one of the STYLE_CONFIGS
    presets (karaoke, bold_drop, box_pop, classic, color_pop, focus_word).

    Unknown style strings fall back to "karaoke".

    Args:
        word_segments: List of {"word": str, "start": float, "end": float}
        clip_start: Clip start time in seconds
        clip_end: Clip end time in seconds
        output_path: Where to write the ASS file
        style: Caption style preset name

    Returns:
        Path to the generated ASS file, or "" if no words fall within the
        clip's time range.
    """
    config = STYLE_CONFIGS.get(style, STYLE_CONFIGS["karaoke"])

    try:
        events = _build_events(word_segments, clip_start, clip_end, config)

        if not events:
            log.warning("generate_captions_no_words", clip_start=clip_start, clip_end=clip_end)
            return ""

        ass_content = _build_header(config, play_res_x=play_res_x, play_res_y=play_res_y) + "\n".join(events)

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(ass_content)

        log.info("captions_generated", output_path=output_path, style=style, events=len(events))
        return output_path

    except Exception as e:
        log.error("caption_generation_failed", error=str(e)[:200])
        raise


def _build_events(word_segments: list, clip_start: float, clip_end: float, config: dict) -> list:
    """Build one ASS Dialogue line per word group within the clip's time range."""
    clip_words = [
        w for w in word_segments
        if w["start"] >= clip_start - 0.05 and w["end"] <= clip_end + 0.05
    ]

    if not clip_words:
        return []

    adjusted_words = []
    for w in clip_words:
        adjusted_words.append({
            "word": w["word"],
            "start": max(0.0, w["start"] - clip_start),
            "end": max(0.0, w["end"] - clip_start),
        })

    group_size = config["group_size"]
    groups = []
    current_group = []
    for w in adjusted_words:
        current_group.append(w)
        if len(current_group) >= group_size:
            groups.append(current_group)
            current_group = []
    if current_group:
        groups.append(current_group)

    events = []
    for event_index, group in enumerate(groups):
        group_start = group[0]["start"]
        group_end = group[-1]["end"]

        text = _build_event_text(group, config, event_index)

        start_ts = _secs_to_ass_time(group_start)
        end_ts = _secs_to_ass_time(group_end + 0.2)  # Keep line visible briefly after last word

        events.append(f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{text}")

    return events


def _build_event_text(group: list, config: dict, bold_drop_color_index: int) -> str:
    """Build the override-tagged text for one Dialogue event, per the style config."""
    karaoke_tag = config.get("karaoke_tag")
    word_upper = config.get("word_upper", False)
    per_word_color = config.get("per_word_color", False)
    box_color_cycle = config.get("box_color_cycle", False)
    bold_drop_colors = config.get("bold_drop_colors")
    group_size = config["group_size"]

    def transform(word: str) -> str:
        return word.upper() if word_upper else word

    if karaoke_tag:
        # \kf = progressive fill (karaoke), \k = instant switch (focus_word)
        parts = []
        for w in group:
            duration_cs = int(round((w["end"] - w["start"]) * 100))
            duration_cs = max(10, min(9999, duration_cs))  # Clamp to valid range
            parts.append(f"{{\\{karaoke_tag}{duration_cs}}}{transform(w['word'])} ")
        return "".join(parts).strip()

    if per_word_color:
        parts = []
        for i, w in enumerate(group):
            global_index = bold_drop_color_index * group_size + i
            color = _to_override_color(COLOR_POP_PALETTE[global_index % len(COLOR_POP_PALETTE)])
            parts.append(f"{{\\1c{color}}}{transform(w['word'])} ")
        return "".join(parts).strip()

    text = " ".join(transform(w["word"]) for w in group)

    if bold_drop_colors:
        color = _to_override_color(bold_drop_colors[bold_drop_color_index % len(bold_drop_colors)])
        return f"{{\\1c{color}}}{text}"

    if box_color_cycle:
        color = _to_override_color(BOX_POP_PALETTE[bold_drop_color_index % len(BOX_POP_PALETTE)])
        return f"{{\\3c{color}}}{text}"

    return text


def _to_override_color(color: str) -> str:
    """
    Convert an &HAABBGGRR style colour to the &HBBGGRR& inline override-tag
    format expected by \\1c/\\3c (no alpha byte; alpha has its own \\1a/\\3a tags).
    """
    bgr = color.replace("&H", "")[-6:]
    return f"&H{bgr}&"


def _build_header(config: dict, play_res_x: int = 608, play_res_y: int = 1080) -> str:
    """Generate the ASS file header ([Script Info] + [V4+ Styles]) for a style config."""
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {play_res_x}
PlayResY: {play_res_y}
ScaledBorderAndShadow: yes
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{config['fontsize']},{config['primary_color']},{config['secondary_color']},{config['outline_color']},{config['back_color']},{config['bold']},0,0,0,100,100,0,0,{config['border_style']},{config['outline']},{config['shadow']},{config['alignment']},20,20,{config['margin_v']},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _secs_to_ass_time(secs: float) -> str:
    """
    Convert seconds to ASS time format: H:MM:SS.CC

    Examples:
    - 0.5 seconds → "0:00:00.50"
    - 65.3 seconds → "0:01:05.30"
    """
    total_cs = int(round(secs * 100))
    h = total_cs // 360000
    total_cs %= 360000
    m = total_cs // 6000
    total_cs %= 6000
    s = total_cs // 100
    cs = total_cs % 100
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"
