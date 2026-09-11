#!/usr/bin/env node
/**
 * check-outbound-fetch-guard.cjs — no edge function fetches a user-influenced
 * URL with bare `fetch()`.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * Two edge functions took a URL straight from the request body and fetched it
 * from inside the runtime with no address validation and `redirect: "follow"`:
 *
 *   extractBrandKit  — `body.websiteUrl`, response summarised back by an LLM
 *   generateImage    — `body.logo_url`,   response composited into a returned image
 *
 * Both were server-side request forgery with a delivery mechanism attached: aim
 * either at a cloud metadata endpoint or a private address and read the reply
 * through the product's own UI. Fixed 2026-09-01 by routing both through
 * `_shared/safeFetch.ts`, which validates the address, re-validates every
 * redirect hop, and bounds size and time.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 * Every `fetch(` in supabase/functions is one of:
 *
 *   a) `safeFetch(` / `safeFetchText(` — validated, the required form for any
 *      URL a caller can influence;
 *   b) a hardcoded literal URL, or a template literal rooted in a module-level
 *      const that is itself a literal https URL (provider API base, etc.);
 *   c) listed in REVIEWED below with a written reason.
 *
 * Anything else fails. A new dynamic fetch has to be justified in this file
 * before it can ship, which is the point: the failure mode here is silent and
 * the exploit is trivial, so "someone will notice in review" is not a control.
 */

const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');

/**
 * Fetches of a URL that is NOT caller-influenced, each with the reason it is
 * safe. Keyed by `<relative path>:<line>` is deliberately avoided — line
 * numbers churn. Keyed by file + the variable being fetched instead.
 */
const REVIEWED = [
  {
    file: '_shared/llm.ts',
    match: /^provider\.url$/,
    reason: 'Provider endpoint from the module-level PROVIDERS registry (llm.ts:81, :87), both literal https URLs. Not caller-supplied.',
  },
  {
    file: '_shared/zernio.service.ts',
    match: /^url$/,
    reason: 'Built from the ZERNIO_BASE constant with every interpolated value passed through encodeURIComponent, so the host cannot be changed by input.',
  },
  {
    file: 'refresh-social-tokens/index.ts',
    match: /^url$/,
    reason:
      'fetchWithTimeout() is called from exactly one place — refreshWithProvider() — '
      + 'and its url argument is always config.tokenUrl, read from the module-level '
      + 'PROVIDERS table whose every entry is a literal https URL. Nothing here is '
      + 'caller-supplied: the worker takes no request body, is reachable only with the '
      + 'service-role bearer (requireServiceRole), and its row data supplies encrypted '
      + 'tokens, never a URL. scripts/check-oauth-provider-parity.cjs additionally '
      + 'asserts that table still matches app/api/_lib/socialProviders.js.',
  },
  {
    file: '_shared/tiktok.service.ts',
    match: /^url$/,
    reason:
      'fetchWithTimeout() receives only two kinds of URL, neither caller-supplied: '
      + '(a) the module-level INIT_URL / STATUS_URL constants, both built from the '
      + 'literal API base https://open.tiktokapis.com/v2; and (b) `uploadUrl`, read '
      + 'from TikTok\'s OWN publish/video/init response — a single-use, one-hour URL '
      + 'minted by the API we just authenticated to, not by our caller. '
      + 'The one caller-influenced URL here is `mediaUrl` (generations.output_url), '
      + 'and it goes through safeFetch() with a video/* content-type assertion, NOT '
      + 'through fetchWithTimeout.',
  },
  {
    file: '_shared/youtube.analytics.service.ts',
    match: /^url$/,
    reason:
      'fetchReport() builds every URL from the module-level REPORTS_URL const '
      + '(https://youtubeanalytics.googleapis.com/v2/reports) with its query string '
      + 'produced by URLSearchParams, so every interpolated value is encoded and the '
      + 'HOST cannot be influenced by input. Nothing caller-supplied reaches the URL: '
      + 'the only variable parts are dates, metric names from the module-level maps, '
      + 'and YouTube video ids that came from YouTube itself. This module fetches no '
      + 'media, so there is no safeFetch path here — unlike the publish adapters, it '
      + 'never touches generations.output_url.',
  },
  {
    file: '_shared/youtube.service.ts',
    match: /^url$/,
    reason:
      'fetchWithTimeout() receives only two kinds of URL, neither caller-supplied: '
      + '(a) template literals rooted in the module-level API / UPLOAD_API consts '
      + '(https://www.googleapis.com/...), with the only interpolated value — the video '
      + 'id returned by YouTube itself — passed through encodeURIComponent; and '
      + '(b) `sessionUri`, read from the Location header of the resumable-init response '
      + 'YouTube itself returned — a single-use session URI minted by the API we just '
      + 'authenticated to, not by our caller. '
      + 'The one genuinely caller-influenced URL here is `mediaUrl` '
      + '(generations.output_url), and it goes through safeFetch() with per-redirect-hop '
      + 'revalidation and a video/* content-type assertion, NOT through fetchWithTimeout.',
  },
  {
    file: '_shared/linkedin.service.ts',
    match: /^url$/,
    reason:
      'fetchWithTimeout() is called with exactly two kinds of URL, neither caller-supplied: '
      + '(a) template literals rooted in the module-level `API` const (https://api.linkedin.com), '
      + 'with the only interpolated value passed through encodeURIComponent; and '
      + '(b) `uploadUrl`, which is read from LinkedIn\'s own initializeUpload RESPONSE — a '
      + 'single-use URL minted by the API we just authenticated to, not by our caller. '
      + 'The one genuinely caller-influenced URL in this file is `mediaUrl` '
      + '(generations.output_url), and that goes through safeFetch() with a content-type '
      + 'assertion, NOT through fetchWithTimeout.',
  },
  {
    file: '_shared/fal.service.ts',
    match: /^(url|statusUrl|responseUrl|cancelUrl)$/,
    reason: 'fal.ai queue URLs are built from FAL_RUN_BASE/FAL_QUEUE_BASE constants and a model id from an internal enum. Not caller-supplied.',
  },
  {
    file: '_shared/storage.ts',
    match: /^sourceUrl$/,
    reason: 'Provider asset URL returned by fal.ai in the generation response, not from the request body.',
  },
  {
    file: '_shared/videoJobFinalize.ts',
    match: /^videoUrl$/,
    reason: 'Provider asset URL from the video job record, written server-side by the worker.',
  },
  {
    file: '_shared/sentry.ts',
    match: /^dsn$/,
    reason: 'Sentry DSN from environment, not user input.',
  },
  {
    file: 'generateImage/index.ts',
    match: /^sourceUrl$/,
    reason: 'fal.ai result URL from the generation response.',
  },
  {
    file: 'editImage/index.ts',
    match: /^providerUrl$/,
    reason: 'fal.ai result URL from the generation response.',
  },
  {
    file: 'upscaleImage/index.ts',
    match: /^providerUrl$/,
    reason: 'fal.ai result URL from the generation response.',
  },
  {
    file: 'quality-gate/index.ts',
    match: /^url$/,
    reason: 'Storage path read from the caller\'s OWN generations row (ownership checked before the fetch), not from the request body.',
  },
  {
    file: 'personal-asset-ai-tag/index.ts',
    match: /^url$/,
    reason: 'Storage URL read from the caller\'s OWN personal_assets row (ownership checked before the fetch), not from the request body.',
  },
  {
    file: 'extractBrandKit/index.ts',
    match: /^signedData\.signedUrl$/,
    reason: 'Signed URL minted server-side by this function against its own storage bucket.',
  },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Module-level `const X = "https://..."` declarations, which are safe roots. */
function literalConsts(source) {
  const names = new Set();
  const re = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*["'`]https?:\/\//g;
  let m;
  while ((m = re.exec(source)) !== null) names.add(m[1]);
  return names;
}

function isReviewed(relPath, argument) {
  const normalized = relPath.split(path.sep).join('/');
  return REVIEWED.find(
    (entry) => normalized.endsWith(entry.file) && entry.match.test(argument.trim()),
  );
}

const violations = [];
const files = fs.existsSync(FUNCTIONS_DIR) ? walk(FUNCTIONS_DIR) : [];

for (const file of files) {
  const relPath = path.relative(ROOT, file);
  const rawSource = fs.readFileSync(file, 'utf8');

  // safeFetch.ts IS the validated wrapper. The one bare fetch it contains is
  // the call every other fetch is required to route through, and it is made
  // only after assertPublicUrl() has passed on that exact URL.
  if (relPath.split(path.sep).join('/').endsWith('_shared/safeFetch.ts')) continue;

  const source = stripComments(rawSource);
  const safeConsts = literalConsts(source);
  const lines = rawSource.split(/\r?\n/);

  // Match `fetch(` not preceded by an identifier char, a dot, or the word
  // `safe` — so safeFetch/safeFetchText and `res.fetch` do not trip it.
  const re = /(?<![\w.$])fetch\s*\(\s*([^,)]*)/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const argument = (match[1] || '').trim();
    const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
    const lineText = (lines[lineNumber - 1] || '').trim();

    // (b) hardcoded literal, or template rooted in a literal const
    if (/^["'`]https?:\/\//.test(argument)) continue;
    const templateRoot = argument.match(/^`\$\{([A-Za-z_$][\w$]*)/);
    if (templateRoot && safeConsts.has(templateRoot[1])) continue;
    if (safeConsts.has(argument)) continue;

    // (c) explicitly reviewed
    if (isReviewed(relPath, argument)) continue;

    violations.push({ relPath, lineNumber, argument, lineText });
  }
}

if (violations.length > 0) {
  console.error('\n\x1b[31m✖ check-outbound-fetch-guard FAILED\x1b[0m\n');
  console.error(
    'A bare fetch() of a non-literal URL was found in an edge function.\n' +
    'If the URL can be influenced by the caller, route it through safeFetch()\n' +
    'from _shared/safeFetch.ts. If it genuinely cannot be, add it to REVIEWED\n' +
    'in this file with the reason it is safe.\n',
  );
  for (const v of violations) {
    console.error(`  ${v.relPath}:${v.lineNumber}`);
    console.error(`    fetch(${v.argument} …)`);
    console.error(`    ${v.lineText}\n`);
  }
  process.exit(1);
}

console.log(
  `\x1b[32m✔ check-outbound-fetch-guard\x1b[0m  ${files.length} edge function files scanned; ` +
  'every outbound fetch is validated, literal, or reviewed.',
);
