#!/usr/bin/env node
/**
 * check-composer-field-contract.cjs — no required platform field is dropped
 * between the composer and the adapter.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * It had already happened, silently, and was found by reading the code rather
 * than by anything failing:
 *
 *   QuickPostComposer offers every platform with a live credential, TikTok
 *   included (it reads connected_accounts_health_summary). createQuickPost then
 *   wrote workflow_state ONLY for YouTube. So a TikTok post was inserted with no
 *   per-post settings at all; optionsFor("tiktok") returned null
 *   (publish-post/index.ts:256-259); and tiktok.service.ts refused it with
 *   "No TikTok privacy level was chosen for this post" — correctly, because
 *   privacy_level is deliberately undefaulted there.
 *
 * Every component behaved exactly as documented. The post still died. That is
 * this repository's signature defect: disconnection, not absence.
 *
 * ── Why static, and why in both directions ──────────────────────────────────
 * The failure is not a wrong computation — it is a field collected at one end
 * and never read at the other, or read at one end and never collected. A unit
 * test of either end passes while the pair is broken. So this walks the chain:
 *
 *   panel emits  ->  composer collects  ->  service persists  ->  adapter reads
 *
 * and fails if any link is missing, IN EITHER DIRECTION — a key the adapter
 * demands that nothing sends, and a platform that refuses without settings that
 * the composer never collects.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. REFUSALS  — the adapters still hard-refuse missing per-post settings, and
 *                 the composer's PLATFORMS_WITH_REQUIRED_FIELDS names exactly
 *                 those platforms. Neither list may quietly shrink.
 *  2. COLLECTED — the composer mounts a real options panel for each of them,
 *                 and blocks sending until each reports valid.
 *  3. KEYS      — every option key an adapter reads is a key its panel emits.
 *                 Spelling drift here is silent: the post publishes with the
 *                 setting simply absent.
 *  4. PERSISTED — createQuickPost writes workflow_state for EVERY platform that
 *                 supplied options, not a hardcoded one.
 *  5. TITLE     — a user-supplied title reaches the insert, so YouTube is not
 *                 left publishing videos named after the file.
 *  6. HONESTY   — nothing on the publish path claims the post is "Published" at
 *                 click time. Publishing is asynchronous; only the worker knows.
 *
 * READ-ONLY. Exit 0 = connected. Exit 1 = a link is broken (fails CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const failures = [];
const passes = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    failures.push(`${rel} does not exist. The contract cannot be checked.`);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}

/**
 * Strip comments, so prose DESCRIBING a rule is never mistaken for the rule.
 *
 * This is not hypothetical tidiness — it caught this check out on its first run.
 * Two assertions fired against comments in the very files they were guarding:
 * calendarService's note explaining that workflow_state used to be gated on
 * `platformKey === 'youtube'`, and quickPostConfirmation's header stating that
 * the word "Published" must not appear. A guard that reads its own
 * documentation as evidence is worse than no guard, because the failure looks
 * authoritative. Same idiom as check-tiktok-ux-compliance.cjs:51-56.
 */
function stripComments(src) {
  return src
    // Normalise CRLF FIRST. This repo is checked out on Windows, so lines end
    // "\r\n"; splitting on "\n" alone leaves a trailing "\r", and JavaScript's
    // `.` does not match "\r" — so a `//.*$` line-comment pattern never reaches
    // end-of-line and strips nothing. The comment then survives into the code
    // being searched, which is precisely the false positive this function
    // exists to prevent, wearing a disguise.
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

function assert(condition, message, okMessage) {
  if (condition) passes.push(okMessage);
  else failures.push(message);
}

const composer = stripComments(read('src/calendar/components/QuickPostComposer.jsx'));
const service = stripComments(read('src/calendar/services/calendarService.js'));
const confirmation = stripComments(read('src/calendar/quickPostConfirmation.js'));
const ytPanel = stripComments(read('src/components/Publishing/YouTubeOptionsPanel.jsx'));
const ttPanel = stripComments(read('src/components/Publishing/TikTokOptionsPanel.jsx'));
const ytSvc = stripComments(read('supabase/functions/_shared/youtube.service.ts'));
const ttSvc = stripComments(read('supabase/functions/_shared/tiktok.service.ts'));
const publishPost = stripComments(read('supabase/functions/publish-post/index.ts'));

// ── 1. REFUSALS ─────────────────────────────────────────────────────────────
//
// Derived from the adapters, never hardcoded here — otherwise this check would
// be asserting its own opinion rather than the code's behaviour.

const adapterRefusals = {
  // "No TikTok privacy level was chosen for this post."
  tiktok: /const\s+privacyLevel\s*=\s*String\(\s*options\?\.privacyLevel[\s\S]{0,200}?if\s*\(\s*!privacyLevel\s*\)/.test(ttSvc),
  // refuses when made_for_kids came back null
  youtube: /if\s*\(\s*opts\.madeForKids\s*===\s*null\s*\)\s*\{[\s\S]{0,120}?return\s+fail\(/.test(ytSvc),
};

for (const [platform, stillRefuses] of Object.entries(adapterRefusals)) {
  assert(
    stillRefuses,
    `${platform}'s adapter no longer hard-refuses a post with no per-post settings. `
    + 'Either that refusal was removed (in which case the composer is now collecting '
    + 'something nothing needs) or this check is reading the wrong code. Both are '
    + 'worth stopping for.',
    `${platform} adapter still refuses a post with no per-post settings`,
  );
}

const declared = /PLATFORMS_WITH_REQUIRED_FIELDS\s*=\s*\[([^\]]*)\]/.exec(composer);
assert(
  Boolean(declared),
  'QuickPostComposer.jsx no longer declares PLATFORMS_WITH_REQUIRED_FIELDS. '
  + 'Without it nothing decides which platforms must be satisfied before sending.',
  'the composer declares which platforms have required fields',
);

if (declared) {
  const declaredKeys = [...declared[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
  const refusingKeys = Object.keys(adapterRefusals).filter((k) => adapterRefusals[k]).sort();
  assert(
    declaredKeys.join(',') === refusingKeys.join(','),
    `PLATFORMS_WITH_REQUIRED_FIELDS is [${declaredKeys.join(', ')}] but the adapters that `
    + `hard-refuse missing settings are [${refusingKeys.join(', ')}]. A platform missing from `
    + 'the composer list can be sent to without its required answer and will fail at publish; '
    + 'a platform missing from the adapter list is being blocked in the UI for no reason.',
    `the composer's required-field list matches the adapters exactly (${refusingKeys.join(', ')})`,
  );
}

// ── 2. COLLECTED ────────────────────────────────────────────────────────────

assert(
  /<TikTokOptionsPanel/.test(composer) && /<YouTubeOptionsPanel/.test(composer),
  'QuickPostComposer.jsx does not mount both options panels. A platform it offers '
  + 'but cannot collect settings for is a post that fails at publish with an '
  + 'instruction pointing at a control the user cannot reach.',
  'the composer mounts the real TikTok and YouTube options panels',
);

// The panels must be the SHARED ones, not a local reimplementation. A second
// copy drifts from the compliance requirements the originals encode.
assert(
  /from\s+'\.\.\/\.\.\/components\/Publishing\/TikTokOptionsPanel'/.test(composer)
  && /from\s+'\.\.\/\.\.\/components\/Publishing\/YouTubeOptionsPanel'/.test(composer),
  "QuickPostComposer.jsx does not import the shared Publishing panels. TikTok's panel "
  + 'is a compliance artefact whose exact controls are a condition of Direct Post '
  + 'approval; a local copy of it will drift and the app gets rejected.',
  'the composer uses the shared panels rather than a local copy',
);

// Every mounted options panel must be wired to BOTH callbacks. Checked per
// panel element rather than "does the string appear anywhere", because a second
// panel added later with only onChange wired would otherwise pass on the
// strength of the first one's onValidityChange.
for (const panel of ['TikTokOptionsPanel', 'YouTubeOptionsPanel']) {
  const el = new RegExp(`<${panel}[\\s\\S]*?/>`).exec(composer);
  assert(
    Boolean(el) && /onValidityChange=\{/.test(el[0]) && /onChange=\{/.test(el[0]),
    `QuickPostComposer.jsx mounts ${panel} without wiring both onChange and `
    + 'onValidityChange. A panel that reports "not answered yet" to nobody is '
    + 'decoration, and one whose settings go nowhere publishes without them.',
    `${panel} is wired to both onChange and onValidityChange`,
  );
}

// The callbacks handed to those panels must be STABLE ACROSS RENDERS.
//
// This is not a style rule. YouTubeOptionsPanel emits from an effect that lists
// `onChange` in its dependency array, so a callback with a fresh identity each
// render produces: effect fires -> parent setState -> re-render -> new callback
// -> effect fires. React reports "Maximum update depth exceeded" and the
// composer is unusable. It happened, in this file, and only YouTube showed it —
// TikTok's panel omits onChange from its deps, which is precisely how a defect
// like this hides in one of two otherwise identical integrations.
//
// `useCallback((key) => (settings) => ...)` does NOT satisfy this: it memoises
// the outer function while still returning a new inner arrow per call. The
// handlers must come from a per-key cache that outlives the render.
assert(
  /optionHandlers\s*=\s*useRef\(/.test(composer)
  && /onChange=\{handlersFor\([^)]*\)\.onChange\}/.test(composer),
  'QuickPostComposer.jsx no longer hands the options panels ref-cached, '
  + 'per-platform callbacks. An inline or re-created callback re-enters '
  + "YouTubeOptionsPanel's emit effect every render — \"Maximum update depth "
  + 'exceeded", and the composer stops working.',
  'the panels receive stable per-platform callbacks (no render loop)',
);

const sendBlocked = /const\s+sendBlocked\s*=([\s\S]*?);/.exec(composer);
assert(
  Boolean(sendBlocked) && /requiredFieldsMissing/.test(sendBlocked[1]),
  "The composer's sendBlocked does not account for unanswered required fields, so a "
  + 'post can be sent to a platform whose adapter will refuse it.',
  'sending is blocked while a required field is unanswered',
);

// ── 3. KEYS ─────────────────────────────────────────────────────────────────
//
// Every option key an adapter reads must be a key its panel actually emits.
// Spelling drift is invisible at runtime: the adapter simply sees `undefined`
// and publishes without the setting.

const readKeys = (src, pattern) => [...src.matchAll(pattern)].map((m) => m[1]);

const ytReads = [...new Set(readKeys(ytSvc, /\bo\.([a-z_]+)\b/g))]
  // `tags` is read by the adapter but is not a composer field yet — the panel
  // does not offer a tag editor (PLATFORM-PUBLISH-FIELDS.md §1, "Gap to close").
  // Excluded deliberately and named here so it is a decision, not an oversight.
  .filter((k) => k !== 'tags');
const ttReads = [...new Set(readKeys(ttSvc, /options\?\.([a-zA-Z]+)/g))];

for (const key of ytReads) {
  assert(
    new RegExp(`\\b${key}\\b`).test(ytPanel),
    `youtube.service.ts reads options.${key} but YouTubeOptionsPanel never emits it. `
    + 'The video publishes with that setting silently absent.',
    `YouTube's ${key} is both emitted and read`,
  );
}
for (const key of ttReads) {
  assert(
    new RegExp(`\\b${key}\\b`).test(ttPanel),
    `tiktok.service.ts reads options.${key} but TikTokOptionsPanel never emits it. `
    + 'The post publishes with that setting silently absent.',
    `TikTok's ${key} is both emitted and read`,
  );
}

// The AI-disclosure answer must land on the key YouTube actually reads.
assert(
  /contains_synthetic_media/.test(service) && /contains_synthetic_media/.test(ytSvc),
  "The AI-disclosure answer does not reach youtube.service.ts's "
  + 'contains_synthetic_media. It is collected in the composer and thrown away at '
  + 'the boundary — the field most likely to get an account actioned.',
  "AI disclosure reaches YouTube's contains_synthetic_media",
);

// ── 4. PERSISTED ────────────────────────────────────────────────────────────

assert(
  !/platformKey\s*===\s*'youtube'\s*&&/.test(service),
  "calendarService.js still gates workflow_state on platformKey === 'youtube'. "
  + "Every other platform's settings are dropped at the insert — this is exactly "
  + 'the defect that failed every TikTok post.',
  'workflow_state is not hardcoded to one platform',
);

assert(
  /workflow_state:\s*\{\s*\[platformKey\]/.test(service),
  "calendarService.js does not key workflow_state by the row's own platform. "
  + 'Settings collected for one destination could be written onto another.',
  "workflow_state is keyed by the row's own platform",
);

assert(
  /optionsFor\(\s*"tiktok"\s*\)/.test(publishPost) && /optionsFor\(\s*"youtube"\s*\)/.test(publishPost),
  'publish-post/index.ts no longer reads per-platform options out of workflow_state '
  + 'for both adapters, so what the composer persists is no longer consumed.',
  'publish-post reads workflow_state for both adapters',
);

// ── 5. TITLE ────────────────────────────────────────────────────────────────

assert(
  /platformNeedsTitle/.test(composer),
  'QuickPostComposer.jsx does not consult platformNeedsTitle(). "Title" means four '
  + 'different things across four platforms; one generic box is wrong on three of them.',
  'the composer asks for a title only where a title is a real separate field',
);

assert(
  /const\s+title\s*=\s*String\(\s*titles\?\.\[platformKey\]/.test(service),
  "calendarService.js does not carry the composer's title onto the row. YouTube falls "
  + 'back to post.title, so the video publishes named after the file — "clip-3.mp4".',
  'a user-supplied title reaches the posts row',
);

// ── 6. HONESTY ──────────────────────────────────────────────────────────────
//
// Publishing is asynchronous: publish-post has exactly one caller, the cron
// worker. At click time the only true statement is "queued".

assert(
  /scheduled_at/.test(service),
  'calendarService.js no longer routes a sent post through scheduled_at. If a '
  + 'synchronous publish path was added, this whole contract needs rewriting.',
  'the service still routes publishing through scheduled_at',
);

assert(
  !/\bPublished\b/.test(confirmation),
  'quickPostConfirmation.js claims a post is "Published". Nothing knows that at click '
  + 'time — the cron worker sends it up to a minute later. This is the 2026-09-11 '
  + 'failure: a post that reported success and died fourteen seconds afterwards.',
  'the confirmation copy never claims "Published" at click time',
);

assert(
  /mode\s*===\s*'publish'/.test(confirmation),
  'quickPostConfirmation.js does not handle the publish mode, so "Publish now" falls '
  + 'through to the scheduled copy and tells the user to look for it on the calendar '
  + 'at a time that has already passed.',
  'the publish mode has its own honest confirmation',
);

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-composer-field-contract FAILED\x1b[0m\n');
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-composer-field-contract\x1b[0m  '
  + `${passes.length} links verified: the adapters still refuse missing settings, the `
  + 'composer collects them through the shared panels and blocks on them, every key an '
  + 'adapter reads is a key its panel emits, workflow_state is persisted per platform, '
  + 'the title reaches the row, and nothing claims "Published" at click time.',
);
