#!/usr/bin/env python3
"""
test_brand_screening.py — guard for the burned-in-pixels brand defect.

Run:  python video-worker/tests/test_brand_screening.py

── What this protects ───────────────────────────────────────────────────────
An LLM writes the hook title (stages/analyze.py) and it is burned into H.264
(stages/render.py). Until 2026-08-31 nothing checked it against the user's own
`forbidden_phrases`. A forbidden phrase in a caption is editable; in pixels it
requires a paid re-render. This asserts the screen actually blocks.

Stdlib only, no pytest, no network — so it runs anywhere CI can run Python.
"""

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.dirname(HERE)
sys.path.insert(0, WORKER)

# brand_kit imports `database` and `logger` at module level. Neither is used by
# the pure functions under test, and importing the real ones would drag in the
# supabase client. Stub them so this test needs nothing but stdlib.
_db = types.ModuleType("database")
_db.get_supabase_client = lambda: None  # never called in these tests
sys.modules.setdefault("database", _db)

_log = types.ModuleType("logger")


class _Log:
    def info(self, *a, **k):
        pass

    def warning(self, *a, **k):
        pass

    def error(self, *a, **k):
        pass


_log.log = _Log()
sys.modules.setdefault("logger", _log)

from brand_kit import (  # noqa: E402
    banned_phrases,
    neutral_title,
    screen_text,
    screen_hook_title,
    palette_colours,
    hook_overlay_colors,
    _hex_to_ass,
    _relative_luminance,
)

failures = []


def check(name, actual, expected):
    if actual == expected:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}\n          expected: {expected!r}\n          actual:   {actual!r}")
        failures.append(name)


KIT = {"forbidden_phrases": ["cheap", "guaranteed", "risk free"]}

# ── Screening ───────────────────────────────────────────────────────────────
check("blocks a forbidden phrase",
      screen_text("The cheap way to grow", KIT), ["cheap"])

check("is case-insensitive",
      screen_text("CHEAP and fast", KIT), ["cheap"])

check("matches a multi-word phrase",
      screen_text("It is risk free today", KIT), ["risk free"])

check("reports every violation, not just the first",
      screen_text("cheap and guaranteed", KIT), ["cheap", "guaranteed"])

# The false-positive case. A naive substring check fails this one, and a
# suppressed legitimate title is itself a quality regression.
check("does not match inside a longer word",
      screen_text("Cheapskate is one word; cheaply is another", KIT), [])

check("clean text passes",
      screen_text("A better way to grow your brand", KIT), [])

check("no kit means no screening",
      screen_text("cheap guaranteed risk free", None), [])

check("empty forbidden list means no screening",
      screen_text("cheap", {"forbidden_phrases": []}), [])

check("a non-list column does not crash",
      screen_text("cheap", {"forbidden_phrases": "cheap"}), [])

check("empty text is clean",
      screen_text("", KIT), [])

# ── The decision the render path acts on ────────────────────────────────────
title, violations = screen_hook_title("The cheap way to grow", KIT)
check("a violating title is dropped, not rewritten", title, None)
check("and the violation is reported", violations, ["cheap"])

title, violations = screen_hook_title("A better way to grow", KIT)
check("a clean title is passed through unchanged", title, "A better way to grow")
check("with no violations", violations, [])

# ── Palette conversion ──────────────────────────────────────────────────────
# ASS is &HAABBGGRR — alpha, then BLUE, GREEN, RED. The reversed byte order
# relative to #RRGGBB is the single easiest thing to get wrong here.
check("#RRGGBB converts to ASS with reversed byte order",
      _hex_to_ass("#FF5733"), "&H003357FF")

check("three-digit shorthand expands",
      _hex_to_ass("#F53"), "&H003355FF")

check("a missing hash still parses",
      _hex_to_ass("FF5733"), "&H003357FF")

check("garbage returns None rather than a wrong colour",
      _hex_to_ass("not-a-colour"), None)

check("empty returns None", _hex_to_ass(""), None)

check("palette reads usage labels",
      palette_colours({"color_palette": [
          {"hex": "#FF5733", "usage": "accent"},
          {"hex": "#123456", "usage": "primary brand"},
      ]}),
      {"primary_color": "&H00563412", "secondary_color": "&H003357FF"})

check("palette falls back to position when usage does not match",
      palette_colours({"color_palette": [
          {"hex": "#FF5733", "usage": "whatever"},
          {"hex": "#123456", "usage": "something else"},
      ]}),
      {"primary_color": "&H003357FF", "secondary_color": "&H00563412"})

check("no palette returns nothing, so existing defaults survive",
      palette_colours({"color_palette": []}), {})

check("unparseable palette entries are skipped, not rendered wrong",
      palette_colours({"color_palette": [{"hex": "bogus", "usage": "primary"}]}), {})

# ── Derived phrases from prose restrictions ─────────────────────────────────
# "No alcohol references" cannot be literal-matched; "beer", "wine" can. The
# prose is reduced ONCE at kit-save time into derived_banned_phrases, so
# screening costs a string match instead of an LLM call per render.

DERIVED = {"forbidden_phrases": ["cheap"], "derived_banned_phrases": ["beer", "wine"]}

check("derived phrases are screened alongside the user's own",
      screen_text("Grab a beer with us", DERIVED), ["beer"])
check("the user's own phrases still screen",
      screen_text("The cheap option", DERIVED), ["cheap"])
check("both sources merge",
      banned_phrases(DERIVED), ["cheap", "beer", "wine"])

# The two columns are stored separately so authorship stays unambiguous, but a
# duplicate across them must not be reported twice.
check("a phrase in both columns is not duplicated",
      banned_phrases({"forbidden_phrases": ["Cheap"], "derived_banned_phrases": ["cheap"]}),
      ["Cheap"])
check("a missing derived column is fine",
      banned_phrases({"forbidden_phrases": ["cheap"]}), ["cheap"])
check("no kit yields no phrases", banned_phrases(None), [])

check("the neutral fallback is 1-indexed for humans", neutral_title(0), "Clip 1")
check("and counts up", neutral_title(4), "Clip 5")

# ── Hook overlay contrast ───────────────────────────────────────────────────
# The hook card is a solid fill burned into the frame. The brand picks the box;
# the text colour is DERIVED from it. Letting a brand choose both independently
# is how you ship white text on a pale yellow box.

check("pure white has luminance 1.0", round(_relative_luminance("#FFFFFF"), 3), 1.0)
check("pure black has luminance 0.0", round(_relative_luminance("#000000"), 3), 0.0)

# Gamma matters. Mid-grey #808080 is 50% of the byte range but ~21% of the
# light. Averaging raw bytes would call this "light" and pick black text for a
# box most people read as dark.
check("mid grey is linearised, not byte-averaged",
      _relative_luminance("#808080") < 0.25, True)

# Green dominates perceived brightness (0.7152 of the weighting); blue barely
# registers. A naive average would rank these two the same.
check("pure green reads as light", _relative_luminance("#00FF00") > 0.6, True)
check("pure blue reads as dark", _relative_luminance("#0000FF") < 0.1, True)

check("garbage luminance returns None", _relative_luminance("nope"), None)

dark = hook_overlay_colors({"color_palette": [{"hex": "#0B1F3A", "usage": "primary"}]})
check("a dark brand box gets white text", dark.get("fontcolor"), "white")
check("and the box takes the brand colour", dark.get("boxcolor"), "0x0B1F3A@0.55")

light = hook_overlay_colors({"color_palette": [{"hex": "#FFE45C", "usage": "primary"}]})
check("a light brand box gets black text", light.get("fontcolor"), "black")
check("and still takes the brand colour", light.get("boxcolor"), "0xFFE45C@0.55")

check("no palette leaves the white-on-black default in place",
      hook_overlay_colors({"color_palette": []}), {})
check("no kit leaves the default in place", hook_overlay_colors(None), {})
check("an unparseable palette leaves the default in place",
      hook_overlay_colors({"color_palette": [{"hex": "###", "usage": "primary"}]}), {})

check("a usage label wins over position",
      hook_overlay_colors({"color_palette": [
          {"hex": "#FFE45C", "usage": "background"},
          {"hex": "#0B1F3A", "usage": "primary"},
      ]}).get("boxcolor"),
      "0x0B1F3A@0.55")

# ── Caption presets overlaid with a brand palette ───────────────────────────
sys.path.insert(0, os.path.join(WORKER, "utils"))
from caption_generator import _apply_brand_colors, STYLE_CONFIGS  # noqa: E402

PRESET = STYLE_CONFIGS["karaoke"]
BRAND = {"primary_color": "&H003357FF", "secondary_color": "&H00563412"}

out = _apply_brand_colors(PRESET, BRAND)
check("brand primary replaces the preset body colour",
      out["primary_color"], "&H003357FF")
check("brand secondary replaces the preset highlight",
      out["secondary_color"], "&H00563412")

# Legibility infrastructure is not the brand's to override. A pale brand
# primary over bright footage is unreadable the moment the black outline is
# replaced, and the person who suffers is the viewer.
check("outline colour survives branding",
      out["outline_color"], PRESET["outline_color"])
check("box background survives branding",
      out["back_color"], PRESET["back_color"])
check("outline width survives branding", out["outline"], PRESET["outline"])

# STYLE_CONFIGS is module-level shared state. Mutating it in place would leak
# one customer's palette into the next job rendered by the same worker
# process — a cross-tenant defect, not a cosmetic one.
check("the shared preset is not mutated",
      STYLE_CONFIGS["karaoke"]["primary_color"], PRESET["primary_color"])
check("and it is genuinely a different dict", out is PRESET, False)

check("two brand colours replace the hardcoded cycling palette",
      out.get("box_palette"), ["&H003357FF", "&H00563412"])

one = _apply_brand_colors(PRESET, {"primary_color": "&H003357FF"})
check("one colour is not enough for a cycle, so the preset palette stays",
      one.get("box_palette"), None)
check("but the single colour still applies to body text",
      one["primary_color"], "&H003357FF")

check("no brand colours returns the preset untouched",
      _apply_brand_colors(PRESET, {}), PRESET)
check("None returns the preset untouched",
      _apply_brand_colors(PRESET, None), PRESET)

# ── Brand font resolution ───────────────────────────────────────────────────
# fonts.py imports config, which requires real env vars to construct. Stub it:
# the functions under test never read it.
_cfg = types.ModuleType("config")


class _Cfg:
    temp_dir = os.path.join(HERE, "_fonttmp")
    google_fonts_api_key = ""


_cfg.config = _Cfg()
sys.modules.setdefault("config", _cfg)

from fonts import brand_font_family, _pick_variant, _safe_name  # noqa: E402

check("reads font_display.family from the kit",
      brand_font_family({"font_display": {"family": "Poppins"}}, "display"), "Poppins")
check("reads font_body.family",
      brand_font_family({"font_body": {"family": "Inter"}}, "body"), "Inter")

# The live schema has drifted from the migrations, so the column may be a plain
# string, missing, or null. None of those may raise inside a render.
check("tolerates a plain string column",
      brand_font_family({"font_display": "Poppins"}, "display"), "Poppins")
check("missing column returns None",
      brand_font_family({}, "display"), None)
check("null column returns None",
      brand_font_family({"font_display": None}, "display"), None)
check("empty family returns None",
      brand_font_family({"font_display": {"family": "  "}}, "display"), None)
check("no kit returns None", brand_font_family(None, "display"), None)

# Hook cards and captions are set bold — that is what makes them readable over
# moving footage — so a display face prefers 700 over regular.
FILES = {"regular": "r.ttf", "700": "b.ttf", "300": "l.ttf", "italic": "i.ttf"}
check("display prefers bold", _pick_variant(FILES, prefer_bold=True), "b.ttf")
check("body prefers regular", _pick_variant(FILES, prefer_bold=False), "r.ttf")
check("falls back through neighbouring weights when 700 is absent",
      _pick_variant({"600": "s.ttf", "italic": "i.ttf"}, prefer_bold=True), "s.ttf")
check("never picks italic when an upright exists",
      _pick_variant({"italic": "i.ttf", "900": "x.ttf"}, prefer_bold=True), "x.ttf")
check("empty files map returns None", _pick_variant({}, prefer_bold=True), None)
check("non-dict returns None", _pick_variant(None, prefer_bold=True), None)

check("family names become safe filenames",
      _safe_name("Playfair Display SC"), "playfair-display-sc")
check("punctuation is stripped from filenames",
      _safe_name("Noto Sans/JP  v2!"), "noto-sans-jp-v2")

print("")
if failures:
    print(f"FAIL — {len(failures)} of {len(failures) + 0} checks failed:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)

print("brand screening: OK — all checks passed")
