import { MARK_PALETTES, slabPaths } from "./studioMark.mjs";

/**
 * The product mark, as a component.
 *
 * The geometry lives in studioMark.mjs so this and the favicon generator draw
 * the same thing; see that file for why, and for how to swap in the original
 * artwork if it turns up.
 *
 * `tone` picks the pairing rather than the surface guessing: "dark" for the
 * near-black app chrome, "light" for the paper-coloured public pages. It is not
 * read from the theme automatically because the landing page and the auth pages
 * are deliberately light regardless of what the app theme is set to.
 */
export function StudioMark({ size = 22, tone = "dark", title = "Studio", decorative = false, className = "" }) {
  const slabs = MARK_PALETTES[tone] ?? MARK_PALETTES.dark;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={className}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : title}
      focusable="false"
    >
      {/* Bottom slab painted first, so each overlaps the one beneath it the way
          a real stack does. */}
      {slabs.map((colour, index) => {
        const paths = slabPaths(2 - index);
        return (
          <g key={index}>
            <path d={paths.leftFace} fill={colour.left} />
            <path d={paths.rightFace} fill={colour.right} />
            <path d={paths.top} fill={colour.top} />
          </g>
        );
      })}
    </svg>
  );
}
