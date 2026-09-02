/**
 * designCopy.js — decide what words go ON a generated graphic.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The whole typography layer — real font bytes, exact brand hex, wrapping,
 * shrink-to-fit, contrast enforcement — was built, wired inside the
 * `generateImage` edge function, and covered by two passing guards. And it never
 * ran once, because `generateImage` only takes the compositor path when the
 * caller sends `compose.text` (index.ts:299-302) and NOTHING in the client ever
 * sent it.
 *
 * That is this repo's signature defect, one more time: working code nobody could
 * reach. This module is the missing connection.
 *
 * ── Why a module and not three inline objects ───────────────────────────────
 * Three call sites would each invent their own idea of which copy belongs on a
 * design, and they would drift. One function, one answer, and
 * `scripts/check-compose-wiring.cjs` can assert both the shape and the chain.
 *
 * ── What is deliberately NOT decided here ───────────────────────────────────
 * The legal line and the contact block. Those come from the brand kit and are
 * injected SERVER-side in generateImage, because a required mark that a client
 * can forget to send is not a required mark. This module only handles the copy
 * the user actually wrote for this post.
 */

/** Slots the compositor understands. Mirrors TextSlot in designTemplates.ts. */
export const TEXT_SLOTS = ['headline', 'subhead', 'cta', 'legal', 'contact'];

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Build the `compose.text` payload for one rendered image.
 *
 * Returns `null` when there is no headline. That is the important case: with no
 * compose payload the edge function takes its original path and behaviour is
 * completely unchanged, so switching this on cannot alter a photorealistic
 * render that was never going to carry words.
 *
 * @param {object} slide  a visual_prompt slide — { headline, subhead, slide_purpose }
 * @param {object} plan   the content plan, for its caption CTA
 * @returns {{headline: string, subhead?: string, cta?: string} | null}
 */
export function buildComposeText(slide, plan) {
  const headline = clean(slide?.headline);
  // No headline means no design copy. Deliberately not falling back to the
  // caption or the prompt: a paragraph of caption text set as a headline looks
  // far worse than no text at all, and the user did not ask for it.
  if (!headline) return null;

  const text = { headline };

  const subhead = clean(slide?.subhead ?? slide?.subheadline);
  if (subhead) text.subhead = subhead;

  // A call to action belongs on the slide that IS the call to action. Repeating
  // it on every slide of a carousel is noise, and on a single image the CTA
  // usually lives in the caption where it is tappable.
  const purpose = clean(slide?.slide_purpose).toLowerCase();
  if (purpose === 'cta') {
    const cta = clean(plan?.caption?.cta);
    if (cta) text.cta = cta;
  }

  return text;
}

/**
 * The compose payload for `generateImages({ compose })`, or null.
 *
 * `recentTemplateIds` lets the edge function pick a layout it did not just use,
 * so a carousel does not render five identical compositions and a feed does not
 * look stamped from one mould.
 */
export function buildComposePayload(slide, plan, recentTemplateIds = []) {
  const text = buildComposeText(slide, plan);
  if (!text) return null;

  return {
    text,
    recent_template_ids: Array.isArray(recentTemplateIds)
      ? recentTemplateIds.filter(Boolean).slice(-4)
      : [],
  };
}

export default buildComposePayload;
