/**
 * designTemplates.ts — the layouts the compositor draws into.
 *
 * ── What a template is for ──────────────────────────────────────────────────
 * Two jobs, and the second is the one that matters most:
 *
 *  1. It says where the text goes, in fractions of the canvas, so the layout is
 *     computed rather than felt.
 *  2. It declares which region of the image must stay VISUALLY CALM — and that
 *     declaration is what generates the background prompt's composition
 *     instruction. The model is told to leave the lower third quiet because the
 *     lower third is where the headline will land. Without that link the two
 *     halves are designed independently and the text lands on a face.
 *
 * ── The anti-slop reasoning ─────────────────────────────────────────────────
 * A centred subject with centred text is the statistical mean of every image
 * model's training set, which is why so much generated work reads as generic.
 * These templates deliberately place text off-centre, on thirds, with
 * asymmetric gutters — composition becomes a decision on the record instead of
 * whatever the model defaulted to.
 *
 * The other half is variety over time. `pickTemplate` takes the ids a brand has
 * recently used and refuses to repeat them, because the strongest "this is
 * automated" signal is not one bad post — it is twelve posts with identical
 * geometry.
 *
 * All geometry is 0–1 fractions of the canvas, so one definition works for
 * 1:1, 4:5, 9:16 and 16:9 without a second table to keep in sync.
 */

export type TextSlot = "headline" | "subhead" | "cta" | "legal" | "contact";

export interface Box {
  /** All 0–1, fractions of canvas width/height. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlotSpec {
  slot: TextSlot;
  box: Box;
  align: "left" | "center" | "right";
  /** Vertical anchor within the box. */
  valign: "top" | "middle" | "bottom";
  /** Font role to use. */
  role: "display" | "body";
  /** Colour role to prefer; the compositor overrides it if contrast fails. */
  colorRole: "text_primary" | "text_secondary" | "cta_text" | "accent";
  /** Size as a fraction of the canvas's SHORTER edge, before shrink-to-fit. */
  sizeFraction: number;
  minSizeFraction: number;
  maxLines: number;
  /** Uppercase / letterspacing treatment. */
  transform?: "none" | "upper";
  tracking?: number;
}

export interface PanelSpec {
  /** A solid or gradient block drawn UNDER the text, in a brand colour. */
  box: Box;
  colorRole: "background" | "surface" | "accent" | "cta_bg";
  opacity: number;
}

export interface DesignTemplate {
  id: string;
  name: string;
  /** Human description, shown in the UI when a user picks a layout. */
  description: string;
  /**
   * Where the generated background must stay uncluttered, in words the image
   * model understands. Injected into the background prompt.
   */
  calmRegion: string;
  /** Composition direction that keeps the subject off dead centre. */
  composition: string;
  slots: SlotSpec[];
  panels: PanelSpec[];
  /** Corner the logo prefers on this layout, overriding the brand default when
   *  the brand's preferred corner collides with a text block. */
  logoCorner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Aspect ratios this layout is designed for. Empty means all. */
  suitedTo: string[];
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: "lower-third",
    name: "Lower third",
    description: "Headline sits low and left over open space; the subject holds the upper two thirds.",
    calmRegion:
      "Leave the BOTTOM THIRD of the frame visually calm and uncluttered — open space, " +
      "shadow, or gentle out-of-focus area, with no important detail there.",
    composition:
      "Place the subject in the upper two thirds, offset to the right of centre. Avoid a " +
      "perfectly symmetrical, centred composition.",
    slots: [
      {
        slot: "headline",
        box: { x: 0.07, y: 0.60, width: 0.62, height: 0.20 },
        align: "left", valign: "bottom", role: "display", colorRole: "text_primary",
        sizeFraction: 0.095, minSizeFraction: 0.045, maxLines: 3,
      },
      {
        slot: "subhead",
        box: { x: 0.07, y: 0.815, width: 0.55, height: 0.07 },
        align: "left", valign: "top", role: "body", colorRole: "text_secondary",
        sizeFraction: 0.036, minSizeFraction: 0.024, maxLines: 2,
      },
      {
        slot: "legal",
        box: { x: 0.07, y: 0.945, width: 0.60, height: 0.035 },
        align: "left", valign: "bottom", role: "body", colorRole: "text_secondary",
        sizeFraction: 0.018, minSizeFraction: 0.014, maxLines: 1,
      },
    ],
    panels: [],
    logoCorner: "top-left",
    suitedTo: [],
  },
  {
    id: "left-panel",
    name: "Left panel",
    description: "A brand-colour panel carries the text; the image runs full-bleed behind it.",
    calmRegion:
      "Keep the LEFT HALF of the frame simple and low-detail; the visual interest belongs " +
      "on the right side.",
    composition:
      "Compose the subject on the right third of the frame, looking or leading toward the left.",
    slots: [
      {
        slot: "headline",
        box: { x: 0.07, y: 0.30, width: 0.34, height: 0.26 },
        align: "left", valign: "bottom", role: "display", colorRole: "text_primary",
        sizeFraction: 0.075, minSizeFraction: 0.038, maxLines: 4,
      },
      {
        slot: "subhead",
        box: { x: 0.07, y: 0.58, width: 0.32, height: 0.12 },
        align: "left", valign: "top", role: "body", colorRole: "text_secondary",
        sizeFraction: 0.030, minSizeFraction: 0.022, maxLines: 3,
      },
      {
        slot: "cta",
        box: { x: 0.07, y: 0.735, width: 0.26, height: 0.055 },
        align: "center", valign: "middle", role: "body", colorRole: "cta_text",
        sizeFraction: 0.026, minSizeFraction: 0.020, maxLines: 1, transform: "upper", tracking: 0.06,
      },
    ],
    panels: [
      { box: { x: 0, y: 0, width: 0.47, height: 1 }, colorRole: "background", opacity: 0.94 },
      { box: { x: 0.07, y: 0.735, width: 0.26, height: 0.055 }, colorRole: "cta_bg", opacity: 1 },
    ],
    logoCorner: "top-left",
    suitedTo: [],
  },
  {
    id: "full-bleed-quote",
    name: "Full-bleed quote",
    description: "One large line over a darkened image. For statements, not offers.",
    calmRegion:
      "Keep the CENTRE of the frame free of small detail and busy texture — a broad, even " +
      "field works best.",
    composition:
      "A wide, atmospheric composition with depth. No single dominant object dead centre.",
    slots: [
      {
        slot: "headline",
        box: { x: 0.12, y: 0.30, width: 0.76, height: 0.34 },
        align: "center", valign: "middle", role: "display", colorRole: "text_primary",
        sizeFraction: 0.085, minSizeFraction: 0.040, maxLines: 4,
      },
      {
        slot: "contact",
        box: { x: 0.12, y: 0.88, width: 0.76, height: 0.05 },
        align: "center", valign: "middle", role: "body", colorRole: "text_secondary",
        sizeFraction: 0.024, minSizeFraction: 0.018, maxLines: 1,
      },
    ],
    panels: [],
    logoCorner: "top-right",
    suitedTo: [],
  },
  {
    id: "top-banner",
    name: "Top banner",
    description: "Announcement across the top, image below. Reads first in a crowded feed.",
    calmRegion:
      "Leave the TOP THIRD of the frame open and uncluttered — sky, wall, or plain surface.",
    composition:
      "Anchor the subject in the lower half, slightly left of centre.",
    slots: [
      {
        slot: "headline",
        box: { x: 0.08, y: 0.09, width: 0.70, height: 0.18 },
        align: "left", valign: "top", role: "display", colorRole: "text_primary",
        sizeFraction: 0.085, minSizeFraction: 0.040, maxLines: 3,
      },
      {
        slot: "subhead",
        box: { x: 0.08, y: 0.285, width: 0.60, height: 0.06 },
        align: "left", valign: "top", role: "body", colorRole: "text_secondary",
        sizeFraction: 0.032, minSizeFraction: 0.022, maxLines: 2,
      },
      {
        slot: "legal",
        box: { x: 0.08, y: 0.95, width: 0.60, height: 0.03 },
        align: "left", valign: "bottom", role: "body", colorRole: "text_secondary",
        sizeFraction: 0.017, minSizeFraction: 0.014, maxLines: 1,
      },
    ],
    panels: [],
    logoCorner: "bottom-right",
    suitedTo: [],
  },
  {
    id: "split-card",
    name: "Split card",
    description: "Image on top, a solid brand block beneath carrying the message.",
    calmRegion:
      "The image occupies only the UPPER HALF of the frame — compose for that crop, and " +
      "keep the very bottom edge free of important detail.",
    composition:
      "A tight, well-lit subject filling the upper half. Rule of thirds, not centred.",
    slots: [
      {
        slot: "headline",
        box: { x: 0.08, y: 0.60, width: 0.70, height: 0.16 },
        align: "left", valign: "top", role: "display", colorRole: "text_primary",
        sizeFraction: 0.070, minSizeFraction: 0.036, maxLines: 3,
      },
      {
        slot: "subhead",
        box: { x: 0.08, y: 0.775, width: 0.62, height: 0.08 },
        align: "left", valign: "top", role: "body", colorRole: "text_secondary",
        sizeFraction: 0.028, minSizeFraction: 0.020, maxLines: 2,
      },
      {
        slot: "contact",
        box: { x: 0.08, y: 0.90, width: 0.62, height: 0.045 },
        align: "left", valign: "bottom", role: "body", colorRole: "accent",
        sizeFraction: 0.024, minSizeFraction: 0.018, maxLines: 1,
      },
    ],
    panels: [
      { box: { x: 0, y: 0.55, width: 1, height: 0.45 }, colorRole: "background", opacity: 1 },
    ],
    logoCorner: "top-right",
    suitedTo: [],
  },
  {
    id: "corner-badge",
    name: "Corner badge",
    description: "Minimal. A small block of text in one corner, the image left to speak.",
    calmRegion:
      "Leave the BOTTOM-LEFT QUADRANT calm and low-contrast; keep the subject clear of it.",
    composition:
      "Strong single subject in the upper right, generous negative space toward the lower left.",
    slots: [
      {
        slot: "headline",
        box: { x: 0.07, y: 0.72, width: 0.44, height: 0.13 },
        align: "left", valign: "bottom", role: "display", colorRole: "text_primary",
        sizeFraction: 0.055, minSizeFraction: 0.030, maxLines: 2,
      },
      {
        slot: "contact",
        box: { x: 0.07, y: 0.865, width: 0.44, height: 0.04 },
        align: "left", valign: "top", role: "body", colorRole: "text_secondary",
        sizeFraction: 0.022, minSizeFraction: 0.017, maxLines: 1,
      },
    ],
    panels: [],
    logoCorner: "top-right",
    suitedTo: [],
  },
];

export function templateById(id: string): DesignTemplate | null {
  return DESIGN_TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * Choose a layout, avoiding the ones this brand used most recently.
 *
 * Sameness is a slop tell in its own right: twelve posts with identical
 * geometry read as automated even when each one is individually fine. Recency
 * is tracked rather than randomised so the rotation is explainable and
 * reproducible from a generation's metadata.
 */
export function pickTemplate(
  recentTemplateIds: string[] = [],
  preferredId?: string,
): DesignTemplate {
  if (preferredId) {
    const chosen = templateById(preferredId);
    if (chosen) return chosen;
  }

  const recent = new Set(recentTemplateIds.slice(0, DESIGN_TEMPLATES.length - 1));
  const unused = DESIGN_TEMPLATES.filter((template) => !recent.has(template.id));
  const pool = unused.length > 0 ? unused : DESIGN_TEMPLATES;

  // Deterministic within a pool: the least recently used wins, so two renders
  // from the same state make the same choice and a receipt can be trusted.
  const lastUsedIndex = (template: DesignTemplate) => {
    const index = recentTemplateIds.indexOf(template.id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...pool].sort((a, b) => lastUsedIndex(b) - lastUsedIndex(a))[0];
}

/**
 * The composition instruction for the background model.
 *
 * The no-text rule is stated three ways on purpose. Image models treat a single
 * negative instruction as a weak preference, and a stray watermark or a
 * half-formed word in the background defeats the entire reason this pipeline
 * exists.
 */
export function backgroundDirectiveFor(template: DesignTemplate): string {
  return [
    template.composition,
    template.calmRegion,
    "Render NO text, NO letters, NO numbers, NO words, NO captions, NO watermarks, " +
      "NO logos and NO signage anywhere in the image. The image must be completely " +
      "free of writing of any kind.",
  ].join(" ");
}
