#!/usr/bin/env node
/**
 * copy-review-persistence.test.mjs — saving a copy review into SHARED columns.
 *
 * Runs the REAL save logic (src/calendar/copyReviewPersistenceCore.js) against
 * an in-memory table that behaves like PostgREST for the calls it makes, with a
 * hook that can land another writer's change between our read and our write.
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *  1. Nothing else in the column is lost. personal_assets.metadata carries clip
 *     provenance; posts.workflow_state carries publish settings and the live
 *     post URL. A save that dropped either would do so silently.
 *  2. A concurrent write is merged, not overwritten — and if the row keeps
 *     changing, the save gives up and says so rather than clobbering it.
 *  3. A review of words that changed is refused, never attached to them.
 *  4. A post that has published is refused: its review at publish is the record.
 *  5. The client never writes `final` — only the worker freezes a report.
 *  6. A saved post review is one the worker PROMOTES at publish, with no second
 *     paid call — the point of saving it.
 *
 *   Usage:  node scripts/test/copy-review-persistence.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */
import {
  assetCopyInputs,
  postCopyInputs,
  readAssetCopyReview,
  saveAssetCopyReview,
  savePostCopyReview,
} from '../../src/calendar/copyReviewPersistenceCore.js';
import { decideFinalisation, fingerprintCopyInputs as serverFingerprint } from '../../supabase/functions/_shared/copyReview.ts';

let failures = 0;
let checks = 0;
function check(label, actual, expected) {
  checks += 1;
  if (actual !== expected) {
    failures += 1;
    console.error(`  FAIL  ${label}\n          expected: ${expected}\n          actual:   ${actual}`);
  }
}
function ok(label, condition, detail = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

// ── A minimal PostgREST-shaped fake ─────────────────────────────────────────

const clone = (v) => JSON.parse(JSON.stringify(v));
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 8, 16, 12, 0, 0) + (tick += 1000)).toISOString();

function makeDb(tables) {
  const hooks = { beforeUpdate: null };
  const writes = [];

  function builder(table) {
    const filters = [];
    let mode = 'select';
    let patch = null;
    let single = false;
    const q = {
      select() { return q; },
      update(obj) { mode = 'update'; patch = obj; return q; },
      eq(col, val) { filters.push((r) => r[col] === val); return q; },
      not(col, op, list) {
        const values = String(list).replace(/[()"]/g, '').split(',');
        filters.push((r) => !values.includes(r[col]));
        return q;
      },
      single() { single = true; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'update') {
            // Another writer lands between the caller's read and this write.
            if (hooks.beforeUpdate) {
              const hook = hooks.beforeUpdate;
              if (hook.once) hooks.beforeUpdate = null;
              hook(tables);
            }
            const live = tables[table].filter((r) => filters.every((f) => f(r)));
            live.forEach((r) => {
              Object.assign(r, clone(patch), { updated_at: stamp() });
              writes.push({ table, id: r.id });
            });
            resolve({ data: clone(live), error: null });
            return;
          }
          const rows = tables[table].filter((r) => filters.every((f) => f(r)));
          if (single) {
            resolve(rows.length === 1 ? { data: clone(rows[0]), error: null } : { data: null, error: { message: 'not found' } });
            return;
          }
          resolve({ data: clone(rows), error: null });
        } catch (e) { reject(e); }
      },
    };
    return q;
  }

  return { client: { from: (t) => builder(t) }, hooks, writes, tables };
}

const SCORED = {
  state: 'scored', score: 74, category: 'Good',
  breakdown: { hookStrength: 66, readability: 80 }, measured: ['hookStrength', 'readability'],
  suggestions: ['Open with the result.'], benchmarkReport: [], provider: 'p', model: 'm',
};

// ── ASSETS ──────────────────────────────────────────────────────────────────

function assetDb() {
  return makeDb({
    personal_assets: [{
      id: 'a1', title: 'Autumn restock', tags: ['fashion'], ai_tags: ['knitwear'],
      metadata: {
        origin: { kind: 'clip', source_video_id: 'v9' },
        copy_review: { version: 1, by_platform: { linkedin: { fingerprint: 'old', result: { overall: 50 } } } },
      },
      updated_at: stamp(),
    }],
  });
}

{
  const db = assetDb();
  const inputs = assetCopyInputs(db.tables.personal_assets[0], 'youtube');
  const res = await saveAssetCopyReview(db.client, 'a1', 'youtube', SCORED, inputs);
  const row = db.tables.personal_assets[0];
  check('asset review saves', res.saved, true);
  check('clip provenance in metadata survives the save', row.metadata.origin?.source_video_id, 'v9');
  check("another destination's saved review survives", row.metadata.copy_review.by_platform.linkedin?.fingerprint, 'old');
  check('the new review is stored under its destination', row.metadata.copy_review.by_platform.youtube.result.overall, 74);
  ok('it carries a fingerprint of the words it read', /^[0-9a-f]{64}$/.test(row.metadata.copy_review.by_platform.youtube.fingerprint));
  check('readAssetCopyReview finds it', readAssetCopyReview(row, 'youtube')?.result.overall, 74);
  check('tags are read as hashtags', inputs.hashtags.join(' '), '#fashion #knitwear');
}

{
  const db = assetDb();
  const inputs = assetCopyInputs(db.tables.personal_assets[0], 'youtube');
  db.tables.personal_assets[0].title = 'Autumn restock — now live';
  const res = await saveAssetCopyReview(db.client, 'a1', 'youtube', SCORED, inputs);
  check('a review of a title that has since changed is refused', res.saved, false);
  check('…and nothing is written', db.writes.length, 0);
  ok('…with a reason the user can act on', /changed while/.test(res.reason || ''), res.reason);
}

{
  // Someone else writes metadata between our read and our write.
  const db = assetDb();
  const inputs = assetCopyInputs(db.tables.personal_assets[0], 'youtube');
  const hook = (t) => {
    const r = t.personal_assets[0];
    r.metadata = { ...r.metadata, dedupe: { checksum: 'abc' } };
    r.updated_at = stamp();
  };
  hook.once = true;
  db.hooks.beforeUpdate = hook;
  const res = await saveAssetCopyReview(db.client, 'a1', 'youtube', SCORED, inputs);
  const row = db.tables.personal_assets[0];
  check('a concurrent write does not defeat the save', res.saved, true);
  check("…and the other writer's change is KEPT, not overwritten", row.metadata.dedupe?.checksum, 'abc');
  check('…alongside provenance', row.metadata.origin?.source_video_id, 'v9');
  check('…and the review', row.metadata.copy_review.by_platform.youtube?.result.overall, 74);
}

{
  // The row keeps changing: give up rather than clobber.
  const db = assetDb();
  const inputs = assetCopyInputs(db.tables.personal_assets[0], 'youtube');
  db.hooks.beforeUpdate = (t) => { t.personal_assets[0].updated_at = stamp(); };
  const res = await saveAssetCopyReview(db.client, 'a1', 'youtube', SCORED, inputs);
  check('a row that keeps changing is not overwritten', res.saved, false);
  check('…and no write lands', db.writes.length, 0);
}

{
  const db = assetDb();
  const res = await saveAssetCopyReview(db.client, 'a1', 'youtube', { state: 'unavailable', reason: 'x' }, {});
  check('a failed review is not saved', res.saved, false);
}

// ── POSTS ───────────────────────────────────────────────────────────────────

function postDb(overrides = {}) {
  return makeDb({
    posts: [{
      id: 'p1', status: 'scheduled', platform: 'youtube', caption: 'The caption', title: 'The title', hashtags: [],
      workflow_state: {
        youtube: { made_for_kids: false, privacy_status: 'private' },
        publish: { platform_post_url: 'https://example.com/earlier' },
        approval_status: 'approved',
      },
      updated_at: stamp(), published_at: null, scheduled_at: '2026-09-20T09:00:00Z',
      ...overrides,
    }],
  });
}

{
  const db = postDb();
  const inputs = postCopyInputs(db.tables.posts[0]);
  const res = await savePostCopyReview(db.client, 'p1', SCORED, inputs);
  const row = db.tables.posts[0];
  check('post review saves as a snapshot', res.saved, true);
  check('YouTube publish settings survive', row.workflow_state.youtube?.made_for_kids, false);
  check('publish accounting (live URL) survives', row.workflow_state.publish?.platform_post_url, 'https://example.com/earlier');
  check('approval routing survives', row.workflow_state.approval_status, 'approved');
  check('the snapshot is written', row.workflow_state.copy_review?.snapshot?.result.overall, 74);
  check('the client NEVER writes final', Boolean(row.workflow_state.copy_review && 'final' in row.workflow_state.copy_review), false);

  // The point of saving it: at publish, the worker reuses it — no paid call.
  row.status = 'published';
  row.published_at = stamp();
  const fp = await serverFingerprint(postCopyInputs(row));
  check('a saved post review is promoted at publish without re-scoring', decideFinalisation(row, fp).action, 'promote');
}

{
  const db = postDb({ status: 'published', published_at: stamp() });
  const res = await savePostCopyReview(db.client, 'p1', SCORED, postCopyInputs(db.tables.posts[0]));
  check('a published post is refused', res.saved, false);
  check('…and untouched', db.writes.length, 0);
}

{
  const db = postDb({ workflow_state: { copy_review: { final: { state: 'scored', result: { overall: 60 } } } } });
  const res = await savePostCopyReview(db.client, 'p1', SCORED, postCopyInputs(db.tables.posts[0]));
  check('a post with a frozen report is refused', res.saved, false);
  check('…and the frozen report is unchanged', db.tables.posts[0].workflow_state.copy_review.final.result.overall, 60);
}

{
  const db = postDb();
  const inputs = postCopyInputs(db.tables.posts[0]);
  db.tables.posts[0].caption = 'The caption, edited in the Calendar';
  const res = await savePostCopyReview(db.client, 'p1', SCORED, inputs);
  check('a review of a caption that has since changed is refused', res.saved, false);
  check('…and nothing is written', db.writes.length, 0);
}

{
  // The post starts publishing between our read and our write.
  const db = postDb();
  const inputs = postCopyInputs(db.tables.posts[0]);
  const hook = (t) => { t.posts[0].status = 'publishing'; t.posts[0].updated_at = stamp(); };
  hook.once = true;
  db.hooks.beforeUpdate = hook;
  const res = await savePostCopyReview(db.client, 'p1', SCORED, inputs);
  check('a post that started publishing mid-save is refused', res.saved, false);
  check('…and nothing is written to it', db.writes.length, 0);
}

{
  // The same race, but from a writer that does NOT bump updated_at. The
  // updated_at check cannot see this one; the status guard on the write is what
  // stops it. Without this case that guard was untested — deleting it passed.
  const db = postDb();
  const inputs = postCopyInputs(db.tables.posts[0]);
  const hook = (t) => { t.posts[0].status = 'publishing'; };
  hook.once = true;
  db.hooks.beforeUpdate = hook;
  const res = await savePostCopyReview(db.client, 'p1', SCORED, inputs);
  check('publishing without an updated_at bump is still refused', res.saved, false);
  check('…and nothing is written to it', db.writes.length, 0);
}

if (failures > 0) {
  console.error(`\n\x1b[31m✖ copy-review-persistence  ${failures} of ${checks} checks failed\x1b[0m\n`);
  process.exit(1);
}
console.log(
  `\x1b[32m✔ copy-review-persistence\x1b[0m  ${checks} checks passed — saves merge into shared columns without `
  + 'losing provenance or publish state, survive a concurrent write without clobbering it, refuse changed '
  + 'text and published posts, never write final, and a saved post review is promoted at publish unpaid.',
);
