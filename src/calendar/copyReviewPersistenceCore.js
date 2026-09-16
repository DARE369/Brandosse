// src/calendar/copyReviewPersistenceCore.js
//
// The logic of src/services/copyReviewPersistence.js with the database client
// INJECTED, so copy-review-persistence.test.mjs can run it against an in-memory
// table — including a concurrent write landing between read and write — without
// a network or a real account. The service file only binds it to supabase.
//
//
// Saving a copy review that was taken OUTSIDE the composer, so it survives the
// drawer closing. Two homes, both existing jsonb columns — no schema change:
//
//   personal_assets.metadata.copy_review.by_platform[platform]
//       An asset's own title and tags, reviewed for one destination. An asset's
//       words can change, so the entry carries the fingerprint of what it read
//       and the UI marks it stale when they no longer match.
//
//   posts.workflow_state.copy_review.snapshot
//       An UNPUBLISHED post's caption. The same snapshot the composer writes:
//       if the post publishes with this exact text, finalize-copy-reviews
//       promotes it to the frozen report without a second paid call. Never
//       `final` — only the worker writes that, and a published post is refused.
//
// ── Why read-modify-write with a concurrency check ──────────────────────────
// Both columns are SHARED. personal_assets.metadata carries clip provenance
// (`origin`); posts.workflow_state carries per-platform publish settings,
// approval routing and publish accounting (the live post URL). A bare update
// with a copied object would silently delete whatever another writer added
// between our read and our write. So each write is conditional on `updated_at`
// being unchanged since the read — the set_updated_at triggers bump it on every
// update, verified against the live database 2026-09-16 — and retries once from
// a fresh read if something else got there first.
//
// ── Why a review can be refused ─────────────────────────────────────────────
// A review describes the exact words it read. If the title, tags or caption
// changed while it was being taken, saving it would attach a score to text it
// never saw. Refused, with the reason, rather than saved wrong.
import {
  COPY_REVIEW_VERSION,
  buildSnapshot,
  canonicalCopyInputs,
  fingerprintCopyInputs,
  readCopyReview,
  toStoredResult,
} from './copyReview.js';

const MAX_ATTEMPTS = 2;

/**
 * The words an asset's review reads: its title (an asset has no caption, and
 * its title is the text a post made from it starts with) and its tags, as the
 * hashtags a post would carry.
 */
export function assetCopyInputs(asset, platform) {
  const title = String(asset?.title || '').trim();
  const hashtags = [...(asset?.tags || []), ...(asset?.ai_tags || [])]
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`));
  return { platform, caption: title, title, hashtags };
}

/** The saved review of an asset for one destination, or null. */
export function readAssetCopyReview(asset, platform) {
  const meta = (asset?.metadata && typeof asset.metadata === 'object') ? asset.metadata : {};
  const block = (meta.copy_review && typeof meta.copy_review === 'object') ? meta.copy_review : {};
  const byPlatform = (block.by_platform && typeof block.by_platform === 'object') ? block.by_platform : {};
  const entry = byPlatform[platform];
  return entry && typeof entry === 'object' && entry.result ? entry : null;
}

/** The inputs a post's review reads — exactly the row's own text. */
export function postCopyInputs(post) {
  return {
    platform: post?.platform || '',
    caption: post?.caption || '',
    title: post?.title || '',
    hashtags: Array.isArray(post?.hashtags) ? post.hashtags : [],
  };
}

/**
 * Save an asset review. Resolves { saved: true, asset } or
 * { saved: false, reason } — it throws only when the save could not be
 * attempted at all, so the caller can always tell the user what happened.
 */
export async function saveAssetCopyReview(supabase, assetId, platform, scored, scoredInputs) {
  if (!assetId || !platform) throw new Error('An asset and a destination are required to save a review.');
  if (scored?.state !== 'scored') return { saved: false, reason: 'There is no completed review to save.' };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data: row, error: readError } = await supabase
      .from('personal_assets')
      .select('id, title, tags, ai_tags, metadata, updated_at')
      .eq('id', assetId)
      .single();
    if (readError) throw readError;

    const rowInputs = assetCopyInputs(row, platform);
    if (canonicalCopyInputs(scoredInputs) !== canonicalCopyInputs(rowInputs)) {
      return { saved: false, reason: 'The title or tags changed while it was being reviewed, so this review was not saved.' };
    }

    const metadata = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
    const block = (metadata.copy_review && typeof metadata.copy_review === 'object') ? metadata.copy_review : {};
    const byPlatform = (block.by_platform && typeof block.by_platform === 'object') ? block.by_platform : {};

    const entry = {
      version: COPY_REVIEW_VERSION,
      // eslint-disable-next-line no-await-in-loop
      fingerprint: await fingerprintCopyInputs(rowInputs),
      scored_at: new Date().toISOString(),
      result: toStoredResult(scored),
    };

    // eslint-disable-next-line no-await-in-loop
    const { data: written, error: writeError } = await supabase
      .from('personal_assets')
      .update({
        metadata: {
          ...metadata,
          copy_review: { ...block, version: COPY_REVIEW_VERSION, by_platform: { ...byPlatform, [platform]: entry } },
        },
      })
      .eq('id', assetId)
      .eq('updated_at', row.updated_at)
      .select('*');
    if (writeError) throw writeError;
    if (written && written.length > 0) return { saved: true, asset: written[0] };
    // Something else wrote in between; go round once more from a fresh read.
  }

  return { saved: false, reason: 'The asset was changed by something else while saving. Review it again.' };
}

/**
 * Save an unpublished post's caption review as its copy_review SNAPSHOT.
 * Resolves { saved: true, post } or { saved: false, reason }.
 */
export async function savePostCopyReview(supabase, postId, scored, scoredInputs) {
  if (!postId) throw new Error('A post is required to save a review.');
  if (scored?.state !== 'scored') return { saved: false, reason: 'There is no completed review to save.' };

  const columns = 'id, status, platform, caption, title, hashtags, workflow_state, updated_at, published_at, scheduled_at';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data: row, error: readError } = await supabase
      .from('posts')
      .select(columns)
      .eq('id', postId)
      .single();
    if (readError) throw readError;

    const status = String(row.status || '').toLowerCase();
    if (status === 'published' || status === 'publishing' || readCopyReview(row).final) {
      // Its report at publish is the one that counts, and it does not change.
      return { saved: false, reason: 'This post has already gone out, so its review at publish is kept as it was.' };
    }

    // eslint-disable-next-line no-await-in-loop
    const snapshot = await buildSnapshot({ scored, scoredInputs, rowInputs: postCopyInputs(row) });
    if (!snapshot) {
      return { saved: false, reason: 'The caption changed while it was being reviewed, so this review was not saved.' };
    }

    const workflow = (row.workflow_state && typeof row.workflow_state === 'object') ? row.workflow_state : {};
    const existing = (workflow.copy_review && typeof workflow.copy_review === 'object') ? workflow.copy_review : {};

    // eslint-disable-next-line no-await-in-loop
    const { data: written, error: writeError } = await supabase
      .from('posts')
      .update({ workflow_state: { ...workflow, copy_review: { ...existing, snapshot } } })
      .eq('id', postId)
      .eq('updated_at', row.updated_at)
      // Belt and braces: if it started publishing after our read, write nothing.
      .not('status', 'in', '("published","publishing")')
      .select(columns);
    if (writeError) throw writeError;
    if (written && written.length > 0) return { saved: true, post: written[0] };
  }

  return { saved: false, reason: 'The post was changed by something else while saving. Review it again.' };
}
