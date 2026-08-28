/**
 * The product mark, as geometry — three isometric slabs, ember on top.
 *
 * ── Why the shape lives here and not in the component ───────────────────────
 * Two things draw this mark: the React component beside this file, and the
 * script that writes public/favicon.svg and the manifest PNGs. If each owned
 * its own copy of the geometry, the tab icon and the header would drift the
 * first time either was touched — which is the same defect, in miniature, as
 * nine pages owning nine copies of the nav. One module, both consumers.
 *
 * ── Replacing it with the original artwork ──────────────────────────────────
 * This is a reconstruction from the reference images, not the source file. If
 * the original vector turns up, replace `studioMarkSvgDocument` with it and
 * re-run `npm run brand:icons`; every surface follows, because nothing else
 * hard-codes the mark.
 */

/** Isometric geometry on a 1024 grid: a slab is a 2:1 rhombus plus two side
 *  faces, and the stack is that shape at three vertical offsets. */
const RHOMBUS_HALF_WIDTH = 326;
const RHOMBUS_HALF_HEIGHT = 163;
const THICKNESS = 92;
const APEX_SPACING = 176;
const FIRST_APEX = 128;
const CENTRE_X = 512;

export function slabPaths(index) {
  const apexY = FIRST_APEX + index * APEX_SPACING;
  const left = CENTRE_X - RHOMBUS_HALF_WIDTH;
  const right = CENTRE_X + RHOMBUS_HALF_WIDTH;
  const midY = apexY + RHOMBUS_HALF_HEIGHT;
  const lowY = apexY + RHOMBUS_HALF_HEIGHT * 2;

  return {
    top: `M${CENTRE_X} ${apexY} L${right} ${midY} L${CENTRE_X} ${lowY} L${left} ${midY} Z`,
    leftFace: `M${left} ${midY} L${CENTRE_X} ${lowY} L${CENTRE_X} ${lowY + THICKNESS} L${left} ${midY + THICKNESS} Z`,
    rightFace: `M${CENTRE_X} ${lowY} L${right} ${midY} L${right} ${midY + THICKNESS} L${CENTRE_X} ${lowY + THICKNESS} Z`,
  };
}

/** Each slab is a colour plus two shades of it, for the two visible sides. */
const EMBER = { top: "#FF5C38", left: "#D1492A", right: "#A2371D" };
const PALE = { top: "#F5F5F4", left: "#CFCFCB", right: "#9E9E9A" };
const SLATE = { top: "#8B8D93", left: "#5D5F65", right: "#3C4046" };
const INK = { top: "#1C1D21", left: "#121316", right: "#08090B" };
const MIST = { top: "#B7BAC0", left: "#93969C", right: "#6B6E74" };

/**
 * The two pairings, bottom slab first.
 *
 * They exist because a pale middle slab vanishes on paper and a black one
 * vanishes on near-black — the reason the reference artwork came in two
 * versions at all. The ember never moves.
 */
export const MARK_PALETTES = {
  dark: [SLATE, PALE, EMBER],
  light: [MIST, INK, EMBER],
};

/** The mark as a standalone SVG document, for the favicon and manifest icons. */
export function studioMarkSvgDocument(tone = "dark") {
  const slabs = MARK_PALETTES[tone] ?? MARK_PALETTES.dark;
  const body = slabs
    .map((colour, index) => {
      const paths = slabPaths(2 - index);
      return (
        `  <path d="${paths.leftFace}" fill="${colour.left}"/>\n`
        + `  <path d="${paths.rightFace}" fill="${colour.right}"/>\n`
        + `  <path d="${paths.top}" fill="${colour.top}"/>`
      );
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n${body}\n</svg>\n`;
}
