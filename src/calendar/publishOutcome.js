// src/calendar/publishOutcome.js
//
// What actually happened to one post, per destination. Pure functions, no I/O,
// so the honesty rules can be tested directly rather than through a screen.
//
// ── The claim this module exists to refuse ──────────────────────────────────
// "Published." At click time the product does not know that, and saying it is
// the 2026-09-11 failure verbatim: a post reported success and died fourteen
// seconds later with "YouTube requires a video. This post has no media
// attached."
//
// publish-post has exactly ONE caller — the cron worker
// process-scheduled-posts, registered '* * * * *'. A row sits at
// status='scheduled' until the worker picks it up, so the only true statement
// at click time is QUEUED. Everything past that is read back off the row.
//
// ── Why per destination, and not one verdict ────────────────────────────────
// A multi-destination send genuinely half-succeeds. One row per platform is
// written (calendarService.createQuickPost), each dispatched independently, so
// LinkedIn can publish while YouTube fails on media. Collapsing that into a
// single "Published"/"Failed" is a lie in one direction or the other — and the
// direction that hides a failure is the one that costs someone a post.
//
// ── Retrying is not failed, and not queued ──────────────────────────────────
// A retriable failure writes status back to 'scheduled' with an incremented
// workflow_state.publish.retry_count (publish-post/index.ts:317-330), up to
// MAX_RETRIES = 3. To the schema that is indistinguishable from "waiting its
// turn"; to the user it is not, because something already went wrong. The
// retry count is what separates them.

/** The states a destination can be in, as far as anything can actually know. */
export const OUTCOME = {
  QUEUED: 'queued',       // written, waiting for the worker. The click-time truth.
  SENDING: 'sending',     // status='publishing' — the worker has it now.
  RETRYING: 'retrying',   // failed retriably, back in the queue with a count.
  PUBLISHED: 'published', // confirmed by the platform.
  FAILED: 'failed',       // terminal.
  DRAFT: 'draft',         // never sent; included so a draft cannot render as queued.
};

/** Outcomes that will not change on their own. Polling can stop on these. */
export const TERMINAL_OUTCOMES = [OUTCOME.PUBLISHED, OUTCOME.FAILED, OUTCOME.DRAFT];

const workflowOf = (post) => (post?.workflow_state && typeof post.workflow_state === 'object'
  ? post.workflow_state
  : {});

const publishStateOf = (post) => {
  const w = workflowOf(post);
  return (w.publish && typeof w.publish === 'object') ? w.publish : {};
};

/**
 * Platform restrictions that are TRUE RIGHT NOW and that a bare "Published"
 * would hide. Both are live, and neither is our bug — they are conditions the
 * platform imposes on an app that has not finished its review.
 *
 * Read from the post's own recorded settings rather than hardcoded, so the
 * caveat disappears by itself the day the audit passes and the stored value
 * changes. A hardcoded string would outlive the restriction and become a lie in
 * the other direction.
 */
export function restrictionFor(post) {
  const platform = String(post?.platform || '').toLowerCase();
  const w = workflowOf(post);

  if (platform === 'youtube') {
    const privacy = String(w.youtube?.privacy_status || '').toLowerCase();
    if (privacy === 'private') {
      return 'YouTube locks uploads from an unverified project to private. That lock is '
        + 'applied by YouTube and cannot be appealed — the video is up, but only you can see it.';
    }
  }

  if (platform === 'tiktok') {
    const level = String(w.tiktok?.privacyLevel || '').toUpperCase();
    if (level === 'SELF_ONLY') {
      return 'Visible only to you. TikTok accepts nothing else from this app until its '
        + 'content audit passes — publish it, then switch it to public in the TikTok app.';
    }
  }

  return '';
}

/**
 * The whole answer for one post row.
 *
 * @returns {{state:string, label:string, detail:string, url:string|null,
 *            restriction:string, isTerminal:boolean, retryCount:number}}
 */
export function deriveOutcome(post) {
  const status = String(post?.status || '').toLowerCase();
  const publish = publishStateOf(post);
  const retryCount = Number(publish.retry_count ?? 0) || 0;
  const url = publish.platform_post_url || null;
  const restriction = restrictionFor(post);

  const base = { url: null, restriction, retryCount, isTerminal: false };

  if (status === 'published') {
    return {
      ...base,
      state: OUTCOME.PUBLISHED,
      label: 'Published',
      // Never asserts a link exists. The URL is written by the adapter and some
      // do not return one; rendering "View post" against a null href is how a
      // receipt starts lying about something it did confirm.
      detail: url ? 'Live now.' : 'Confirmed by the platform. No direct link was returned.',
      url,
      isTerminal: true,
    };
  }

  if (status === 'failed') {
    return {
      ...base,
      state: OUTCOME.FAILED,
      label: 'Failed',
      // The adapter's own words. A generic "something went wrong" would discard
      // the one piece of information that tells the user what to fix.
      detail: post?.error_message || 'No reason was recorded, which is itself a bug worth reporting.',
      isTerminal: true,
    };
  }

  if (status === 'publishing') {
    return { ...base, state: OUTCOME.SENDING, label: 'Sending', detail: 'Uploading to the platform now.' };
  }

  if (status === 'draft') {
    return {
      ...base,
      state: OUTCOME.DRAFT,
      label: 'Draft',
      detail: 'Saved, not sent.',
      isTerminal: true,
    };
  }

  if (status === 'scheduled' && retryCount > 0) {
    return {
      ...base,
      state: OUTCOME.RETRYING,
      label: `Retrying (${retryCount} of 3)`,
      detail: post?.error_message
        ? `${post.error_message} Trying again automatically.`
        : 'The last attempt did not go through. Trying again automatically.',
    };
  }

  // Everything else — including a scheduled row whose time has not come — is
  // queued. This is the click-time state and the only thing a receipt may claim
  // before the worker has run.
  return {
    ...base,
    state: OUTCOME.QUEUED,
    label: 'Queued',
    detail: 'Waiting for the publisher, which checks every minute.',
  };
}

/**
 * The headline across every destination.
 *
 * Deliberately refuses to say "Published" while anything is still moving, and
 * refuses to say "Published" at all unless EVERY destination confirmed. A
 * partial result is reported as partial — that is the whole point of the
 * screen, and the assertion publish-outcome.test.mjs exists to hold.
 */
export function summarise(posts) {
  const outcomes = (posts || []).map(deriveOutcome);
  const total = outcomes.length;
  const count = (state) => outcomes.filter((o) => o.state === state).length;

  const published = count(OUTCOME.PUBLISHED);
  const failed = count(OUTCOME.FAILED);
  const settled = outcomes.filter((o) => o.isTerminal).length;
  const allSettled = total > 0 && settled === total;

  if (total === 0) {
    return { tone: 'pending', title: 'Nothing to report', detail: '', outcomes, allSettled: true };
  }

  if (!allSettled) {
    const word = total === 1 ? 'account' : 'accounts';
    return {
      tone: 'pending',
      title: `Going out now — ${total} ${word}`,
      // States the real mechanism. "Publishing…" would claim more than is known.
      detail: 'Queued. The publisher checks every minute, so this leaves within about sixty '
        + 'seconds. You do not have to stay on this screen — the send is on the server, not in this tab.',
      outcomes,
      allSettled: false,
    };
  }

  // Success requires EVERY destination to have published — not merely that none
  // failed. Those are different, and the difference was a real hole: a draft is
  // terminal and is not a failure, so `failed === 0` reported three drafts as
  // "Published to 0 accounts". A blanket success claim for zero publications.
  // Caught by the generated invariant in publish-outcome.test.mjs, which is the
  // reason that loop exists rather than a list of cases someone thought of.
  if (published === total) {
    return {
      tone: 'success',
      title: published === 1 ? 'Published' : `Published to ${published} accounts`,
      detail: 'Every destination confirmed.',
      outcomes,
      allSettled: true,
    };
  }

  const drafts = count(OUTCOME.DRAFT);

  if (published === 0 && failed === 0) {
    // Only drafts. Nothing was sent, and nothing went wrong.
    return {
      tone: 'pending',
      title: drafts === 1 ? 'Saved as a draft' : `Saved as ${drafts} drafts`,
      detail: 'Nothing has been sent. Open it from the Calendar when you want it to go out.',
      outcomes,
      allSettled: true,
    };
  }

  if (published === 0) {
    return {
      tone: 'danger',
      title: total === 1 ? 'This did not go out' : 'None of these went out',
      detail: 'Nothing was posted. The reason for each is below.',
      outcomes,
      allSettled: true,
    };
  }

  if (failed === 0) {
    // Some published, the rest are drafts — no failure, but not a clean sweep
    // either, and saying "Published" would imply the drafts went too.
    return {
      tone: 'warning',
      title: `Published to ${published} of ${total}`,
      detail: `${drafts} ${drafts === 1 ? 'was' : 'were'} saved as a draft and not sent.`,
      outcomes,
      allSettled: true,
    };
  }

  // The case a single verdict cannot express, and the reason this screen exists.
  return {
    tone: 'warning',
    title: `Published to ${published} of ${total}`,
    detail: `${failed} destination${failed === 1 ? '' : 's'} did not go out. Each reason is below — `
      + 'the ones that failed can be sent again without touching the ones that worked.',
    outcomes,
    allSettled: true,
  };
}
