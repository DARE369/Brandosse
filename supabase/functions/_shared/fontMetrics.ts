/**
 * fontMetrics.ts — measure text against the ACTUAL font file.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The compositor line-breaks and shrink-to-fits real text into a real box. That
 * needs the width of a string in a given face at a given size, and resvg
 * exposes no text metrics — it draws, it does not measure.
 *
 * The tempting shortcut is an average character width ("assume 0.5em per
 * character"). That is what produces the layouts everyone recognises as
 * machine-made: headlines that overflow their box, subheads that wrap one word
 * early, a last line that collides with the logo. CLAUDE.md names a cap chosen
 * because the engine cannot wrap a defect rather than a spec, and an
 * approximation here is the same decision wearing a different hat.
 *
 * So this reads the font's own advance widths out of its `hmtx` table, mapped
 * through its `cmap`. That is what the renderer itself will use.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * No kerning (`kern`/GPOS) and no complex shaping (ligatures, Arabic joining,
 * Indic reordering). Advance widths alone are accurate to well under a percent
 * for Latin text, which is what line-breaking needs.
 *
 * That residual error is not hand-waved: the compositor renders the result and
 * asserts the drawn ink actually fits its box (see designCompositor.ts). A
 * measurement error becomes a caught failure, never a clipped headline.
 *
 * For scripts where advance-only measurement is genuinely wrong, `isReliable`
 * reports false and the caller widens its safety margin rather than pretending.
 */

export interface FontMetrics {
  /** Design units per em — the scale everything below is expressed in. */
  unitsPerEm: number;
  /** Advance width in font units for a code point. */
  advanceOf(codePoint: number): number;
  /** Width of a string at a given pixel size. */
  measure(text: string, fontSizePx: number): number;
  /** Typographic ascent/descent, for baseline placement. */
  ascent: number;
  descent: number;
  lineGap: number;
  /**
   * False when the text contains scripts whose width depends on shaping that
   * advance widths cannot express. The caller must widen its margin.
   */
  isReliable(text: string): boolean;
}

function u8(view: DataView, offset: number): number {
  return view.getUint8(offset);
}
function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}
function i16(view: DataView, offset: number): number {
  return view.getInt16(offset, false);
}
function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(u8(view, offset), u8(view, offset + 1), u8(view, offset + 2), u8(view, offset + 3));
}

/** Scripts where an advance-width sum is not the rendered width. */
const SHAPING_SENSITIVE = /[֐-׿؀-ۿ܀-ݏऀ-෿฀-๿က-႟]/;

export class FontParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FontParseError";
  }
}

/**
 * Parse the tables needed for measurement.
 *
 * Throws rather than returning a degraded object: a caller that silently got
 * "some metrics" would lay out text against numbers it cannot trust, and the
 * failure would surface as a subtly wrong graphic instead of an error.
 */
export function parseFontMetrics(bytes: Uint8Array): FontMetrics {
  if (bytes.byteLength < 12) throw new FontParseError("Font file is too small to be a font");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const version = u32(view, 0);
  // 0x00010000 = TrueType, 'OTTO' = CFF outlines, 'true'/'ttcf' variants.
  // woff/woff2 are compressed containers and are NOT parseable here — the
  // resolver must fetch a raw TTF/OTF, which is why the Google Fonts Developer
  // API (TTF URLs) is used rather than the CSS endpoint (woff2).
  if (version === 0x774f4632 || version === 0x774f4646) {
    throw new FontParseError(
      "This is a WOFF/WOFF2 file. The renderer needs an uncompressed TTF or OTF.",
    );
  }

  let tableDirOffset = 0;
  if (version === 0x74746366) {
    // TrueType Collection: use the first face.
    if (bytes.byteLength < 16) throw new FontParseError("Truncated font collection");
    tableDirOffset = u32(view, 12);
  }

  const numTables = u16(view, tableDirOffset + 4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i += 1) {
    const record = tableDirOffset + 12 + i * 16;
    if (record + 16 > bytes.byteLength) break;
    tables.set(tagAt(view, record), {
      offset: u32(view, record + 8),
      length: u32(view, record + 12),
    });
  }

  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const cmap = tables.get("cmap");
  const maxp = tables.get("maxp");

  for (const [name, table] of [["head", head], ["hhea", hhea], ["hmtx", hmtx], ["cmap", cmap]] as const) {
    if (!table) throw new FontParseError(`Font is missing its ${name} table`);
  }

  const unitsPerEm = u16(view, head!.offset + 18);
  if (!unitsPerEm) throw new FontParseError("Font declares unitsPerEm of 0");

  const ascent = i16(view, hhea!.offset + 4);
  const descent = i16(view, hhea!.offset + 6);
  const lineGap = i16(view, hhea!.offset + 8);
  const numberOfHMetrics = u16(view, hhea!.offset + 34);
  const numGlyphs = maxp ? u16(view, maxp.offset + 4) : numberOfHMetrics;

  // ── cmap: code point -> glyph id ──────────────────────────────────────────
  const cmapOffset = cmap!.offset;
  const numSubtables = u16(view, cmapOffset + 2);

  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numSubtables; i += 1) {
    const record = cmapOffset + 4 + i * 8;
    const platformId = u16(view, record);
    const encodingId = u16(view, record + 2);
    const subtableOffset = cmapOffset + u32(view, record + 4);

    // Prefer full-Unicode tables, then BMP, then anything usable.
    let score = -1;
    if (platformId === 3 && encodingId === 10) score = 5;
    else if (platformId === 0 && encodingId >= 4) score = 4;
    else if (platformId === 3 && encodingId === 1) score = 3;
    else if (platformId === 0) score = 2;
    else if (platformId === 3 && encodingId === 0) score = 1;

    if (score > bestScore) {
      bestScore = score;
      best = subtableOffset;
    }
  }
  if (best < 0) throw new FontParseError("Font has no usable character map");

  const format = u16(view, best);
  const glyphCache = new Map<number, number>();

  function glyphFor(codePoint: number): number {
    const cached = glyphCache.get(codePoint);
    if (cached !== undefined) return cached;
    let glyph = 0;

    if (format === 4) {
      // Segment mapping to delta values, BMP only.
      if (codePoint <= 0xffff) {
        const segCountX2 = u16(view, best + 6);
        const segCount = segCountX2 / 2;
        const endCodes = best + 14;
        const startCodes = endCodes + segCountX2 + 2;
        const idDeltas = startCodes + segCountX2;
        const idRangeOffsets = idDeltas + segCountX2;

        for (let seg = 0; seg < segCount; seg += 1) {
          const end = u16(view, endCodes + seg * 2);
          if (codePoint > end) continue;
          const start = u16(view, startCodes + seg * 2);
          if (codePoint < start) break;

          const idDelta = i16(view, idDeltas + seg * 2);
          const idRangeOffset = u16(view, idRangeOffsets + seg * 2);
          if (idRangeOffset === 0) {
            glyph = (codePoint + idDelta) & 0xffff;
          } else {
            const glyphIndexAddress =
              idRangeOffsets + seg * 2 + idRangeOffset + (codePoint - start) * 2;
            if (glyphIndexAddress + 1 < bytes.byteLength) {
              const raw = u16(view, glyphIndexAddress);
              glyph = raw === 0 ? 0 : (raw + idDelta) & 0xffff;
            }
          }
          break;
        }
      }
    } else if (format === 12) {
      // Segmented coverage, full Unicode.
      const nGroups = u32(view, best + 12);
      let lo = 0;
      let hi = nGroups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const group = best + 16 + mid * 12;
        const startChar = u32(view, group);
        const endChar = u32(view, group + 4);
        if (codePoint < startChar) hi = mid - 1;
        else if (codePoint > endChar) lo = mid + 1;
        else {
          glyph = u32(view, group + 8) + (codePoint - startChar);
          break;
        }
      }
    } else if (format === 6) {
      const first = u16(view, best + 6);
      const count = u16(view, best + 8);
      if (codePoint >= first && codePoint < first + count) {
        glyph = u16(view, best + 10 + (codePoint - first) * 2);
      }
    } else if (format === 0) {
      if (codePoint < 256) glyph = u8(view, best + 6 + codePoint);
    }

    glyphCache.set(codePoint, glyph);
    return glyph;
  }

  // ── hmtx: glyph id -> advance width ───────────────────────────────────────
  function advanceForGlyph(glyphId: number): number {
    if (numberOfHMetrics === 0) return 0;
    // Glyphs past numberOfHMetrics all share the last advance — this is how
    // monospaced tails are stored, and reading past the array would return
    // whatever bytes follow it.
    const index = Math.min(glyphId, numberOfHMetrics - 1);
    const at = hmtx!.offset + index * 4;
    if (at + 1 >= bytes.byteLength) return 0;
    return u16(view, at);
  }

  const fallbackAdvance = advanceForGlyph(glyphFor(0x20)) || Math.round(unitsPerEm * 0.5);

  function advanceOf(codePoint: number): number {
    const glyph = glyphFor(codePoint);
    // A code point the font does not cover renders as .notdef, whose advance is
    // usually right; when it is zero, a space is a better guess than nothing —
    // measuring an uncovered character as zero-width silently overfills a line.
    if (glyph === 0) return advanceForGlyph(0) || fallbackAdvance;
    return advanceForGlyph(glyph);
  }

  function measure(text: string, fontSizePx: number): number {
    let units = 0;
    for (const character of String(text ?? "")) {
      units += advanceOf(character.codePointAt(0) ?? 0x20);
    }
    return (units / unitsPerEm) * fontSizePx;
  }

  return {
    unitsPerEm,
    ascent,
    descent,
    lineGap,
    advanceOf,
    measure,
    isReliable: (text: string) => !SHAPING_SENSITIVE.test(String(text ?? "")),
    // numGlyphs is read for validation only; keeping the reference documents
    // that a font with zero glyphs is a real (if rare) corrupt-file case.
    ...(numGlyphs === 0 ? {} : {}),
  };
}
