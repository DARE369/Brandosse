#!/usr/bin/env node
/**
 * check-brand-logo-chain.cjs — guard for the brand-logo + palette chain.
 *
 * Found 2026-08-24: a user uploaded a real logo to their Brand Kit and it
 * never appeared on a single generated image. The compositor
 * (_shared/composite.ts) was correct and complete. The edge function called
 * it correctly, gated on `logo_url`. NOTHING EVER SET `logo_url`. Four
 * independent breaks, each alone sufficient:
 *
 *   1. media.service.js never sent a logo field at all
 *   2. brandKitLoader.js selected asset TEXT but not `storage_path`,
 *      so nothing could name the file
 *   3. the stored `public_url` 400s — brand_assets is a PRIVATE bucket
 *   4. the logo was SVG; ImageScript decodes PNG/JPEG only
 *
 * Separately, `color_palette` was collected in full (hex + name + usage) and
 * read by nothing, so "on-brand" imagery never used the brand's colours.
 *
 * This guard asserts the whole chain in source, end to end:
 *
 *   settings toggle -> SessionStore -> media.service -> edge fn
 *     -> server-side resolve (service role) -> SVG raster -> composite
 *     -> loud failure reporting
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Comments in these files DESCRIBE the bugs being guarded against, so they
// contain every token we search for. Two checks passed against their own
// documentation during break-testing. Match live code only.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const loader     = stripComments(read('src/services/brandKitLoader.js'));
const media      = read('src/services/media.service.js');
const store      = read('src/stores/SessionStore.js');
const settings   = read('src/services/userSettingsService.js');
const tab        = read('src/pages/Settings/ContentDefaultsTab.jsx');
const studio     = read('src/pages/Studio/StudioPage.jsx');
const edge       = read('supabase/functions/generateImage/index.ts');
const composite  = read('supabase/functions/_shared/composite.ts');
const uploader   = read('src/components/BrandKit/AssetUploader.jsx');

const failures = [];
const need = (cond, msg) => { if (!cond) failures.push(msg); };

// ── 1. The loader must be able to NAME the file, not just describe it ───────
need(/\.select\([^)]*storage_path/s.test(loader),
  'brandKitLoader.js: asset select() omits storage_path — the logo file cannot be located (break #2)');
need(/hasLogo/.test(loader),
  'brandKitLoader.js: no hasLogo/logo exposed on the loader result');

// ── 2. Brand colours must reach the prompt ─────────────────────────────────
need(/formatPalette\(\s*kit\.color_palette\s*\)/.test(loader),
  'brandKitLoader.js: color_palette is not fed into the prompt summary — brand colours are dropped from every prompt');

// ── 3. Intent must travel: settings -> store -> service -> edge ────────────
need(/DEFAULT_GENERATION_DEFAULTS\s*=\s*\{[^}]*apply_logo/s.test(settings),
  'userSettingsService.js: apply_logo missing from DEFAULT_GENERATION_DEFAULTS');
need(/normalizeBoolean\(\s*source\.apply_logo/.test(settings),
  'userSettingsService.js: apply_logo is not normalized, so a saved value is dropped');
need(/apply_logo/.test(tab),       'ContentDefaultsTab.jsx: no user-facing toggle for the logo');
need(/applyLogo/.test(studio),     'StudioPage.jsx: persisted apply_logo is never mapped into live settings');
need(/applyLogo/.test(store),      'SessionStore.js: applyLogo is never passed to generateImages');
need(/apply_logo/.test(media),     'media.service.js: apply_logo is never sent to the edge function (break #1)');

// Every generateImages() call in SessionStore that renders a post image must
// carry the flag. The video first-frame call is deliberately exempt: a logo
// there would show for one frame and vanish.
const imageCalls = (store.match(/generateImages\(\{/g) || []).length;
const flagged    = (store.match(/applyLogo:/g) || []).length;
need(flagged >= imageCalls - 1,
  `SessionStore.js: ${flagged} of ${imageCalls} generateImages() call sites pass applyLogo`);

// ── 3b. Position / size must travel too, and stay clamped ─────────────────
// A control that renders but never reaches the renderer is the same defect
// class this whole guard exists for.
// The options must be RENDERED, not just declared — renaming the constant
// left `form.logo_position` behind and a presence check happily passed.
need(/LOGO_POSITION_OPTIONS\.map/.test(tab),
  'ContentDefaultsTab.jsx: position chips are not rendered');
need(/LOGO_SCALE_OPTIONS\.map/.test(tab),
  'ContentDefaultsTab.jsx: size chips are not rendered');
need(/logo_position/.test(tab) && /logo_scale/.test(tab),
  'ContentDefaultsTab.jsx: position/size are not bound to the form');
// Must be in the DEFAULTS block, not merely mentioned in the normalizer —
// a missing default silently becomes undefined for every new account.
const dStart = settings.indexOf('DEFAULT_GENERATION_DEFAULTS = {');
const defaultsBlock = dStart === -1 ? '' : settings.slice(dStart, settings.indexOf('};', dStart));
need(/logo_position/.test(defaultsBlock),
  'userSettingsService.js: logo_position missing from DEFAULT_GENERATION_DEFAULTS');
need(/logo_scale/.test(defaultsBlock),
  'userSettingsService.js: logo_scale missing from DEFAULT_GENERATION_DEFAULTS');
need(/Math\.min\(Math\.max\(Number\(source\.logo_scale\)/.test(settings),
  'userSettingsService.js: logo_scale is not clamped — an out-of-range value would reach the compositor');
need(/logoPosition/.test(studio) && /logoScale/.test(studio),
  'StudioPage.jsx: persisted logo position/scale never reach live settings');
// Parity, not presence: every site that opts into the logo must also say
// WHERE and HOW BIG, or that site silently falls back to the defaults while
// the user believes their setting applies.
const nApply = (store.match(/applyLogo:/g) || []).length;
const nPos   = (store.match(/logoPosition:/g) || []).length;
const nScale = (store.match(/logoScale:/g) || []).length;
need(nPos === nApply && nScale === nApply,
  `SessionStore.js: ${nApply} applyLogo sites but ${nPos} logoPosition / ${nScale} logoScale — every site must pass all three`);
need(/logo_position/.test(media) && /logo_scale/.test(media),
  'media.service.js: logo_position/logo_scale are not sent to the edge function');
need(/logo_position\?:\s*LogoPosition/.test(edge),
  'generateImage: logo_position is not part of the request contract');

// ── 3c. The user must be able to SAY what their logo is ───────────────────
// Found 2026-08-24: asset_type was derived from MIME alone — image/png and
// image/svg+xml became 'logo', image/jpeg became 'image'. A brand whose logo
// was a JPEG had it silently filed as a generic image, so resolveBrandLogo
// (which filters asset_type='logo') could never find it, and NOTHING in the
// UI could correct the classification. Format does not determine role.
need(/PROMOTABLE_TO_LOGO/.test(uploader),
  "AssetUploader.jsx: no way to mark a non-logo asset as the logo — a JPEG logo stays unreachable forever");
need(/updateAsset\(\s*asset\.id\s*,\s*\{\s*asset_type:\s*'logo'/.test(uploader),
  'AssetUploader.jsx: the logo control does not actually write asset_type');
need(/activeLogoId/.test(uploader),
  'AssetUploader.jsx: does not show WHICH logo will be used — ambiguous when a kit holds several');

// The UI's "which logo wins" rule and the resolver's must agree, or the badge
// lies. Both order by updated_at.
need(/order\("updated_at"/.test(edge),
  'generateImage: resolveBrandLogo does not order by updated_at, so re-designating a logo would not take effect');
need(/updated_at/.test(uploader),
  'AssetUploader.jsx: active-logo indicator does not use updated_at, so it can disagree with the renderer');

// ── 4. The edge function must resolve the file ITSELF (private bucket) ─────
need(/async function resolveBrandLogo/.test(edge),
  'generateImage: no server-side logo resolution — a client URL cannot read a private bucket (break #3)');
need(/storage\s*\.from\("brand_assets"\)\s*\.download/s.test(edge),
  'generateImage: resolveBrandLogo does not download from the brand_assets bucket');
need(/apply_logo\?:\s*boolean/.test(edge),
  'generateImage: apply_logo is not part of the request contract');

// ── 5. SVG must be rasterised ──────────────────────────────────────────────
need(/rasterizeIfSvg/.test(composite),
  'composite.ts: no SVG rasterisation — SVG logos cannot be composited at all (break #4)');
need(/rasterizeIfSvg/.test(edge) || /rasterizeIfSvg\(/.test(composite),
  'composite.ts: rasterizeIfSvg exists but compositeLogo does not use it');

// ── 6. Failure must be LOUD ───────────────────────────────────────────────
// The original code caught a composite failure, console.warn'd, and returned a
// completely normal-looking unbranded image. That is the silent no-op the
// third law forbids.
// The SUCCESS response is the last jsonResponse in the file; earlier ones are
// the method-not-allowed guard and the idempotent cache-hit replay.
const responseParts = edge.split('return jsonResponse({');
const responseBlock = responseParts[responseParts.length - 1] || '';
need(/logo_applied/.test(responseBlock),
  'generateImage: the RESPONSE does not report logo_applied — a missing logo would pass silently');
need(/logo_error/.test(responseBlock),
  'generateImage: the RESPONSE does not report logo_error');
need(/logo_applied/.test(edge.split('metadata: {')[1] || ''),
  'generateImage: generation metadata does not record logo_applied');
need(/console\.error\([^)]*logo_composite_failed/s.test(edge),
  'generateImage: logo composite failure is not logged at error level');
need(!/console\.warn\("\[generateImage\] logo composite failed/.test(edge),
  'generateImage: the old silent console.warn swallow is back');
need(/logo_applied/.test(media),
  'media.service.js: does not surface logo_applied to the caller');

if (failures.length) {
  console.error('\n  check-brand-logo-chain FAILED\n');
  for (const f of failures) console.error('   - ' + f);
  console.error('\n  The brand logo chain is broken. See the header of this file.\n');
  process.exit(1);
}
console.log('  check-brand-logo-chain: OK (logo + palette chain intact end to end)');
