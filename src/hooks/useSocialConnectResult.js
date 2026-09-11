import { useEffect } from 'react';

/**
 * useSocialConnectResult — render the outcome of an OAuth round trip.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The connect callback is a server route. Its only way to communicate is a
 * redirect, so it appends ?connected=<platform> or ?social_error=<code> to
 * whichever page the user started from.
 *
 * Until this hook existed, nothing read either parameter. A failed connect
 * returned the user to a page that looked completely unchanged — no error, no
 * clue, no way to distinguish a failure from never having pressed the button.
 * A real failure (a schema constraint rejecting the insert) went unnoticed
 * through several full attempts because of it.
 *
 * ── Why it is shared rather than living in one page ─────────────────────────
 * The flow starts from at least two surfaces — Settings and the dedicated
 * /app/settings/connect flow — and `returnTo` sends the user back to the one
 * they came from. A copy on only one of them means failures are invisible
 * depending on where you began, which is precisely what happened: the handler
 * was on Settings, the user started from the connect page, and the error was
 * silent again.
 *
 * ── Why the callback receives an object, not a string ───────────────────────
 * A toast only needs a sentence, but the dedicated connect flow needs to
 * RENDER a success state — which platform, which account. Passing only a
 * message left that page unable to draw anything, so it showed a "DONE" step
 * with a blank body after a connection that had actually succeeded. The
 * caller gets the facts and decides what to do with them.
 *
 * @param {(result: {
 *   ok: boolean,
 *   platform: string|null,
 *   account: string|null,
 *   isNew: boolean,
 *   code: string|null,
 *   detail: string|null,
 *   message: string,
 * }) => void} onResult
 */

/**
 * Specific cause AND specific next step for every code the callback can emit.
 * "Something went wrong" is what this replaces, and it is useless here because
 * the remedy differs in every single case.
 */
const MESSAGES = {
  user_denied: 'You did not approve the connection, so nothing was changed.',
  missing_scopes: 'Almost — the platform needs permission to post. Try again and approve posting.',
  token_exchange_failed: 'Your sign-in was accepted but our app credentials were rejected. Check the client secret.',
  discovery_failed: 'Signed in, but we could not read your profile. The Sign In with OpenID Connect product may still be pending approval.',
  no_eligible_targets: 'No postable account was found on that profile.',
  oauth_state_expired: 'That took a while and the link expired. Nothing was connected — start again.',
  oauth_state_bad_signature: 'We could not verify that request, so we stopped. Start again from this page.',
  already_connected_elsewhere: 'That account is already connected to another workspace.',
  platform_unavailable: 'The platform is not responding right now. This is on their side.',
  connect_timed_out: 'We lost contact with the platform partway through. Nothing was saved — starting again is safe.',
  app_not_configured: 'This platform is not configured in this environment yet.',
  missing_code: 'The platform did not send an authorization code back. Start again.',
  // Our schema refused the write. Not the platform's fault and not the user's —
  // saying so points whoever is debugging at the right place.
  account_save_rejected: 'Your sign-in worked, but saving the account was rejected by the database. This is a configuration problem on our side, not yours.',
  // A transport failure on our side of the call — TLS reset, DNS blip. The
  // user did nothing wrong and nothing is misconfigured, so this must not
  // read like a bug or send them to check their account. Retrying works.
  connect_network_error: 'The connection dropped on the way to the platform. Nothing was saved — try again.',
  connect_failed: 'The connection could not be completed.',
};

export default function useSocialConnectResult(onResult) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const failure = params.get('social_error');
    if (!connected && !failure) return;

    const platform = connected || params.get('platform');
    const account = params.get('account');
    const detail = params.get('detail');

    if (connected) {
      onResult?.({
        ok: true,
        platform,
        account,
        isNew: params.get('is_new') === '1',
        code: null,
        detail: null,
        message: account ? `${account} connected on ${connected}.` : `${connected} connected.`,
      });
    } else {
      // An unmapped code still surfaces its raw value. An unrecognised failure
      // is exactly when the detail matters most, so hiding it behind a generic
      // sentence would be the wrong way round.
      const base = MESSAGES[failure] || `Could not connect: ${failure}`;
      onResult?.({
        ok: false,
        platform,
        account: null,
        isNew: false,
        code: failure,
        detail,
        message: detail ? `${base} (${detail})` : base,
      });
      // eslint-disable-next-line no-console
      console.error('[connect] callback reported:', failure, { platform, detail });
    }

    // Clear the parameters so a refresh does not replay the message, and so a
    // retry does not carry the previous failure forward inside its own
    // returnTo — which would otherwise accumulate in the URL on every attempt.
    for (const key of ['connected', 'social_error', 'platform', 'account', 'is_new', 'detail']) {
      params.delete(key);
    }
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    // Mount-only: the parameters are consumed once and removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
