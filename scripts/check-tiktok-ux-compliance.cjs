#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-tiktok-ux-compliance.cjs — guard for TikTok Direct Post approval.
 *
 * ── Why a guard, and why a static one ───────────────────────────────────────
 * TikTok's Content Sharing Guidelines make specific UI elements a CONDITION of
 * Direct Post approval. The dangerous thing about them is that violating one
 * looks like an IMPROVEMENT:
 *
 *   "Pre-select Public, most people want that"        -> rejection
 *   "Comments on by default, better engagement"       -> rejection
 *   "Only show the music notice when it's relevant"   -> rejection
 *   "Tighten up that legal wording"                   -> rejection
 *
 * None of those would fail a test, a type-check, or a normal code review. They
 * would fail an audit, weeks later, with a generic rejection email — and the
 * cost is a full review cycle.
 *
 * A verbatim rejection for a comparable integration read: "Point 2)b. Privacy
 * Status. Users must manually select the privacy status from a dropdown and
 * there should be no default value."
 *
 * The checks are static because the properties are static: what matters is
 * what the DEFAULTS are and whether the declaration is unconditional. Both are
 * visible in the source, and neither needs a browser.
 *
 * Run: node scripts/check-tiktok-ux-compliance.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const PANEL = path.join(ROOT, 'src/components/Publishing/TikTokOptionsPanel.jsx');
const REL = 'src/components/Publishing/TikTokOptionsPanel.jsx';

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push({ name, detail });
}

if (!fs.existsSync(PANEL)) {
  console.error(`FAIL — ${REL} is missing. TikTok Direct Post cannot be submitted without it.`);
  process.exit(1);
}

const src = fs.readFileSync(PANEL, 'utf8');
// Strip comments so prose describing a rule is never mistaken for the rule.
//
// CRLF is normalised FIRST, and that is load-bearing rather than tidy. This repo
// is checked out on Windows with mixed line endings — this panel is LF today,
// but calendarService.js beside it is CRLF. Splitting on "\n" alone leaves a
// trailing "\r", and JavaScript's `.` does not match "\r", so `//.*$` never
// reaches end-of-line and strips NOTHING. The comments then survive into the
// text being searched, and every presence assertion below starts passing on the
// strength of its own documentation. Found 2026-09-15 while writing
// check-composer-field-contract.cjs, where exactly that happened.
const code = src
  .replace(/\r\n?/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n');

// ── 1. Privacy must have NO default value ───────────────────────────────────

check(
  'privacy level starts with no selection',
  /useState\(\s*NO_PRIVACY_SELECTED\s*\)/.test(code)
    || /const\s*\[\s*privacyLevel[\s\S]{0,60}useState\(\s*(''|"")\s*\)/.test(code),
  'privacyLevel must initialise empty. Pre-selecting any option is the single '
  + 'most-cited Direct Post rejection.',
);

check(
  'no privacy level is hardcoded as a default',
  !/useState\(\s*['"](PUBLIC_TO_EVERYONE|SELF_ONLY|MUTUAL_FOLLOW_FRIENDS|FOLLOWER_OF_CREATOR)['"]\s*\)/.test(code),
  'A privacy constant is being used as an initial state value.',
);

check(
  'the dropdown renders a disabled placeholder option',
  /<option[^>]*value=\{?\s*(NO_PRIVACY_SELECTED|''|"")\s*\}?[^>]*disabled/.test(code),
  'The select must open on a non-selectable placeholder.',
);

check(
  'privacy options come from creator_info, not a hardcoded list',
  /creator\.privacyLevelOptions\.map/.test(code),
  'Options must be rendered from privacy_level_options in the API response. A '
  + 'private account returns a different set.',
);

// ── 2. Interaction toggles must default OFF ─────────────────────────────────

for (const [state, label] of [
  ['allowComment', 'comment'],
  ['allowDuet', 'duet'],
  ['allowStitch', 'stitch'],
]) {
  const re = new RegExp(`const\\s*\\[\\s*${state}[\\s\\S]{0,60}useState\\(\\s*false\\s*\\)`);
  check(
    `${label} toggle defaults to off`,
    re.test(code),
    `${state} must initialise false. TikTok requires interaction settings unchecked by default.`,
  );
}

check(
  'commercial content disclosure defaults to off',
  /const\s*\[\s*isCommercial[\s\S]{0,60}useState\(\s*false\s*\)/.test(code),
  'isCommercial must initialise false.',
);

// ── 3. Declaration text, verbatim ───────────────────────────────────────────

const MUSIC = "By posting, you agree to TikTok's Music Usage Confirmation.";
const BRANDED = "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.";
const norm = (s) => s.replace(/\\'/g, "'").replace(/&apos;/g, "'").replace(/\s+/g, ' ');
const flat = norm(src);

check(
  'music declaration present verbatim',
  flat.includes(norm(MUSIC)),
  `Exact string required: "${MUSIC}"  — paraphrasing is a rejection.`,
);

check(
  'branded content declaration present verbatim',
  flat.includes(norm(BRANDED)),
  `Exact string required: "${BRANDED}"`,
);

check(
  'both TikTok legal links are present',
  /music-usage-confirmation/.test(code) && /bc-policy/.test(code),
  'The declaration must link the Music Usage Confirmation and Branded Content Policy.',
);

// ── 4. The declaration must be UNCONDITIONAL ────────────────────────────────
//
// This is the subtle one. Rendering it only when the disclosure toggle is on
// is a documented rejection cause, and it is exactly what a well-meaning dev
// would do to reduce clutter.

const declBlock = /className=\{styles\.declaration\}/.exec(code);
check(
  'the declaration element exists',
  Boolean(declBlock),
  'No element with styles.declaration was found.',
);

if (declBlock) {
  // Look back from the declaration for a conditional gate tied to the
  // commercial toggles. `brandedContent ? A : B` INSIDE it is fine — that
  // changes wording. `isCommercial && (...)` wrapping it is not.
  const before = code.slice(Math.max(0, declBlock.index - 400), declBlock.index);
  const gated = /\{\s*(isCommercial|yourBrand|brandedContent)\s*(&&|\?)[^}]*$/.test(before);
  check(
    'the declaration is rendered unconditionally',
    !gated,
    'The declaration appears to be gated behind a disclosure toggle. It must ALWAYS '
    + 'be visible; the toggle changes its wording only. "Music disclosure shown '
    + 'conditionally, not persistently" is a documented rejection reason.',
  );
}

// ── 5. Duration ceiling enforced in the UI ──────────────────────────────────

check(
  'max video duration is enforced before publish',
  /maxVideoPostDurationSec/.test(code) && /durationError/.test(code),
  'max_video_post_duration_sec from creator_info must block an over-length video '
  + 'at compose time, not fail later at the API.',
);

// ── 6. creator_info is fetched live, not cached ─────────────────────────────

check(
  'creator info is fetched when the panel opens',
  /creator-info/.test(code) && /useEffect\(\s*\(\)\s*=>\s*\{\s*void load\(\)/.test(code),
  'The guidelines require the LATEST creator info when the post page renders.',
);

check(
  'creator nickname is displayed',
  /creatorNickname/.test(code),
  'The creator nickname must be shown so the user knows which account receives the post.',
);

// ── 7. The design-preview seam must not reach production ────────────────────
//
// previewCreatorInfo bypasses the live creator_info fetch. That is fine for a
// dev preview page and fatal anywhere else: the live fetch exists because a
// creator can go private or disable Duet between sessions, and a stale option
// list offers a privacy level the account no longer permits.

const ALLOWED_PREVIEW_CALLERS = ['app/app/dev/'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const leaks = [];
for (const dir of ['src', 'app']) {
  for (const file of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel === REL) continue;                                   // the definition
    if (ALLOWED_PREVIEW_CALLERS.some((a) => rel.startsWith(a))) continue;
    const body = fs.readFileSync(file, 'utf8');
    if (/previewCreatorInfo\s*=/.test(body) || /previewCreatorInfo\s*=\{/.test(body)) {
      leaks.push(rel);
    }
  }
}

check(
  'the preview seam is confined to the dev preview page',
  leaks.length === 0,
  `previewCreatorInfo is passed from: ${leaks.join(', ')}. Only ${ALLOWED_PREVIEW_CALLERS.join(', ')} `
  + 'may use it — anywhere else defeats the mandatory live creator_info fetch.',
);

// ── 8. Requirements that were MET but UNGUARDED ─────────────────────────────
//
// Added 2026-09-22. Until now this check passed "17 requirements" while
// TIKTOK-APP-REVIEW-PLAN.md §2 lists ten rows, and five of those rows had no
// assertion at all. They were satisfied in the code, but only by luck of nobody
// having changed them — a green run said nothing about them. Each is a
// documented rejection cause, so each gets the same treatment as the rest.

check(
  'creator avatar is displayed',                                     // §2 row 1
  /src=\{\s*creator\??\.creatorAvatarUrl\s*\}/.test(code),
  'The creator avatar must be shown alongside the nickname. §2 row 1 asks for both.',
);

for (const [label, lockVar, apiFlag] of [
  ['Comment', 'commentLocked', 'commentDisabled'],
  ['Duet', 'duetLocked', 'duetDisabled'],
  ['Stitch', 'stitchLocked', 'stitchDisabled'],
]) {
  check(
    `${label} toggle is greyed out when the creator disabled it`,     // §2 row 3
    // String.raw, not a plain template literal: in a template literal `\s` is an
    // unknown escape and evaluates to plain `s`, which silently breaks the regex.
    new RegExp(String.raw`${lockVar}\s*=\s*Boolean\(\s*creator\??\.${apiFlag}\s*\)`).test(code)
      && new RegExp(String.raw`disabled=\{\s*${lockVar}\s*\}`).test(code),
    `${lockVar} must come from creator_info's ${apiFlag} and be bound to the toggle's disabled prop. `
    + 'Offering a setting the creator has switched off is a guideline breach.',
  );
}

check(
  'Duet and Stitch are omitted for photo posts',                     // §2 row 3
  /\{\s*!isPhoto\s*\?/.test(code) && /allowDuet/.test(code) && /allowStitch/.test(code),
  'Duet and Stitch do not exist for photo posts and must not be rendered for them.',
);

check(
  'processing notice is shown',                                      // §2 row 10
  /can take a few minutes to process/.test(code),
  'The panel must tell the user TikTok can take a few minutes to process the post.',
);

// §2 row 7 (content preview) and the reachability of this whole panel are
// properties of the COMPOSER, not the panel. Checking only the panel file is
// how a guard ends up verifying something no user can reach: on 2026-09-13 this
// repo held a contract check that passed for weeks against a form no route
// rendered. So the composer is read too, and the panel must be mounted in it.

const COMPOSER_REL = 'src/calendar/components/QuickPostComposer.jsx';
const COMPOSER = path.join(ROOT, COMPOSER_REL);
const composerCode = fs.existsSync(COMPOSER)
  ? fs.readFileSync(COMPOSER, 'utf8')
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
  : '';

check(
  'the TikTok panel is mounted in the live composer',
  /import\s+TikTokOptionsPanel\s+from/.test(composerCode) && /<TikTokOptionsPanel\b/.test(composerCode),
  `${COMPOSER_REL} must import and render TikTokOptionsPanel. Every assertion above reads the panel `
  + 'file alone, so without this they would keep passing after the panel stopped reaching users.',
);

check(
  'the composer previews the media being posted',                    // §2 row 7
  /<img\s+src=\{\s*selectedAsset\.thumbnail_url\s*\}/.test(composerCode),
  `${COMPOSER_REL} must show the asset that will be posted. A content preview is a guideline requirement.`,
);

// §2 row 8 — consent. TikTok defines the mechanism itself, so there is no
// separate confirmation dialog to require. Content Sharing Guidelines, verbatim
// (fetched 2026-09-22):
//   §5c "API Clients must only start sending content materials to TikTok after
//        the user has expressly consent to the upload."
//   §2  "there should be a declaration asking for a user's consent before the
//        publish button."
// The declaration lives in the panel and the publish control in the composer,
// so what has to hold is ORDER: the panel must render before the button. Moving
// the button above the panel would satisfy every other assertion here and fail
// the guideline.
const panelAt = composerCode.search(/<TikTokOptionsPanel\b/);
const publishAt = composerCode.search(/handleSubmit\(\s*'publish'\s*\)/);
check(
  'the consent declaration renders before the publish button',
  panelAt !== -1 && publishAt !== -1 && panelAt < publishAt,
  `In ${COMPOSER_REL} the TikTok panel (which carries the declaration) must appear before the `
  + "handleSubmit('publish') control. Guidelines §2: a declaration asking for consent before the publish button.",
);

// ── Report ──────────────────────────────────────────────────────────────────

console.log('TikTok Direct Post UX compliance\n');
for (const p of passes) console.log(`  ok    ${p}`);
for (const f of failures) {
  console.log(`  FAIL  ${f.name}`);
  console.log(`          ${f.detail}`);
}
console.log('');

if (failures.length) {
  console.error(
    `FAIL — ${failures.length} of ${passes.length + failures.length} TikTok UX requirements not met.\n\n`
    + 'Each of these is a CONDITION of Direct Post approval, not a preference.\n'
    + 'See FUNCTIONAL-SPECIFICATION-PUBLISHING.md §7.1 and TIKTOK-APP-REVIEW-PLAN.md §2.\n'
    + 'Shipping this fails the audit weeks later, with a generic rejection email.',
  );
  process.exit(1);
}
console.log(`PASS — ${passes.length} requirements verified.`);
process.exit(0);
