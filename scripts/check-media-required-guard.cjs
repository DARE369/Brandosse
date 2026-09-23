#!/usr/bin/env node
/**
 * check-media-required-guard.cjs — a post cannot reach a media-mandatory
 * platform with no media attached.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * On 2026-09-11 a post was created and failed fourteen seconds later with
 * "YouTube requires a video. This post has no media attached." Its
 * generation_id was NULL. It was not an isolated row: 83 of 128 drafts and 48
 * of 63 failed posts carried no media link at all.
 *
 * The chain that produced it:
 *   1. A rendered clip was saved via the Library UPLOAD pipeline, which
 *      hardcodes generation_id = NULL (personal-asset-upload/index.ts:199-200).
 *   2. Quick Post prefilled that asset. It LOOKED complete — name, thumbnail.
 *   3. createQuickPost did `generation_id = asset?.generation_id || null`.
 *   4. The publisher resolves media only through posts -> generations
 *      (publish-post/index.ts:81-88), so it found nothing to upload.
 *
 * Every layer behaved reasonably on its own. The post still went out empty.
 *
 * ── Why a static check and not a unit test ──────────────────────────────────
 * The failure was never a wrong computation — each function returned exactly
 * what it promised. It was a missing CONNECTION between a platform's
 * requirement and the button that submits. That is the class of defect this
 * repository keeps producing, and it is invisible to a test exercising any
 * single unit.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. TRUTH   — the platforms whose adapters hard-refuse missing media are
 *               declared requiresMedia on the frontend spec, and the adapters
 *               still contain those refusals, so the mirror cannot drift.
 *  2. GUARD   — Quick Post consults that declaration and disables its submit.
 *  3. LINKAGE — the guard keys on generation_id, not on "an asset is picked",
 *               because an uploaded asset has no generation_id.
 *  4. HANDOFF — the clip path carries a real generation to the composer
 *               instead of relying on the upload row.
 *
 * READ-ONLY. Exit 0 = connected. Exit 1 = a link is broken (fails CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`MISSING FILE: ${rel}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

// ── 1. TRUTH ────────────────────────────────────────────────────────────────
// The frontend flag exists only to move the adapter's refusal forward to where
// the user can still act on it. If an adapter's refusal disappears, or a
// platform stops being declared, the two have drifted and the guard is lying.

const specs = read('src/services/platforms/platformCaptionSpecs.js');

assert(
  /export function platformsRequiringMedia/.test(specs),
  'platformCaptionSpecs.js no longer exports platformsRequiringMedia() — the '
  + 'composer guard has nothing to consult.',
);

for (const platform of ['youtube', 'tiktok', 'instagram']) {
  const line = new RegExp(`^\\s*${platform}:.*requiresMedia:\\s*true`, 'm');
  assert(
    line.test(specs),
    `platformCaptionSpecs.js no longer declares requiresMedia:true for "${platform}". `
    + 'That platform rejects text-only posts, so the composer will let one through.',
  );
}

// LinkedIn must NOT be marked — it accepts text-only posts, and marking it
// would block legitimate publishing. A guard that over-blocks gets switched off.
assert(
  !/^\s*linkedin:.*requiresMedia:\s*true/m.test(specs),
  'platformCaptionSpecs.js marks linkedin as requiresMedia, but linkedin.service.ts '
  + 'accepts a text-only post. This blocks valid publishes.',
);

// The adapters are the enforcement point. If their refusal is gone, the mirror
// above is stale and this guard asserts something no longer true.
const youtubeSvc = read('supabase/functions/_shared/youtube.service.ts');
assert(
  /if\s*\(\s*!mediaUrl\s*\)/.test(youtubeSvc),
  'youtube.service.ts no longer refuses a null mediaUrl — platformCaptionSpecs '
  + 'still claims YouTube requires media. One of the two is now wrong.',
);

const tiktokSvc = read('supabase/functions/_shared/tiktok.service.ts');
assert(
  /if\s*\(\s*!mediaUrl\s*\)/.test(tiktokSvc),
  'tiktok.service.ts no longer refuses a null mediaUrl — platformCaptionSpecs '
  + 'still claims TikTok requires media. One of the two is now wrong.',
);

// ── 1b. TRUTH, the other half: the KIND of media each adapter takes ─────────
//
// requiresMedia answers "a text-only post is refused". It says nothing about
// sending a PHOTO to a video-only endpoint, which is what happened on
// 2026-09-23: an image reached TikTok from the Library and the adapter refused
// it with "supabase.co returned image/jpeg, which is not what was expected".
// acceptsMedia already said video-only; nothing on the send path asked.
// YouTube is video-only and its adapter enforces that on the bytes it fetches.
{
  const spec = /youtube:\s*\{[^}]*acceptsMedia:\s*\[([^\]]*)\]/.exec(specs);
  assert(
    Boolean(spec) && spec[1].includes('"video"') && !spec[1].includes('"image"'),
    'platformCaptionSpecs.js no longer declares youtube as video-only. Its adapter still '
    + 'refuses anything else, so the composer would offer a send that cannot work.',
  );
  assert(
    /expectContentType:\s*\/\^video\\\//.test(youtubeSvc),
    'youtube.service.ts no longer asserts a video content type on the media it fetches, '
    + 'while platformCaptionSpecs still says YouTube takes video only.',
  );
}

// TikTok takes BOTH, through two different TikTok APIs. The spec may only claim
// "image" while the adapter actually implements the photo endpoint — otherwise
// the composer offers a send that dies at TikTok.
{
  const spec = /tiktok:\s*\{[^}]*acceptsMedia:\s*\[([^\]]*)\]/.exec(specs);
  const claimsImage = Boolean(spec) && spec[1].includes('"image"');
  assert(
    Boolean(spec) && spec[1].includes('"video"'),
    'platformCaptionSpecs.js no longer lists video for TikTok, but the adapter still uploads video.',
  );
  if (claimsImage) {
    assert(
      /post\/publish\/content\/init\//.test(tiktokSvc) && /PULL_FROM_URL/.test(tiktokSvc),
      'platformCaptionSpecs.js says TikTok accepts images, but tiktok.service.ts has no photo '
      + 'path (content/init + PULL_FROM_URL). The composer would offer a photo post that cannot work.',
    );
    // Photos are pulled BY TikTok from our domain. Minting that URL anywhere but
    // the shared, parity-checked helper is how the two sides drift apart.
    assert(
      /mediaProxyUrl\(/.test(tiktokSvc),
      'tiktok.service.ts builds a photo URL without mediaProxyUrl(). TikTok only fetches from a '
      + 'verified URL prefix, and the Next.js route must be able to verify what was minted.',
    );
  }
}

// ── 2 & 3. GUARD + LINKAGE ──────────────────────────────────────────────────

const composer = read('src/calendar/components/QuickPostComposer.jsx');

// The media-TYPE contract must gate the same button as the media-PRESENT one.
//
// Pinned to the ASSIGNMENT, not to the name appearing anywhere: the first
// version of this assertion matched the import line, so renaming the call site
// left it passing while nothing consulted the rule. A guard that cannot fail is
// the thing it is guarding against.
assert(
  /const\s+mediaTypeMismatches\s*=\s*platformsRefusingMediaType\(/.test(composer),
  'QuickPostComposer.jsx does not derive mediaTypeMismatches from '
  + 'platformsRefusingMediaType(). It can submit a photo to a video-only platform, '
  + 'and the user discovers it as a raw content-type error after pressing publish '
  + '(observed live 2026-09-23).',
);
assert(
  /platformsRefusingMediaType\(\s*activePlatforms\s*,\s*[\s\S]{0,60}media_type/.test(composer),
  'QuickPostComposer.jsx calls platformsRefusingMediaType() without the selected '
  + "platforms and the asset's media_type, so it cannot detect a mismatch.",
);

assert(
  /platformsRequiringMedia/.test(composer),
  'QuickPostComposer.jsx does not consult platformsRequiringMedia(). It can '
  + 'submit a post for a media-mandatory platform with nothing attached — the '
  + 'exact 2026-09-11 failure.',
);

// The distinction that matters: an UPLOADED Library asset is a selected asset
// with no generation_id. Guarding on `selectedAsset` alone re-opens the bug
// while looking correct.
assert(
  /selectedAsset\?\.generation_id/.test(composer),
  'QuickPostComposer.jsx no longer keys its media check on '
  + 'selectedAsset?.generation_id. An uploaded asset satisfies "an asset is '
  + 'selected" while carrying nothing the publisher can resolve.',
);

// The media requirement must reach EVERY button that writes a sendable row.
//
// This was originally a single `disabled={...needsMedia...}` match. Phase 2 gave
// the composer a second send button ("Publish now" beside "Schedule…"), and a
// per-button regex would have gone on passing while the new button was entirely
// ungated — a guard aimed at the button that happened to exist when it was
// written, which is the check-video-prefs-contract failure in miniature. So the
// chain is asserted in two links instead: needsMedia feeds the shared
// `sendBlocked` constant, and every send button is disabled by that constant.
// A third send button that skips it fails here.
const sendBlockedDecl = /const\s+sendBlocked\s*=([\s\S]*?);/.exec(composer);
assert(
  Boolean(sendBlockedDecl) && /mediaTypeMismatches/.test(sendBlockedDecl[1]),
  'QuickPostComposer.jsx computes a media-TYPE mismatch but it does not feed the '
  + 'shared sendBlocked constant, so the send is still allowed.',
);
assert(
  Boolean(sendBlockedDecl) && /needsMedia/.test(sendBlockedDecl[1]),
  'QuickPostComposer.jsx computes a media requirement but it does not feed the '
  + 'shared sendBlocked constant. A guard that does not block is decoration.',
);

const sendHandlers = [...composer.matchAll(/handleSubmit\(\s*'(schedule|publish)'\s*\)/g)];
assert(
  sendHandlers.length > 0,
  'QuickPostComposer.jsx has no schedule/publish submit handler at all. Either '
  + 'the composer can no longer send, or this check is looking at the wrong thing.',
);

// For each send handler, take the element that carries it — the text from the
// nearest preceding `<button` up to the handler — and require that slice to
// carry disabled={sendBlocked}. Walking backwards from the handler, rather than
// matching a whole tag, is deliberate: a JSX attribute contains `=>` and `}`,
// so any "match the tag" regex either stops early on the arrow or runs past the
// element entirely. This way each send path is checked as its own element and a
// new one cannot hide behind an older sibling's guard.
// A send button may be gated by `sendBlocked` itself, or by a constant that
// DEMONSTRABLY CONTAINS it. Phase 3 gave the schedule buttons `scheduleBlocked`
// — `sendBlocked || !scheduleFloor.ok` — which is strictly stronger, and a
// guard that insisted on the literal name would have forced the weaker gate
// back on. Each accepted alias is verified here to be composed from
// sendBlocked, so this cannot become a hole: name a constant `scheduleBlocked`
// without deriving it from sendBlocked and the media requirement stops
// reaching that button, which is the whole defect.
const GATE_ALIASES = ['sendBlocked'];
for (const alias of ['scheduleBlocked']) {
  const decl = new RegExp(`const\\s+${alias}\\s*=([\\s\\S]*?);`).exec(composer);
  if (decl && /\bsendBlocked\b/.test(decl[1])) GATE_ALIASES.push(alias);
}
const gatePattern = new RegExp(`disabled=\\{\\s*(${GATE_ALIASES.join('|')})\\s*\\}`);

const ungatedSend = [];
let orphanHandlers = 0;
for (const handler of sendHandlers) {
  const openIdx = composer.lastIndexOf('<button', handler.index);
  const element = openIdx === -1 ? null : composer.slice(openIdx, handler.index);
  // The nearest preceding `<button` is only the OWNER if no `</button>` closed
  // in between. Without that bound the walk happily borrows a previous sibling's
  // guard: moving a send handler onto an <a> left the Schedule button as the
  // nearest `<button`, and its disabled={sendBlocked} made the ungated anchor
  // look checked. Verified by deliberately doing exactly that and watching this
  // pass — which is why the bound is here.
  if (element === null || element.includes('</button>')) { orphanHandlers += 1; continue; }
  if (!gatePattern.test(element)) ungatedSend.push(handler[0]);
}
assert(
  orphanHandlers === 0,
  `QuickPostComposer.jsx has ${orphanHandlers} send handler(s) not attached to a `
  + '<button> element. A send path that is not a guarded button is a send path '
  + 'nothing checked.',
);
assert(
  ungatedSend.length === 0,
  `QuickPostComposer.jsx has ${ungatedSend.length} send button(s) not disabled by `
  + `a gate derived from sendBlocked (${ungatedSend.join(', ')}), so the media requirement does not `
  + 'reach them. This is the 2026-09-11 failure with a different button on it.',
);

// The picker must actually contain something. Blocking submit while the picker
// is empty turns a silent failure into a dead end.
const calendarPage = read('src/pages/Calendar/CalendarPage.jsx');
assert(
  /fetchPersonalAssets/.test(calendarPage),
  'CalendarPage.jsx no longer loads Library assets for Quick Post. The picker '
  + 'is empty, so a user told "media is required" has no way to supply it.',
);

// ── 4. HANDOFF ──────────────────────────────────────────────────────────────
// A clip saved to the Library goes through the upload pipeline and therefore
// has generation_id = NULL. The bridge gives it a real generation; the handoff
// carries that generation to the composer.

const videoJobPage = read('src/pages/VideoEngine/VideoJobPage.jsx');
assert(
  /publishClipToDraft/.test(videoJobPage),
  'VideoJobPage.jsx no longer calls publishClipToDraft(). Clips revert to being '
  + 'saved as uploads with no generation, and scheduling one produces a post '
  + 'with no media.',
);

const api = read('src/services/videoEngineApi.js');
assert(
  /export async function publishClipToDraft/.test(api),
  'videoEngineApi.js no longer exports publishClipToDraft() — the clip->post '
  + 'bridge route has no caller again, which is how every rendered clip became '
  + 'unpublishable in the first place.',
);

assert(
  fs.existsSync(path.join(ROOT, 'app/api/video/clips/[id]/publish/route.ts')),
  'The clip->post bridge route is gone, but callers still reference it.',
);

assert(
  /prefillGenerationId/.test(calendarPage),
  'CalendarPage.jsx no longer honours prefillGenerationId. A clip handed off '
  + 'from Video Jobs prefills an asset the publisher cannot resolve.',
);

// ── 5. UPLOADS ARE PUBLISHABLE ──────────────────────────────────────────────
// An uploaded file used to be unpublishable by construction: the edge function
// hardcoded generation_id = NULL and a CHECK constraint forbade anything else.
// The asset showed a name and a thumbnail in the composer and published as a
// post with no media.

const uploadFn = read('supabase/functions/personal-asset-upload/index.ts');

assert(
  !/generation_id:\s*null/.test(uploadFn),
  'personal-asset-upload writes generation_id: null again. Every uploaded file '
  + 'becomes unpublishable the moment this regresses.',
);

assert(
  /from\("generations"\)[\s\S]{0,400}?status:\s*"uploaded"/.test(uploadFn),
  'personal-asset-upload no longer creates an `uploaded` generations row. That '
  + 'row is the only media identity publish-post can resolve for an upload.',
);

// 'completed' would fire ensure_draft_post_for_generation() and turn every
// uploaded file into a draft post, and would put uploads into Studio's
// generation history. Both are wrong, and both are silent.
assert(
  !/from\("generations"\)[\s\S]{0,400}?status:\s*"completed"/.test(uploadFn),
  'personal-asset-upload creates its generation with status "completed". That '
  + 'fires the auto-draft trigger, manufacturing a draft post for every '
  + 'uploaded file, and lists uploads as generated work.',
);

const statuses = read('src/constants/statuses.js');
assert(
  /UPLOADED:\s*'uploaded'/.test(statuses),
  'GENERATION_STATUS.UPLOADED is gone, but the upload path and the KPI filter '
  + 'both depend on that value.',
);

// Uploads carry a generations row so they can be published. Counting them as
// generations would report the user's own uploads back to them as work the
// product did.
const kpis = read('src/hooks/useRealtimeKPIs.js');
assert(
  /neq\('status',\s*GENERATION_STATUS\.UPLOADED\)/.test(kpis),
  'useRealtimeKPIs no longer excludes uploaded rows from the generations count. '
  + 'The dashboard now inflates "generations" with files the user uploaded.',
);

// The CHECK constraint that made this impossible must stay widened.
const backfill = read('supabase/migrations/20260912090000_backfill_upload_generations.sql');
assert(
  /source = 'upload' AND post_id IS NULL/.test(backfill),
  'The migration that separated provenance from media identity no longer '
  + 'widens personal_assets_source_fk_matches. Uploads become unpublishable by '
  + 'constraint again.',
);

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-media-required-guard FAILED\x1b[0m\n');
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-media-required-guard\x1b[0m  adapters still refuse null media; '
  + 'the spec mirrors them; Quick Post blocks on generation_id (not merely a '
  + 'selected asset); the picker is populated; the clip bridge is called and its '
  + 'generation survives the handoff.',
);
