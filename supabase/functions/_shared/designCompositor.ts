/**
 * designCompositor.ts — draw the brand's real words, in its real typeface, at
 * its exact colours, on top of a generated background.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * Asked to put words in a picture, a diffusion model draws letterforms as
 * texture that resembles writing. It has no concept of a word, so it misspells;
 * it cannot load a font, so it approximates "a modern sans"; and it treats a
 * hex code as a suggestion, so brand navy comes out as the model's navy.
 *
 * Those three failures are the bulk of what people recognise as "AI design",
 * and none of them is fixable by prompting harder. They are fixed by not asking.
 *
 * So a graphic is split in two. The model renders a deliberately text-free
 * BACKGROUND with calm space where the layout reserves it (see
 * designTemplates.ts). Everything the brand actually promises — the words, the
 * typeface, the exact hex, the logo, the legal line — is drawn here as vector
 * text and rasterised through resvg.
 *
 * ── Proven before it was built (2026-09-02) ─────────────────────────────────
 * Two spikes, because the alternative was building a layout engine on a guess:
 *
 *   1. resvg renders real glyphs from an embedded font buffer. It also renders
 *      text as ZERO PIXELS, throwing no error, when no buffer is supplied —
 *      exactly the silent no-op the third law forbids. `assertInk` below exists
 *      because of that measurement.
 *   2. fontMetrics.ts agrees with what resvg actually draws to within ~1.5% on
 *      serif, sans and monospace, and errs WIDE rather than narrow, which is the
 *      safe direction for line-breaking.
 *
 * ── Failure posture ─────────────────────────────────────────────────────────
 * If the brand's typeface cannot be resolved, this throws
 * `CompositorUnavailableError` rather than rendering in "some font" or, worse,
 * rendering nothing. The caller then falls back to the existing diffusion path
 * and records why. The user still gets an image; nobody is told they got brand
 * typography they did not get.
 */

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { rasterizeIfSvg } from "./composite.ts";
import { parseFontMetrics, type FontMetrics } from "./fontMetrics.ts";
import { resolveFont } from "./fonts.ts";
import {
  type Box,
  type DesignTemplate,
  type SlotSpec,
  type TextSlot,
} from "./designTemplates.ts";
import { contrastRatio, MIN_TEXT_CONTRAST, normalizeHex } from "./brandDesign.ts";

export class CompositorUnavailableError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`Design compositor unavailable: ${reason}`);
    this.name = "CompositorUnavailableError";
    this.reason = reason;
  }
}

export type TextContent = Partial<Record<TextSlot, string>>;

export interface CompositeDesignOptions {
  baseImage: Uint8Array;
  template: DesignTemplate;
  text: TextContent;
  /** The brand_kit design layer, already normalised by brandDesign.ts. */
  design: {
    color_roles?: Record<string, { hex?: string }>;
    type_scale?: Record<string, { family?: string; weight?: number; tracking?: number; case?: string } | number>;
    layout_rules?: { safe_margin_pct?: number; alignment?: string };
    logo_rules?: { clear_space_ratio?: number; min_width_px?: number; preferred_corner?: string };
  };
  logo?: { bytes: Uint8Array; mimeType?: string } | null;
}

export interface CompositeDesignResult {
  bytes: Uint8Array;
  templateId: string;
  /** Family actually drawn, per role. */
  fontsUsed: { display?: string; body?: string };
  /** Every substitution or miss, in plain language. Rides on the receipt. */
  notes: string[];
  scrimmedSlots: TextSlot[];
  recoloredSlots: TextSlot[];
  logoApplied: boolean;
  inkPixels: number;
  /**
   * The contrast every drawn block ended up with, against what it actually
   * sits on. Reported rather than merely enforced, so a guard can assert the
   * whole template x palette matrix and a receipt can show its work.
   */
  contrastReport: Array<{ slot: TextSlot; fill: string; ground: string; ratio: number }>;
  /**
   * What each slot ACTUALLY says in the finished image, against what was asked
   * for.
   *
   * `notes` can say a headline "was trimmed"; only this can show the four words
   * that are missing. Without it the UI can report that copy was lost but not
   * which copy, which is the difference between a warning a user can act on and
   * one they have to squint at the image to understand.
   */
  renderedText: Array<{
    slot: TextSlot;
    requested: string;
    /** The lines as drawn, joined by a space. Empty when the slot was dropped. */
    drawn: string;
    truncated: boolean;
  }>;
}

const JPEG_QUALITY = 92;

// ── Colour helpers ───────────────────────────────────────────────────────────

function roleHex(
  design: CompositeDesignOptions["design"],
  role: string,
  fallback: string,
): string {
  const hex = normalizeHex(design.color_roles?.[role]?.hex);
  return hex || fallback;
}

function luminanceOfRgb(r: number, g: number, b: number): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * What the background actually looks like under a text box.
 *
 * A designer squints at the area before choosing a colour; this is that, made
 * arithmetic. `variance` matters as much as the mean — text over an evenly dark
 * area is fine, text over the same average luminance split between bright sky
 * and dark rock is not, and only the second needs a scrim.
 */
function sampleRegion(
  bitmap: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  box: { x: number; y: number; width: number; height: number },
): { meanHex: string; meanLuminance: number; variance: number } {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(imageWidth, Math.ceil(box.x + box.width));
  const y1 = Math.min(imageHeight, Math.ceil(box.y + box.height));

  if (x1 <= x0 || y1 <= y0) {
    return { meanHex: "#808080", meanLuminance: 0.5, variance: 0 };
  }

  // Sample on a grid rather than every pixel: a 2048px canvas region is
  // millions of pixels and the answer does not change past a few thousand.
  const stepX = Math.max(1, Math.floor((x1 - x0) / 48));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 48));

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let lumSum = 0;
  let lumSqSum = 0;
  let count = 0;

  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * imageWidth + x) * 4;
      const r = bitmap[i];
      const g = bitmap[i + 1];
      const b = bitmap[i + 2];
      const lum = luminanceOfRgb(r, g, b);
      rSum += r; gSum += g; bSum += b;
      lumSum += lum; lumSqSum += lum * lum;
      count += 1;
    }
  }

  if (count === 0) return { meanHex: "#808080", meanLuminance: 0.5, variance: 0 };

  const meanLuminance = lumSum / count;
  return {
    meanHex: toHex(rSum / count, gSum / count, bSum / count),
    meanLuminance,
    variance: Math.max(0, lumSqSum / count - meanLuminance * meanLuminance),
  };
}

// ── Text layout ──────────────────────────────────────────────────────────────

interface LaidOutText {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  truncated: boolean;
}

/** Greedy wrap against real advance widths. */
function wrapText(
  text: string,
  metrics: FontMetrics,
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (metrics.measure(candidate, fontSize) <= maxWidth || !current) {
      current = candidate;
      // A single word longer than the box still has to go somewhere; it is
      // broken rather than allowed to overflow, because an overflowing word is
      // a clipped word.
      if (!current.includes(" ") && metrics.measure(current, fontSize) > maxWidth) {
        let head = "";
        for (const character of current) {
          if (metrics.measure(head + character, fontSize) > maxWidth && head) {
            lines.push(head);
            head = character;
          } else {
            head += character;
          }
        }
        current = head;
      }
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Wrap and shrink until the text fits its box.
 *
 * This is what removes the word-count cap. CLAUDE.md names a limit chosen
 * because the engine cannot wrap a defect rather than a spec; the engine can
 * wrap, so there is no limit — only a floor on legibility, below which the text
 * is truncated with an ellipsis and the caller is told.
 */
function layOutText(
  text: string,
  metrics: FontMetrics,
  spec: SlotSpec,
  boxPx: { width: number; height: number },
  shorterEdge: number,
): LaidOutText {
  const maxSize = spec.sizeFraction * shorterEdge;
  const minSize = spec.minSizeFraction * shorterEdge;
  // The metrics parser errs wide by ~1.5%, and shaping can add a hair more.
  // A 2% inset keeps a correctly-measured line from touching the box edge.
  const usableWidth = boxPx.width * 0.98;

  let fontSize = maxSize;
  let lines: string[] = [];
  let lineHeight = 0;

  while (fontSize >= minSize) {
    lines = wrapText(text, metrics, fontSize, usableWidth);
    lineHeight = fontSize * 1.18;
    const fits = lines.length <= spec.maxLines && lines.length * lineHeight <= boxPx.height;
    if (fits) return { lines, fontSize, lineHeight, truncated: false };
    fontSize *= 0.94;
  }

  // At the legibility floor. Keep what fits and mark the rest honestly rather
  // than drawing text that runs off the canvas.
  fontSize = minSize;
  lineHeight = fontSize * 1.18;
  lines = wrapText(text, metrics, fontSize, usableWidth);
  const maxLines = Math.max(1, Math.min(spec.maxLines, Math.floor(boxPx.height / lineHeight)));
  if (lines.length <= maxLines) return { lines, fontSize, lineHeight, truncated: false };

  const kept = lines.slice(0, maxLines);
  kept[kept.length - 1] = `${kept[kept.length - 1].replace(/[\s,;:.]+$/, "")}…`;
  return { lines: kept, fontSize, lineHeight, truncated: true };
}

// ── SVG assembly ─────────────────────────────────────────────────────────────

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function boxToPx(box: Box, width: number, height: number) {
  return {
    x: box.x * width,
    y: box.y * height,
    width: box.width * width,
    height: box.height * height,
  };
}

// ── The composite ────────────────────────────────────────────────────────────

export async function compositeDesign(
  options: CompositeDesignOptions,
): Promise<CompositeDesignResult> {
  const { baseImage, template, text, design } = options;
  const notes: string[] = [];

  const base = await Image.decode(baseImage);
  const width = base.width;
  const height = base.height;
  const shorterEdge = Math.min(width, height);

  // ── Fonts. Resolved before anything is laid out, because a missing font
  //    changes the answer to "how wide is this line", not just how it looks. ──
  const typeScale = design.type_scale ?? {};
  const displaySpec = (typeScale.display ?? {}) as { family?: string; weight?: number };
  const bodySpec = (typeScale.body ?? {}) as { family?: string; weight?: number };

  const [displayResolved, bodyResolved] = await Promise.all([
    resolveFont(displaySpec.family ?? "", displaySpec.weight ?? 700),
    resolveFont(bodySpec.family ?? "", bodySpec.weight ?? 400),
  ]);

  if (displayResolved.reason) notes.push(`Display font: ${displayResolved.reason}`);
  if (bodyResolved.reason) notes.push(`Body font: ${bodyResolved.reason}`);

  const displayFont = displayResolved.font ?? bodyResolved.font;
  const bodyFont = bodyResolved.font ?? displayResolved.font;

  if (!displayFont || !bodyFont) {
    // The spike proved this path renders blank with no error. Refusing here is
    // the whole reason that spike was run first.
    throw new CompositorUnavailableError(
      [displayResolved.reason, bodyResolved.reason].filter(Boolean).join("; ") ||
        "no usable font could be resolved",
    );
  }
  if (displayResolved.font && displayResolved.font.substituted) {
    notes.push(`Display weight substituted with "${displayResolved.font.variant}".`);
  }
  if (!displayResolved.font) {
    notes.push(`Display text drawn in the body face "${bodyFont.family}".`);
  }

  const displayMetrics = parseFontMetrics(displayFont.bytes);
  const bodyMetrics = parseFontMetrics(bodyFont.bytes);

  const fontBuffers = [displayFont.bytes];
  if (bodyFont.bytes !== displayFont.bytes) fontBuffers.push(bodyFont.bytes);

  // ── Colours ───────────────────────────────────────────────────────────────
  const backgroundHex = roleHex(design, "background", "#111111");
  const bitmap = base.bitmap as unknown as Uint8ClampedArray;

  const parts: string[] = [];
  const scrimmedSlots: TextSlot[] = [];
  const renderedText: CompositeDesignResult["renderedText"] = [];
  const recoloredSlots: TextSlot[] = [];
  const contrastReport: CompositeDesignResult["contrastReport"] = [];

  // Panels sit under everything, drawn in brand colour at exact hex.
  for (const panel of template.panels) {
    const px = boxToPx(panel.box, width, height);
    const hex = roleHex(design, panel.colorRole, backgroundHex);
    parts.push(
      `<rect x="${px.x.toFixed(2)}" y="${px.y.toFixed(2)}" width="${px.width.toFixed(2)}" ` +
      `height="${px.height.toFixed(2)}" fill="${hex}" fill-opacity="${panel.opacity}"/>`,
    );
  }

  // -- Text, in two passes ---------------------------------------------------
  //
  // Pass 1 lays every block out and asks whether it can be read where it lands.
  // Pass 2 draws. They are separate because the SCRIM has to be decided for the
  // composition as a whole, not per block.
  //
  // The first version drew a rectangle behind each block that individually
  // failed. Rendered, it was obviously a box stamped on a photo — and worse, it
  // treated neighbouring lines differently, so a headline sat in a dark panel
  // while the subhead directly beneath it did not. Both read as machine-made,
  // which is precisely what this module exists to avoid.
  //
  // A designer solves this with a gradient wash anchored to the edge the text
  // sits against — the broadcast lower-third. One band, soft falloff, covering
  // all the text over the image, so there is no visible boundary anywhere.

  interface PreparedSlot {
    spec: SlotSpec;
    laid: LaidOutText;
    boxPx: { x: number; y: number; width: number; height: number };
    sampleBox: { x: number; y: number; width: number; height: number };
    groundHex: string;
    onPanel: boolean;
    needsScrim: boolean;
    fontFamily: string;
  }

  const prepared: PreparedSlot[] = [];
  let requestedSlots = 0;

  for (const spec of template.slots) {
    const content = String(text[spec.slot] ?? "").trim();
    if (!content) continue;
    requestedSlots += 1;

    const metrics = spec.role === "display" ? displayMetrics : bodyMetrics;
    const fontFamily = spec.role === "display" ? displayFont.family : bodyFont.family;
    const boxPx = boxToPx(spec.box, width, height);
    const rendered = spec.transform === "upper" ? content.toUpperCase() : content;

    const laid = layOutText(rendered, metrics, spec, boxPx, shorterEdge);
    renderedText.push({
      slot: spec.slot,
      requested: content,
      drawn: laid.lines.join(" "),
      truncated: laid.truncated,
    });
    if (laid.lines.length === 0) continue;
    if (laid.truncated) notes.push(`"${spec.slot}" was too long for its box and was trimmed.`);
    if (!metrics.isReliable(rendered)) {
      notes.push(`"${spec.slot}" uses a script whose width cannot be measured exactly; extra margin was left.`);
    }

    // Text sitting on an opaque brand panel has a known flat ground; sampling
    // the photo underneath it would answer a question nobody asked.
    const panelBehind = template.panels.find((panel) => {
      const p = boxToPx(panel.box, width, height);
      return (
        boxPx.x >= p.x - 1 && boxPx.y >= p.y - 1 &&
        boxPx.x + boxPx.width <= p.x + p.width + 1 &&
        boxPx.y + boxPx.height <= p.y + p.height + 1 &&
        panel.opacity >= 0.9
      );
    });

    const textBlockHeight = laid.lines.length * laid.lineHeight;
    const sampleBox = {
      x: boxPx.x,
      y: spec.valign === "bottom"
        ? boxPx.y + boxPx.height - textBlockHeight
        : spec.valign === "middle"
          ? boxPx.y + (boxPx.height - textBlockHeight) / 2
          : boxPx.y,
      width: boxPx.width,
      height: textBlockHeight,
    };

    let groundHex: string;
    let needsScrim = false;
    if (panelBehind) {
      groundHex = roleHex(design, panelBehind.colorRole, backgroundHex);
    } else {
      const sampled = sampleRegion(bitmap, width, height, sampleBox);
      groundHex = sampled.meanHex;
      const fillCandidate = roleHex(design, spec.colorRole, "#ffffff");
      const ratio = contrastRatio(fillCandidate, groundHex) || 0;
      // Variance matters as much as the mean: text over an evenly dark area is
      // fine, and over the same average split between bright sky and dark rock
      // is not. Only the second needs help.
      needsScrim = ratio < MIN_TEXT_CONTRAST || sampled.variance > 0.02;
    }

    prepared.push({
      spec, laid, boxPx, sampleBox, groundHex,
      onPanel: Boolean(panelBehind), needsScrim, fontFamily,
    });
  }

  // -- Scrim bands, one per cluster of text -----------------------------------
  //
  // A single band over the union of every text block is wrong whenever a layout
  // has text at the top AND a legal line at the bottom: the union spans the
  // whole canvas, and the "scrim" becomes a 74% wash over the entire image.
  // That happened on the top-banner layout the first time this ran.
  //
  // Text near the top and text near the bottom are two separate regions, and a
  // designer treats them as two. Blocks are grouped by vertical proximity, and
  // each group gets its own band anchored to whichever edge it sits against.
  const overImage = prepared.filter((entry) => !entry.onPanel);

  interface ScrimBand {
    members: Set<TextSlot>;
    opacityAt: (y: number) => number;
  }
  const bands: ScrimBand[] = [];

  if (overImage.length > 0) {
    const ordered = [...overImage].sort((a, b) => a.sampleBox.y - b.sampleBox.y);
    // A gap wider than this means the blocks are not part of the same visual
    // group and must not share a wash.
    const clusterGap = height * 0.12;

    const clusters: PreparedSlot[][] = [];
    let current: PreparedSlot[] = [];
    let currentBottom = -Infinity;

    for (const entry of ordered) {
      if (current.length > 0 && entry.sampleBox.y - currentBottom > clusterGap) {
        clusters.push(current);
        current = [];
      }
      current.push(entry);
      currentBottom = Math.max(currentBottom, entry.sampleBox.y + entry.sampleBox.height);
    }
    if (current.length > 0) clusters.push(current);

    const PLATEAU = 0.74;
    const WASH = 0.62;

    for (const cluster of clusters) {
      if (!cluster.some((entry) => entry.needsScrim)) continue;

      const top = Math.min(...cluster.map((entry) => entry.sampleBox.y));
      const bottom = Math.max(...cluster.map((entry) => entry.sampleBox.y + entry.sampleBox.height));
      const pad = shorterEdge * 0.05;
      const members = new Set(cluster.map((entry) => entry.spec.slot));

      const distanceToTop = top;
      const distanceToBottom = height - bottom;
      const spansMiddle = distanceToTop > height * 0.22 && distanceToBottom > height * 0.22;

      if (spansMiddle) {
        // Centred text (a quote card) gets an even full-frame wash. A band with
        // two soft edges floating in the middle of a photo looks like a mistake.
        parts.push(
          `<rect x="0" y="0" width="${width}" height="${height}" ` +
          `fill="${backgroundHex}" fill-opacity="${WASH}"/>`,
        );
        bands.push({ members, opacityAt: () => WASH });
        for (const entry of cluster) scrimmedSlots.push(entry.spec.slot);
        continue;
      }

      const anchorBottom = distanceToBottom <= distanceToTop;
      const bandStart = anchorBottom ? Math.max(0, top - pad) : 0;
      const bandEnd = anchorBottom ? height : Math.min(height, bottom + pad);
      const bandHeight = Math.max(1, bandEnd - bandStart);
      const fadeSpan = Math.max(0.15, Math.min(0.5, (pad * 2.4) / bandHeight));

      const stops = anchorBottom
        ? [
            { offset: 0, opacity: 0 },
            { offset: fadeSpan, opacity: PLATEAU },
            { offset: 1, opacity: PLATEAU },
          ]
        : [
            { offset: 0, opacity: PLATEAU },
            { offset: 1 - fadeSpan, opacity: PLATEAU },
            { offset: 1, opacity: 0 },
          ];

      // Gradient ids must be unique within one SVG document.
      const gradientId = `brandScrim${bands.length}`;
      parts.push(
        `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">` +
        stops
          .map((stop) =>
            `<stop offset="${stop.offset.toFixed(4)}" stop-color="${backgroundHex}" ` +
            `stop-opacity="${stop.opacity.toFixed(3)}"/>`)
          .join("") +
        `</linearGradient></defs>` +
        `<rect x="0" y="${bandStart.toFixed(2)}" width="${width}" ` +
        `height="${bandHeight.toFixed(2)}" fill="url(#${gradientId})"/>`,
      );

      bands.push({
        members,
        opacityAt: (y: number) => {
          const t = Math.max(0, Math.min(1, (y - bandStart) / bandHeight));
          for (let i = 1; i < stops.length; i += 1) {
            const previous = stops[i - 1];
            const currentStop = stops[i];
            if (t <= currentStop.offset) {
              const span = currentStop.offset - previous.offset || 1;
              const local = (t - previous.offset) / span;
              return previous.opacity + (currentStop.opacity - previous.opacity) * local;
            }
          }
          return stops[stops.length - 1].opacity;
        },
      });
      for (const entry of cluster) scrimmedSlots.push(entry.spec.slot);
    }
  }

  // -- Draw ------------------------------------------------------------------
  for (const entry of prepared) {
    const { spec, laid, boxPx, sampleBox } = entry;

    let groundHex = entry.groundHex;
    const band = entry.onPanel
      ? undefined
      : bands.find((candidate) => candidate.members.has(spec.slot));
    if (band) {
      // Recheck against what the text will ACTUALLY sit on. The weakest point
      // across the block is the one that decides legibility, so take the
      // minimum scrim opacity over its extent rather than the average.
      const opacity = Math.min(
        band.opacityAt(sampleBox.y),
        band.opacityAt(sampleBox.y + sampleBox.height),
      );
      groundHex = blend(groundHex, backgroundHex, opacity);
    }

    let fill = roleHex(design, spec.colorRole, "#ffffff");
    let ratio = contrastRatio(fill, groundHex) || 0;

    // Last resort. A legible off-brand colour beats an unreadable on-brand one,
    // and the substitution is recorded rather than quietly made.
    if (ratio < MIN_TEXT_CONTRAST) {
      const lightRatio = contrastRatio("#ffffff", groundHex) || 0;
      const darkRatio = contrastRatio("#111111", groundHex) || 0;
      const bestRatio = Math.max(lightRatio, darkRatio);
      if (bestRatio > ratio) {
        notes.push(
          `"${spec.slot}" was recoloured for legibility — the ${spec.colorRole} role only ` +
          `reached ${ratio.toFixed(1)}:1 where it sits.`,
        );
        fill = lightRatio >= darkRatio ? "#ffffff" : "#111111";
        ratio = bestRatio;
        recoloredSlots.push(spec.slot);
      }
    }

    contrastReport.push({ slot: spec.slot, fill, ground: groundHex, ratio });

    const firstBaseline = sampleBox.y + laid.fontSize * 0.82;
    const anchor = spec.align === "center" ? "middle" : spec.align === "right" ? "end" : "start";
    const anchorX = spec.align === "center"
      ? boxPx.x + boxPx.width / 2
      : spec.align === "right"
        ? boxPx.x + boxPx.width
        : boxPx.x;

    const letterSpacing = spec.tracking
      ? ` letter-spacing="${(spec.tracking * laid.fontSize).toFixed(2)}"`
      : "";
    const weight = spec.role === "display" ? (displaySpec.weight ?? 700) : (bodySpec.weight ?? 400);

    laid.lines.forEach((line, index) => {
      parts.push(
        `<text x="${anchorX.toFixed(2)}" y="${(firstBaseline + index * laid.lineHeight).toFixed(2)}" ` +
        `font-family="${escapeXml(entry.fontFamily)}" font-size="${laid.fontSize.toFixed(2)}" ` +
        `font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${letterSpacing}>` +
        `${escapeXml(line)}</text>`,
      );
    });
  }

  // ── Rasterise ─────────────────────────────────────────────────────────────
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;

  const overlay = await rasterizeSvgWithFonts(svg, width, height, fontBuffers, displayFont.family);
  const overlayImage = await Image.decode(overlay);

  const ink = countInk(overlayImage.bitmap as unknown as Uint8ClampedArray);

  // The spike's failure mode, caught. Text was asked for and nothing was drawn:
  // deliver an error, never a confidently blank graphic.
  if (requestedSlots > 0 && ink === 0) {
    throw new CompositorUnavailableError(
      "the text layer rasterised to zero pixels — the font was not applied",
    );
  }

  base.composite(overlayImage, 0, 0);

  // ── Logo, with real clear space ───────────────────────────────────────────
  let logoApplied = false;
  if (options.logo?.bytes) {
    try {
      const logoImage = await Image.decode(
        await rasterizeIfSvg(options.logo.bytes, options.logo.mimeType),
      );
      const minWidth = Number(design.logo_rules?.min_width_px ?? 96);
      const targetW = Math.max(minWidth, Math.round(width * 0.14));
      const targetH = Math.max(1, Math.round((logoImage.height / logoImage.width) * targetW));
      const resized = logoImage.resize(targetW, targetH);

      // Clear space is expressed as a multiple of the MARK's height, which is
      // how brand books state it — not as a page margin.
      const clearSpace = Math.round(targetH * Number(design.logo_rules?.clear_space_ratio ?? 0.5));
      const marginPct = Number(design.layout_rules?.safe_margin_pct ?? 6) / 100;
      const margin = Math.round(shorterEdge * marginPct);
      const inset = margin + clearSpace;

      const corner = template.logoCorner;
      const x = corner.includes("left") ? inset : width - targetW - inset;
      const y = corner.includes("top") ? inset : height - targetH - inset;
      base.composite(resized, Math.max(0, x), Math.max(0, y));
      logoApplied = true;
    } catch (error) {
      notes.push(`Logo could not be placed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    bytes: await base.encodeJPEG(JPEG_QUALITY),
    templateId: template.id,
    fontsUsed: { display: displayFont.family, body: bodyFont.family },
    notes,
    scrimmedSlots,
    recoloredSlots,
    logoApplied,
    inkPixels: ink,
    contrastReport,
    renderedText,
  };
}

// ── resvg plumbing ───────────────────────────────────────────────────────────

let wasmReady: Promise<unknown> | null = null;

async function rasterizeSvgWithFonts(
  svg: string,
  width: number,
  height: number,
  fontBuffers: Uint8Array[],
  defaultFontFamily: string,
): Promise<Uint8Array> {
  const { initWasm, Resvg } = await import("https://esm.sh/@resvg/resvg-wasm@2.6.2");
  if (!wasmReady) {
    wasmReady = initWasm(fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm"))
      .catch((error: unknown) => {
        wasmReady = null; // let a later render retry rather than caching the failure
        throw error;
      });
  }
  await wasmReady;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "rgba(0,0,0,0)",
    font: {
      // loadSystemFonts stays OFF deliberately. Whatever faces happen to exist
      // on an edge host are not the brand's, and letting them substitute makes
      // output depend on which machine served the request.
      loadSystemFonts: false,
      fontBuffers,
      defaultFontFamily,
    },
  });
  void height;
  return resvg.render().asPng();
}

function countInk(bitmap: Uint8ClampedArray): number {
  let ink = 0;
  for (let i = 3; i < bitmap.length; i += 4) {
    if (bitmap[i] > 8) ink += 1;
  }
  return ink;
}

/** Flatten `overlay` at `opacity` over `beneath`, so contrast can be re-measured
 *  against what the text will actually sit on rather than what it sat on before
 *  the scrim was added. */
function blend(beneath: string, overlay: string, opacity: number): string {
  const b = hexToRgbTriple(beneath);
  const o = hexToRgbTriple(overlay);
  if (!b || !o) return beneath;
  return toHex(
    o[0] * opacity + b[0] * (1 - opacity),
    o[1] * opacity + b[1] * (1 - opacity),
    o[2] * opacity + b[2] * (1 - opacity),
  );
}

function hexToRgbTriple(hex: string): [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const n = parseInt(normalized.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
