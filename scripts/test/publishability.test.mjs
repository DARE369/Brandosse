#!/usr/bin/env node
/**
 * publishability.test.mjs — the two Library gates.
 *
 * Exercises the REAL derivation (src/pages/Library/publishability.js), not a
 * copy of it, across every media type crossed with every connected-provider
 * set — including the empty set and the not-yet-known set, which are the two
 * cases most likely to be got wrong.
 *
 * The defect this protects against shipped on 2026-09-11: a YouTube post that
 * failed fourteen seconds after creation with "YouTube requires a video. This
 * post has no media attached", because the asset behind it carried no
 * generation_id and the publisher can only resolve media through
 * post -> generation.
 *
 *   Usage:  node scripts/test/publishability.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */
import {
  derivePublishability,
  platformAcceptsMedia,
  PUBLISH_STATE,
} from '../../src/pages/Library/publishability.js';
import {
  getSourceLabel,
  getProvenanceLabel,
  isClip,
} from '../../src/pages/Library/libraryItemUtils.js';

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  if (actual !== expected) {
    failures += 1;
    console.error(`  FAIL  ${label}\n          expected: ${expected}\n          actual:   ${actual}`);
  }
}

function asset(over = {}) {
  return {
    source: 'upload',
    generation_id: 'gen_1',
    media_type: 'video',
    ai_tagging_status: 'done',
    ...over,
  };
}

console.log('publishability — the two Library gates\n');

/* ── Gate 1: media the publisher can resolve ───────────────────────────── */
console.log('Gate 1 — resolvable media');

check('no generation_id is BLOCKED even with a perfect connection set',
  derivePublishability(asset({ generation_id: null }), ['youtube']).state,
  PUBLISH_STATE.BLOCKED);

check('no generation_id is BLOCKED even with nothing connected',
  derivePublishability(asset({ generation_id: null }), []).state,
  PUBLISH_STATE.BLOCKED);

check('blocked assets cannot publish',
  derivePublishability(asset({ generation_id: null }), ['youtube']).canPublish,
  false);

check('blocked assets cannot even open the composer — nothing there would help',
  derivePublishability(asset({ generation_id: null }), ['youtube']).canOpenComposer,
  false);

check('gate 1 is checked BEFORE tagging — an unfetchable file is not improved by tags',
  derivePublishability(asset({ generation_id: null, ai_tagging_status: 'pending' }), ['youtube']).state,
  PUBLISH_STATE.BLOCKED);

check('a post record is a record, not a blocked asset',
  derivePublishability(asset({ source: 'post', generation_id: null }), ['youtube']).state,
  PUBLISH_STATE.RECORD);

check('post records never offer publish',
  derivePublishability(asset({ source: 'post', generation_id: null }), ['youtube']).canPublish,
  false);

/* ── Gate 2: a destination that accepts this file ──────────────────────── */
console.log('Gate 2 — destination fit');

// Values mirror the adapters via platformCaptionSpecs.acceptsMedia:
// youtube/tiktok take video; linkedin's adapter only implements image upload.
const MATRIX = [
  { media: 'video', platforms: ['youtube'],             expect: PUBLISH_STATE.READY },
  { media: 'video', platforms: ['tiktok'],              expect: PUBLISH_STATE.READY },
  { media: 'video', platforms: ['linkedin'],            expect: PUBLISH_STATE.NO_DESTINATION },
  { media: 'video', platforms: ['youtube', 'tiktok'],   expect: PUBLISH_STATE.READY },
  { media: 'video', platforms: ['linkedin', 'youtube'], expect: PUBLISH_STATE.READY },
  { media: 'image', platforms: ['youtube'],             expect: PUBLISH_STATE.NO_DESTINATION },
  { media: 'image', platforms: ['tiktok'],              expect: PUBLISH_STATE.NO_DESTINATION },
  { media: 'image', platforms: ['youtube', 'tiktok'],   expect: PUBLISH_STATE.NO_DESTINATION },
  { media: 'image', platforms: ['linkedin'],            expect: PUBLISH_STATE.READY },
  { media: 'image', platforms: ['instagram'],           expect: PUBLISH_STATE.READY },
  { media: 'document', platforms: ['youtube', 'tiktok', 'linkedin'], expect: PUBLISH_STATE.NO_DESTINATION },
];

for (const row of MATRIX) {
  check(`${row.media} + [${row.platforms.join(', ')}]`,
    derivePublishability(asset({ media_type: row.media }), row.platforms).state,
    row.expect);
}

check('the empty connection set is "nowhere to publish", not "ready"',
  derivePublishability(asset(), []).state,
  PUBLISH_STATE.NO_DESTINATION);

check('...and says so in terms of connecting, not file type',
  derivePublishability(asset(), []).reason.includes('No account is connected'),
  true);

check('no-destination still opens the composer, so the per-platform reason is reachable',
  derivePublishability(asset({ media_type: 'image' }), ['youtube']).canOpenComposer,
  true);

check('...but cannot publish',
  derivePublishability(asset({ media_type: 'image' }), ['youtube']).canPublish,
  false);

check('missing media_type cannot satisfy any platform',
  derivePublishability(asset({ media_type: null }), ['youtube', 'linkedin']).state,
  PUBLISH_STATE.NO_DESTINATION);

/* ── "We could not check" is not "you have none" ───────────────────────── */
console.log('Unknown connection state');

check('null connections does NOT render as no-destination',
  derivePublishability(asset(), null).state,
  PUBLISH_STATE.READY);

check('undefined connections does NOT render as no-destination',
  derivePublishability(asset(), undefined).state,
  PUBLISH_STATE.READY);

check('but an unresolvable file is still blocked while connections are unknown',
  derivePublishability(asset({ generation_id: null }), null).state,
  PUBLISH_STATE.BLOCKED);

/* ── Tagging ───────────────────────────────────────────────────────────── */
console.log('Enrichment in flight');

check('pending tagging defers publishing',
  derivePublishability(asset({ ai_tagging_status: 'pending' }), ['youtube']).state,
  PUBLISH_STATE.TAGGING);

check('not_applicable is not pending',
  derivePublishability(asset({ ai_tagging_status: 'not_applicable' }), ['youtube']).state,
  PUBLISH_STATE.READY);

/* ── The spec mirror itself ────────────────────────────────────────────── */
console.log('Per-platform media rules');

check('youtube takes video', platformAcceptsMedia('youtube', 'video'), true);
check('youtube refuses images', platformAcceptsMedia('youtube', 'image'), false);
check('tiktok refuses images while the photo endpoint is unbuilt', platformAcceptsMedia('tiktok', 'image'), false);
check('linkedin takes images', platformAcceptsMedia('linkedin', 'image'), true);
check('linkedin refuses video — the adapter has no video upload path', platformAcceptsMedia('linkedin', 'video'), false);
check('media type is matched case-insensitively', platformAcceptsMedia('youtube', 'VIDEO'), true);
check('an unknown platform accepts nothing', platformAcceptsMedia('myspace', 'video'), false);

/* ── Invariant that outranks all of the above ──────────────────────────── */
console.log('Invariant');

const EVERY_CASE = [];
for (const media of ['video', 'image', 'document', null]) {
  for (const gen of ['gen_1', null]) {
    for (const src of ['upload', 'generation', 'post']) {
      for (const tagging of ['done', 'pending', 'not_applicable']) {
        for (const platforms of [[], ['youtube'], ['tiktok'], ['linkedin'], ['youtube', 'tiktok', 'linkedin'], null]) {
          EVERY_CASE.push({ media, gen, src, tagging, platforms });
        }
      }
    }
  }
}

let violations = 0;
for (const c of EVERY_CASE) {
  const r = derivePublishability(
    { source: c.src, generation_id: c.gen, media_type: c.media, ai_tagging_status: c.tagging },
    c.platforms,
  );
  // The one rule that must hold everywhere: nothing may offer Publish without a
  // media reference the publisher can follow. This is the 2026-09-11 defect.
  if (r.canPublish && !c.gen) violations += 1;
  // And nothing may offer Publish while claiming no destination accepts it.
  if (r.canPublish && r.state === PUBLISH_STATE.NO_DESTINATION) violations += 1;
}
check(`no case among ${EVERY_CASE.length} offers Publish without resolvable media or a destination`,
  violations, 0);

/* ── Clip provenance ───────────────────────────────────────────────────── */
console.log('Clip provenance');

const clip = (origin) => ({ source: 'upload', metadata: { origin } });

check('a clip reads as a Clip, not an Upload',
  getSourceLabel(clip({ kind: 'video_clip' })), 'Clip');

check('a plain upload still reads as an Upload',
  getSourceLabel({ source: 'upload' }), 'Upload');

check('an asset saved before provenance existed is not mislabelled',
  isClip({ source: 'upload', metadata: { original_file_name: 'x.mp4' } }), false);

check('provenance names the video and the timecode',
  getProvenanceLabel(clip({ kind: 'video_clip', source_title: 'Founder AMA', start_time_secs: 724, end_time_secs: 765 })),
  'Clipped from “Founder AMA” · 12:04–12:45');

check('it degrades to the title alone when times are missing',
  getProvenanceLabel(clip({ kind: 'video_clip', source_title: 'Founder AMA' })),
  'Clipped from “Founder AMA”');

check('...and to the timecode alone when the title is missing',
  getProvenanceLabel(clip({ kind: 'video_clip', start_time_secs: 0, end_time_secs: 41 })),
  'Clipped at 0:00–0:41');

check('...and says something true when it knows neither',
  getProvenanceLabel(clip({ kind: 'video_clip' })), 'Clipped from a video');

check('a non-clip has no provenance line rather than a placeholder',
  getProvenanceLabel({ source: 'upload' }), null);

check('an unrecognised origin kind is ignored',
  isClip(clip({ kind: 'something_else' })), false);

check('a malformed origin cannot crash the label',
  getSourceLabel({ source: 'upload', metadata: { origin: 'not-an-object' } }), 'Upload');

console.log('');
if (failures > 0) {
  console.error(`publishability: ${failures} of ${checks} checks FAILED.`);
  process.exit(1);
}
console.log(`✔ publishability  ${checks} checks passed; ${EVERY_CASE.length} generated cases hold the invariant.`);
