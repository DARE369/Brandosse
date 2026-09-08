/**
 * brandDesignClient.js — normalise the design layer before the BROWSER writes it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `supabase/functions/_shared/brandDesign.ts` is the single writer for the
 * design columns on the server. The Brand Kit's Design tab is the other place
 * these columns are written, and it cannot use that module: it is a Deno edge
 * module with `.ts` import specifiers, and the review form saves straight to
 * Supabase from the browser with no server hop in between.
 *
 * So without this file, a user typing `#gg` into a colour role writes `#gg` to
 * the database. The jsonb CHECK constraints only assert the column holds an
 * object — `{"background": {"hex": "banana"}}` satisfies every one of them, and
 * the compositor then has to decide at render time what a banana looks like.
 *
 * This is deliberately NOT a full port of the edge normaliser. It covers the
 * cases a text input can actually produce — a malformed hex, a number outside
 * its range, a handle missing its @ — and `scripts/check-brand-provenance.cjs`
 * asserts its bounds match the edge module's, so the two cannot drift into
 * disagreeing about what is valid.
 */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Bounds, kept identical to _shared/brandDesign.ts. Asserted by the guard. */
export const DESIGN_BOUNDS = {
  safe_margin_pct: [0, 25],
  text_max_lines: [1, 12],
  grid: [2, 24],
  clear_space_ratio: [0, 2],
  min_width_px: [16, 2048],
  min_body_px: [12, 96],
  weight: [100, 900],
};

export function normalizeHex(value) {
  const raw = String(value ?? '').trim();
  if (!HEX_RE.test(raw)) return '';
  const body = raw.slice(1).toLowerCase();
  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
    : `#${body}`;
}

function clamp(value, key, fallback) {
  const [min, max] = DESIGN_BOUNDS[key];
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}

/**
 * Normalise every design field on a form-state object.
 *
 * Returns only the design columns, so a caller spreads it over their payload.
 * Values that cannot be made valid are DROPPED rather than corrected to a
 * guess — silently turning `#gg` into black would put a colour in the user's
 * brand that they never chose and cannot see they did not choose.
 */
export function normalizeDesignForSave(form = {}) {
  const roles = asObject(form.color_roles);
  const cleanRoles = {};
  for (const [role, value] of Object.entries(roles)) {
    const entry = asObject(value);
    const hex = normalizeHex(entry.hex);
    if (!hex) continue;
    cleanRoles[role] = {
      hex,
      name: String(entry.name ?? '').trim(),
      source: ['measured', 'inferred', 'user'].includes(entry.source) ? entry.source : 'user',
      contrast_vs_background: Number.isFinite(Number(entry.contrast_vs_background))
        ? Number(entry.contrast_vs_background)
        : 0,
    };
  }

  const typeScale = asObject(form.type_scale);
  const cleanType = {};
  for (const role of ['display', 'body']) {
    const entry = asObject(typeScale[role]);
    const family = String(entry.family ?? '').trim();
    // A weight with no family cannot set a line, so the role is dropped whole.
    if (!family) continue;
    cleanType[role] = {
      family,
      weight: clamp(entry.weight, 'weight', role === 'display' ? 700 : 400),
      tracking: Number.isFinite(Number(entry.tracking)) ? Number(entry.tracking) : 0,
      case: ['none', 'upper', 'title'].includes(entry.case) ? entry.case : 'none',
    };
  }
  cleanType.min_body_px = clamp(typeScale.min_body_px, 'min_body_px', 18);

  const layout = asObject(form.layout_rules);
  const logo = asObject(form.logo_rules);
  const contact = asObject(form.contact_block);
  const marks = asObject(form.required_marks);
  const imagery = asObject(form.imagery_rules);

  const handles = asObject(form.social_handles);
  const cleanHandles = {};
  for (const [platform, value] of Object.entries(handles)) {
    const entry = asObject(value);
    const raw = (typeof value === 'string' ? value : entry.handle) ?? '';
    const handle = String(raw).trim().replace(/^@+/, '');
    if (!handle) continue;
    cleanHandles[platform.toLowerCase()] = {
      handle: `@${handle}`,
      stamp_on_designs: Boolean(entry.stamp_on_designs),
    };
  }

  return {
    color_roles: cleanRoles,
    type_scale: cleanType,
    layout_rules: {
      safe_margin_pct: clamp(layout.safe_margin_pct, 'safe_margin_pct', 6),
      text_max_lines: clamp(layout.text_max_lines, 'text_max_lines', 4),
      alignment: ['left', 'center', 'right'].includes(layout.alignment) ? layout.alignment : 'left',
      grid: clamp(layout.grid, 'grid', 12),
    },
    logo_rules: {
      clear_space_ratio: clamp(logo.clear_space_ratio, 'clear_space_ratio', 0.5),
      min_width_px: clamp(logo.min_width_px, 'min_width_px', 96),
      preferred_corner: ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(logo.preferred_corner)
        ? logo.preferred_corner
        : 'bottom-right',
      never_on: asStringArray(logo.never_on),
    },
    contact_block: {
      website: String(contact.website ?? '').trim(),
      email: String(contact.email ?? '').trim(),
      phone: String(contact.phone ?? '').trim(),
      address: String(contact.address ?? '').trim(),
      show_on_designs: Boolean(contact.show_on_designs),
    },
    social_handles: cleanHandles,
    required_marks: {
      legal_line: String(marks.legal_line ?? '').trim(),
      required_on: asStringArray(marks.required_on),
      watermark: Boolean(marks.watermark),
    },
    imagery_rules: {
      subject_matter: asStringArray(imagery.subject_matter),
      mood: asStringArray(imagery.mood),
      never_show: asStringArray(imagery.never_show),
      people: ['real', 'illustrated', 'none', ''].includes(imagery.people) ? imagery.people : '',
    },
  };
}
