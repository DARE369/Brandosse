// src/calendar/quickPostConfirmation.js
//
// What the product is allowed to claim the instant a Quick Post is submitted.
//
// ── Why this is a shared module and not a string in each page ────────────────
// Two surfaces now create posts through the same composer — the Calendar and
// the Library — and a third (the receipt, Phase 4) will report the outcome. If
// each writes its own confirmation copy, one of them eventually claims more
// than the click can know, and nobody notices, because a toast is not something
// a test looks at.
//
// ── What the click can and cannot know ──────────────────────────────────────
// Publishing in this product is ASYNCHRONOUS. publish-post has exactly one
// caller: the database cron worker process-scheduled-posts, registered
// '* * * * *', which selects status='scheduled' AND scheduled_at <= now()
// (20260710140000_create_process_scheduled_posts.sql). "Publish now" writes a
// row whose scheduled_at has already passed; the worker sends it within about a
// minute.
//
// So at click time the only true statement is that the post is QUEUED. Whether
// it published is knowable only once the row's status actually moves.
//
// This is not a hypothetical distinction. On 2026-09-11 a post reported success
// and died fourteen seconds later with "YouTube requires a video. This post has
// no media attached." A confirmation that says "Published" converts a failure
// the user could have fixed into one they never hear about — Law 3, fabricated
// data, exactly.
//
// The word "Published" must not appear here.
// scripts/check-composer-field-contract.cjs asserts that it does not.

/**
 * @param {'draft'|'schedule'|'publish'} mode
 * @returns {{ tone: string, title: string, desc: string }} tone + copy; the
 *          caller supplies its own icon, since the icon set is page-local.
 */
export function quickPostConfirmation(mode) {
  if (mode === 'draft') {
    return {
      tone: 'success',
      title: 'Saved as draft',
      desc: 'Find it in the Drafts rail, the calendar, or the Library anytime.',
    };
  }

  if (mode === 'publish') {
    return {
      tone: 'success',
      title: 'Going out now',
      // States the real mechanism rather than a reassuring approximation: the
      // user should know why it is not instant, and where to look when it is.
      desc: 'Queued. The publisher checks every minute, so it leaves within about '
        + 'sixty seconds — the calendar will show whether it went out.',
    };
  }

  return {
    tone: 'success',
    title: 'Post scheduled',
    desc: 'Find it in the Drafts rail, the calendar, or the Library anytime.',
  };
}
