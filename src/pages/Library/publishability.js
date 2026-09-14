// src/pages/Library/publishability.js
//
// The two gates, derived. Pure functions, no I/O, no new columns.
//
// WHY DERIVED AND NOT STORED
// --------------------------
// A stored "publishable" flag goes stale the moment a token expires, an account
// is disconnected, or a generation row is deleted — and it goes stale SILENTLY,
// which is this codebase's signature failure. Both gates are cheap to compute
// from data the Library already loads, so they are computed every render and
// cannot drift.
//
// GATE 1 — is there media the publisher can actually fetch?
// ---------------------------------------------------------
// publish-post resolves media exactly one way: post -> generation -> storage.
// It cannot see personal_assets. An asset with no generation_id therefore
// produces a post with no media, however complete it looks in the Library.
//
// That is not hypothetical. On 2026-09-11 a YouTube post failed fourteen
// seconds after creation with "YouTube requires a video. This post has no media
// attached." — because personal-asset-upload hardcoded generation_id = NULL on
// every row it wrote. Migration 20260912090000 backfilled the existing rows and
// the edge function now creates the generation at upload time, but the class of
// defect remains possible for any future write path, so the UI checks rather
// than assumes.
//
// GATE 2 — can any connected account actually receive THIS file?
// -------------------------------------------------------------
// Having media is not enough: YouTube and TikTok take video only, LinkedIn's
// adapter takes images only. A still with no image-capable account connected
// has nowhere to go, and the honest answer is to say so on the card rather than
// let the user discover it at send time. Per-platform rules live in
// platformCaptionSpecs.js, which mirrors the adapters.
// Explicit extension so this module is importable by `node` directly, not only
// through the bundler — which is what lets publishability.test.mjs exercise the
// real derivation instead of a copy of it.
import { getPlatformSpec } from '../../services/platforms/platformCaptionSpecs.js';

/**
 * Publish states, in the order they are checked. The first that applies wins,
 * because they are genuinely ordered by severity: a post record has no file to
 * enrich, and an asset with no fetchable file cannot be helped by connecting an
 * account.
 */
export const PUBLISH_STATE = {
  RECORD: 'record',         // source='post' — a record of a text post, never had a file
  BLOCKED: 'blocked',       // has a file, but nothing the publisher can resolve
  TAGGING: 'tagging',       // still being enriched; publishing now loses the alt text
  NO_DESTINATION: 'nodest', // resolvable, but no connected account takes this type
  READY: 'ready',
};

/** Does this platform accept this asset's media type? */
export function platformAcceptsMedia(platformKey, mediaType) {
  const spec = getPlatformSpec(platformKey);
  if (!spec) return false;
  // No acceptsMedia listed means the platform was never assessed; refuse rather
  // than assume, so an unassessed platform cannot quietly claim to take
  // everything.
  if (!Array.isArray(spec.acceptsMedia)) return false;
  if (!mediaType) return false;
  return spec.acceptsMedia.includes(String(mediaType).toLowerCase());
}

/**
 * Per-platform fit for one asset.
 *
 * @param {object} asset a personal_assets row
 * @param {string[]} connectedPlatforms platform keys the user can publish to
 * @returns {{key:string,label:string,accepts:boolean,reason:string}[]}
 */
export function platformFit(asset, connectedPlatforms = []) {
  const mediaType = asset?.media_type || null;
  return connectedPlatforms.map((key) => {
    const spec = getPlatformSpec(key) || {};
    const accepts = platformAcceptsMedia(key, mediaType);
    const takes = Array.isArray(spec.acceptsMedia) ? spec.acceptsMedia.join(' or ') : 'nothing yet';
    return {
      key,
      label: spec.label || key,
      accepts,
      reason: accepts
        ? `${spec.label || key} accepts this`
        : `${spec.label || key} takes ${takes} — this asset is ${mediaType || 'not media'}`,
    };
  });
}

/**
 * The whole answer for one asset.
 *
 * `connectedPlatforms` MUST be null while the capability lookup is in flight or
 * has failed — not an empty array. "We could not check" and "you have none" are
 * different statements, and rendering the second for the first tells the user
 * their accounts have vanished. Same rule QuickPostComposer already follows.
 *
 * @returns {{state:string, canPublish:boolean, canOpenComposer:boolean,
 *            reason:string, fits:object[], readyCount:number}}
 */
export function derivePublishability(asset, connectedPlatforms) {
  const unknownConnections = connectedPlatforms == null;
  const platforms = unknownConnections ? [] : connectedPlatforms;
  const fits = platformFit(asset, platforms);
  const readyCount = fits.filter((f) => f.accepts).length;

  const base = { fits, readyCount, canPublish: false, canOpenComposer: false };

  if (asset?.source === 'post') {
    return {
      ...base,
      state: PUBLISH_STATE.RECORD,
      reason: 'This is a record of a post, not a file. Open it in Calendar.',
    };
  }

  // Gate 1, checked before tagging: an unfetchable file is not improved by tags.
  if (!asset?.generation_id) {
    return {
      ...base,
      state: PUBLISH_STATE.BLOCKED,
      reason: 'The publisher cannot reach this file, so a post made from it would go out empty. Re-upload to repair it.',
    };
  }

  if (asset?.ai_tagging_status === 'pending') {
    return {
      ...base,
      state: PUBLISH_STATE.TAGGING,
      reason: 'Still generating tags and alt text. Publishing now would send the post without them.',
    };
  }

  // Unknown connections: do not claim there is nowhere to go. Let the composer
  // open and report the real state once it has loaded.
  if (unknownConnections) {
    return {
      ...base, state: PUBLISH_STATE.READY, canPublish: true, canOpenComposer: true, reason: '',
    };
  }

  // Gate 2.
  if (readyCount === 0) {
    return {
      ...base,
      state: PUBLISH_STATE.NO_DESTINATION,
      // Opening the composer read-only is deliberate: a toast can say THAT it
      // cannot go anywhere, but only the composer can say why, per platform.
      canOpenComposer: true,
      reason: platforms.length === 0
        ? 'No account is connected yet, so there is nowhere to publish.'
        : `No connected account accepts ${asset?.media_type || 'this file type'}.`,
    };
  }

  return {
    ...base, state: PUBLISH_STATE.READY, canPublish: true, canOpenComposer: true, reason: '',
  };
}

/** Short label for the card badge. */
export function publishStateLabel(state) {
  return {
    [PUBLISH_STATE.READY]: 'Ready',
    [PUBLISH_STATE.BLOCKED]: 'No file',
    [PUBLISH_STATE.TAGGING]: 'Tagging…',
    [PUBLISH_STATE.NO_DESTINATION]: 'No destination',
    [PUBLISH_STATE.RECORD]: 'Post record',
  }[state] || '';
}
