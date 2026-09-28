// src/services/xhrStallGuard.js
//
// A settlement guarantee for XMLHttpRequest-backed promises.
//
// ── The defect this exists to prevent ───────────────────────────────────────
// Reported 2026-09-24: Keep and Schedule on the video job page spun forever.
// Neither ever failed, so neither ever recovered — no error, no toast, nothing
// to click. `personal-asset-upload` simply sat in the Network tab as (pending).
//
// The cause was structural, not incidental. XMLHttpRequest does not settle on
// its own when a connection dies: `onerror` fires for a transport error and
// `onload` for a response, and a stall is neither. All three XHR call sites in
// this repo wrapped one in `new Promise(...)` and resolved only from those two
// events, so a stalled request left the promise pending for the lifetime of
// the page — and every `await` behind it with no timeout of its own.
//
// CLAUDE.md: "Every outbound call needs a timeout." These had none.
//
// ── Why a stall watchdog and not xhr.timeout ────────────────────────────────
// `xhr.timeout` measures TOTAL duration, which is the wrong quantity for an
// upload. A value generous enough for a 50MB video on a phone is far too long
// to catch a dead socket; a value short enough to catch the dead socket kills
// honest slow uploads. Neither setting is correct because the question is not
// "how long has this taken" but "is anything still happening".
//
// So this measures SILENCE. Every progress event — request or response — buys
// another full window. A transfer that is merely slow runs as long as it needs;
// one that has actually stopped is abandoned and reported.
//
// ── Why one module and not three copies ─────────────────────────────────────
// The same omission existed identically at all three call sites, which is what
// a copied lifecycle produces. One implementation means one place to correct it
// and a guard that can simply ask whether each XHR passes through here —
// see scripts/check-xhr-stall-guard.cjs.

/** Silence, not slowness, is the failure signal. 60s of nothing is dead. */
export const DEFAULT_STALL_TIMEOUT_MS = 60_000;

/**
 * Arm a stall watchdog over an XMLHttpRequest.
 *
 * @param {XMLHttpRequest} xhr      the request to watch
 * @param {(error: Error) => void} onStall  called once if the request goes
 *        silent; pass the promise's `reject`. The request is aborted first, so
 *        the caller's own `onabort`/`onerror` handlers may also fire — settling
 *        a promise twice is a no-op, so that is harmless by design.
 * @param {object}  [options]
 * @param {number}  [options.timeoutMs]  silence allowed before giving up
 * @param {string}  [options.message]    what the user is told
 * @returns {{ arm: () => void, clear: () => void }}
 *          `arm()` after `send()`, so the window covers the request rather than
 *          whatever preparation preceded it. `clear()` is wired automatically
 *          on completion and is exposed for callers that settle early.
 */
export function guardXhrAgainstStalls(xhr, onStall, options = {}) {
  const {
    timeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    message = 'The connection stopped responding. Check your network and try again.',
  } = options;

  let timer = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const arm = () => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      // Abort first: without it the socket stays open and the browser keeps a
      // connection slot busy long after the caller has been told it failed.
      try { xhr.abort(); } catch (_err) { /* abort is best-effort */ }
      onStall(new Error(message));
    }, timeoutMs);
  };

  // Liveness from either direction counts. `upload.progress` covers the
  // request body, `progress` the response body, and `upload.loadend` the gap
  // between them — the server's think-time, which is silent but not dead only
  // for as long as the same window allows.
  xhr.upload?.addEventListener('progress', arm);
  xhr.upload?.addEventListener('loadend', arm);
  xhr.addEventListener('progress', arm);

  // Whatever ends the request ends the watch, including an abort this very
  // watchdog triggered.
  xhr.addEventListener('loadend', clear);

  return { arm, clear };
}
