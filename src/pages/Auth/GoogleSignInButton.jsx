"use client";

/**
 * GoogleSignInButton.jsx — "Sign in with Google" that names Brandosse.
 *
 * Renders Google's own button through Google Identity Services, using our
 * OAuth client, so the account chooser reads Brandosse rather than
 * "to continue to <project>.supabase.co". Why, and the nonce rules, are in
 * ./googleIdentity.js.
 *
 * ── It must never be a dead button ──────────────────────────────────────────
 * Four things can stop the Google path, none of them the user's fault:
 *
 *   1. NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set in this environment.
 *   2. Google's script is blocked (ad blockers, corporate proxies, offline).
 *   3. The client ID is not yet in Supabase's authorised list, so Supabase
 *      rejects the token's audience.
 *   4. This page's origin is not in the client's "Authorized JavaScript
 *      origins" — every Vercel preview URL, and production if the env var is
 *      set before the origins are. Nothing throws: initialize() and
 *      renderButton() succeed, Google answers the button iframe with a 403 and
 *      logs "[GSI_LOGGER]: The given origin is not allowed", and the iframe
 *      stays 0×0. Measured 2026-09-22 against the live client. So "ready" is
 *      only declared once the iframe has actually been given a height; no
 *      height within BUTTON_RENDER_TIMEOUT_MS means fallback. If that signal
 *      were ever wrong, the cost is the supabase.co button — never a blank.
 *
 * In every one of those cases the page's ORIGINAL button — passed in as
 * `children`, the redirect flow through Supabase — is rendered instead. It
 * shows the supabase.co host, which is worse branding, but it signs people in.
 * A sign-in button that silently does nothing is the one outcome not allowed.
 *
 * ── After sign-in, it hands off to /auth/callback ───────────────────────────
 * That page already creates the profile row for a first-time user and routes to
 * signup completion or the app root. The session is in storage by the time we
 * navigate, so it runs exactly as it does for the redirect flow. Reimplementing
 * those steps here would be two copies of first-login provisioning, and the one
 * nobody updates is the one that breaks.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import {
  createNoncePair,
  describeGoogleSignInError,
  getGoogleClientId,
  loadGoogleIdentity,
} from "./googleIdentity";

const BUTTON_MIN_WIDTH = 200;
const BUTTON_MAX_WIDTH = 400; // GIS's own ceiling
// How long Google gets to size its button iframe before we assume the origin
// was refused (case 4). A healthy render resizes it within a second or two.
const BUTTON_RENDER_TIMEOUT_MS = 6000;
const BUTTON_RENDER_POLL_MS = 200;

/**
 * Resolves true once Google has given the button iframe a real height, false
 * if it never does. A refused origin leaves the iframe at 0×0 permanently.
 */
function waitForRenderedButton(node, { timeoutMs = BUTTON_RENDER_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const frame = node?.querySelector("iframe");
      if (frame && frame.offsetHeight > 0) return resolve(true);
      if (!node?.isConnected || Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(check, BUTTON_RENDER_POLL_MS);
    };
    check();
  });
}

function prefersDark() {
  if (typeof window === "undefined") return false;
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit) return explicit === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
}

/**
 * @param {object}   props
 * @param {"signin"|"signup"} props.mode     wording on Google's button
 * @param {boolean}  props.disabled          another submit is in flight
 * @param {Function} props.onBeforeSignIn    runs before the session is created;
 *                                           Register stores signup intent here
 * @param {Function} props.onError           receives a sentence to show
 * @param {Function} props.onBusyChange      true while signing in
 * @param {React.ReactNode} props.children   the redirect-flow button (fallback)
 */
export default function GoogleSignInButton({
  mode = "signin",
  disabled = false,
  onBeforeSignIn,
  onError,
  onBusyChange,
  children,
}) {
  const { signInWithGoogleIdToken } = useAuth();
  const { navigate } = useAppNavigation();
  const clientId = getGoogleClientId();

  const containerRef = useRef(null);
  const nonceRef = useRef(null);
  // "loading" | "ready" | "fallback"
  const [mode_, setMode] = useState(clientId ? "loading" : "fallback");

  // Kept in a ref so the credential callback — registered once with Google —
  // always sees the latest props rather than the ones from its first render.
  const latest = useRef({ onBeforeSignIn, onError, onBusyChange });
  latest.current = { onBeforeSignIn, onError, onBusyChange };

  const initialise = useCallback(async () => {
    try {
      const google = await loadGoogleIdentity();
      const nonce = await createNoncePair();
      nonceRef.current = nonce;

      google.accounts.id.initialize({
        client_id: clientId,
        // HASHED to Google; the raw value goes to Supabase. See googleIdentity.js.
        nonce: nonce.hashed,
        use_fedcm_for_prompt: true,
        callback: (response) => handleCredentialRef.current?.(response),
      });

      const node = containerRef.current;
      if (!node) return;
      node.innerHTML = "";
      const width = Math.max(
        BUTTON_MIN_WIDTH,
        Math.min(BUTTON_MAX_WIDTH, Math.round(node.getBoundingClientRect().width) || BUTTON_MAX_WIDTH),
      );
      google.accounts.id.renderButton(node, {
        type: "standard",
        theme: prefersDark() ? "filled_black" : "outline",
        size: "large",
        text: mode === "signup" ? "signup_with" : "signin_with",
        shape: "pill",
        logo_alignment: "left",
        width,
      });

      // renderButton() returning is not evidence of a button — see case 4.
      if (!(await waitForRenderedButton(node))) {
        if (!node.isConnected) return; // unmounted while waiting; nothing to show
        throw new Error("gis_button_not_rendered (origin likely not in Authorized JavaScript origins)");
      }
      setMode("ready");
    } catch (error) {
      // Not an error the user caused, and not one they can fix: fall back.
      console.warn("[GoogleSignInButton] Google Identity unavailable, using redirect flow:", error?.message);
      setMode("fallback");
    }
  }, [clientId, mode]);

  const handleCredentialRef = useRef(null);
  handleCredentialRef.current = async (response) => {
    const { onBeforeSignIn: before, onError: reportError, onBusyChange: busy } = latest.current;
    busy?.(true);
    try {
      // Returning false aborts BEFORE any session exists. Register uses this
      // for its organisation fields: with Google's own button the account
      // picker opens first, so validation cannot run on click the way it did
      // with the redirect flow — it has to run here, and it has to be able to
      // say no. Signing someone in and then refusing their form would leave a
      // half-created account behind.
      if (before?.() === false) {
        busy?.(false);
        initialise(); // the nonce was never used; issue a fresh one anyway
        return;
      }
      await signInWithGoogleIdToken(response?.credential, nonceRef.current?.raw);
      navigate("/auth/callback", { replace: true });
    } catch (error) {
      const described = describeGoogleSignInError(error);
      console.error("[GoogleSignInButton] signInWithIdToken failed:", described.code, error?.message);
      reportError?.(described.message);
      busy?.(false);

      if (described.code === "audience_not_authorised") {
        // Supabase does not recognise this client yet. The redirect flow does
        // not depend on that setting, so hand the user the path that works.
        setMode("fallback");
        return;
      }
      // Every other failure: a fresh nonce for the next attempt. Reusing one
      // would make the retry fail for a reason unrelated to the original.
      initialise();
    }
  };

  useEffect(() => {
    if (!clientId) return;
    initialise();
  }, [clientId, initialise]);

  if (mode_ === "fallback") return children;

  return (
    <div
      ref={containerRef}
      aria-busy={mode_ === "loading"}
      style={{
        // Reserves the button's height while the script loads, so the form
        // does not jump when it appears.
        minHeight: 44,
        width: "100%",
        display: "flex",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    />
  );
}
