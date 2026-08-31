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

from brand_kit import screen_text, screen_hook_title, palette_colours, _hex_to_ass  # noqa: E402

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

print("")
if failures:
    print(f"FAIL — {len(failures)} of {len(failures) + 0} checks failed:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)

print("brand screening: OK — all checks passed")
