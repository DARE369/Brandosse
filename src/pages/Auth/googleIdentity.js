/**
 * googleIdentity.js — Google Identity Services, loaded on demand.
 *
 * ── Why sign-in does not go through Supabase's redirect any more ────────────
 * With supabase.auth.signInWithOAuth, Google's account chooser reads
 *
 *   "to continue to ujkuwemwlhilzarbrozu.supabase.co"
 *
 * because Google displays the OAuth client's REDIRECT URI HOST, and Supabase
 * owns that callback. No consent-screen setting changes it: supabase.co is not
 * a domain we can verify in Search Console, so branding cannot override it.
 * The only other fix is Supabase's custom-domain add-on — $35/month on the
 * plans involved, declined 2026-09-19.
 *
 * Google Identity Services issues an ID token directly to this page using OUR
 * OAuth client, so there is no redirect through Supabase at all, and the
 * chooser names Brandosse. supabase.auth.signInWithIdToken() then exchanges
 * that token for a normal Supabase session. It is Supabase's documented path
 * for exactly this.
 *
 * It also matters for OAuth verification: Google requires the demo video to
 * cover every OAuth client in the project. One client, one consent brand, one
 * thing on screen.
 *
 * ── The nonce, which is easy to get backwards ───────────────────────────────
 * Google receives the SHA-256 HASH; Supabase receives the RAW value and checks
 * that its hash matches the claim inside the token. Swapping them fails every
 * sign-in with a nonce mismatch, and nothing about the failure says which way
 * round it was. scripts/check-google-signin-brand.cjs pins the direction.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";

let gisPromise = null;

/** The public OAuth client ID. Not a secret: it is printed in every authorize URL. */
export function getGoogleClientId() {
  return (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "").trim();
}

/**
 * Load the Google Identity Services script once per page.
 *
 * Rejects rather than hanging: an ad blocker, a corporate proxy or an offline
 * laptop all stop this script, and the caller needs to know so it can offer the
 * redirect flow instead of a button that silently does nothing.
 */
export function loadGoogleIdentity({ timeoutMs = 8000 } = {}) {
  if (typeof window === "undefined") return Promise.reject(new Error("gis_unavailable_on_server"));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gisPromise) return gisPromise;

  gisPromise = new Promise((resolve, reject) => {
    const fail = (code) => {
      gisPromise = null; // allow a later retry instead of caching the failure
      reject(new Error(code));
    };

    const timer = setTimeout(() => fail("gis_timeout"), timeoutMs);

    const onLoad = () => {
      clearTimeout(timer);
      if (window.google?.accounts?.id) resolve(window.google);
      else fail("gis_missing_after_load");
    };

    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", () => { clearTimeout(timer); fail("gis_blocked"); }, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = onLoad;
    script.onerror = () => { clearTimeout(timer); fail("gis_blocked"); };
    document.head.appendChild(script);
  });

  return gisPromise;
}

/**
 * A fresh nonce for ONE sign-in attempt.
 *
 * `hashed` goes to Google (google.accounts.id.initialize), `raw` goes to
 * Supabase (signInWithIdToken). Never reuse a pair across attempts — a nonce's
 * whole job is to make a captured token unusable a second time.
 */
export async function createNoncePair() {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { raw, hashed };
}

/**
 * Turn a signInWithIdToken failure into a sentence a person can act on.
 *
 * The one that matters most is the audience mismatch: it means this OAuth
 * client ID has not been added to Supabase's Google provider yet. It is a
 * configuration gap, not the user's fault, and the redirect flow still works —
 * so the caller falls back to it rather than stranding them.
 */
export function describeGoogleSignInError(error) {
  const message = String(error?.message || "");
  if (/audience|aud\b|client.?id/i.test(message)) {
    return {
      code: "audience_not_authorised",
      recoverable: true,
      message: "Google sign-in isn't fully set up on our side yet. Try the button again — it will use the standard Google sign-in.",
    };
  }
  if (/nonce/i.test(message)) {
    return {
      code: "nonce_mismatch",
      recoverable: true,
      message: "That sign-in attempt expired. Please try again.",
    };
  }
  return {
    code: "google_signin_failed",
    recoverable: false,
    message: message || "Couldn't sign in with Google. Please try again.",
  };
}
