#!/usr/bin/env node
/**
 * smoke-youtube-publish.mjs — preflight for the first real YouTube connect.
 *
 * The YouTube adapter (supabase/functions/_shared/youtube.service.ts), the
 * discovery step and the refresh-worker entry were all written against
 * Google's published contract and have never touched Google's servers. No
 * YouTube account has ever been connected. This closes as much of that gap as
 * possible WITHOUT uploading anything.
 *
 * ── What it will not do ──────────────────────────────────────────────────────
 * It never uploads and never publishes. Before the compliance audit every
 * upload is locked private permanently and unappealably, so a smoke script that
 * quietly uploaded would burn a video that can never be made public.
 *
 * ── The credential probe is the interesting part ─────────────────────────────
 * Google has no client_credentials grant for YouTube, so there is no clean
 * "are these credentials valid?" call. But the token endpoint distinguishes the
 * two failures we care about:
 *
 *   invalid_client  -> the client id or secret is wrong
 *   invalid_grant   -> credentials ACCEPTED, the authorization code was bogus
 *
 * So deliberately exchanging a nonsense code proves the credentials against
 * Google's servers without minting anything. `invalid_grant` is the PASS.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   node scripts/smoke-youtube-publish.mjs
 *   node scripts/smoke-youtube-publish.mjs --account <connected_account_id>
 *
 * Env (read from the environment or .env.local; nothing is written):
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, NEXT_PUBLIC_APP_URL
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (only for --account)
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

// Same loader smoke-tiktok-publish.mjs uses. Without it this script reports
// "not set" for credentials that ARE configured — and a preflight that cries
// wolf gets ignored, which is worse than not having one.
function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(String.fromCharCode(10))) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}
const localEnv = loadLocalEnv();
const env = (name) => process.env[name] || localEnv[name] || "";

const CLIENT_ID = env("GOOGLE_OAUTH_CLIENT_ID");
const CLIENT_SECRET = env("GOOGLE_OAUTH_CLIENT_SECRET");
const ACCOUNT_ID = flag("account");

// The canonical production host. The apex 308-redirects to www, and OAuth
// redirect URIs are matched EXACTLY with no redirect following.
const CANONICAL_APP_URL = "https://www.brandosse.com";
const CALLBACK_PATH = "/api/auth/social/youtube/callback";

let failures = 0;
let warnings = 0;
const ok = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const bad = (m) => { failures += 1; console.log(`  \x1b[31m✖\x1b[0m ${m}`); };
const warn = (m) => { warnings += 1; console.log(`  \x1b[33m!\x1b[0m ${m}`); };
const info = (m) => console.log(`    ${m}`);
const step = (n, t) => console.log(`\n\x1b[1m${n}. ${t}\x1b[0m`);

console.log("\n\x1b[1mYouTube publish preflight\x1b[0m");
console.log("Nothing is uploaded. Nothing is published. Nothing is written.\n");

// ── 1. Credentials present ──────────────────────────────────────────────────

step(1, "Credentials");

if (!CLIENT_ID) bad("GOOGLE_OAUTH_CLIENT_ID is not set.");
else if (!CLIENT_ID.endsWith(".apps.googleusercontent.com")) {
  bad(`GOOGLE_OAUTH_CLIENT_ID does not look like a Google client id (${CLIENT_ID.slice(0, 12)}…).`);
  info("A Google OAuth client id always ends in .apps.googleusercontent.com.");
} else ok(`GOOGLE_OAUTH_CLIENT_ID set (${CLIENT_ID.slice(0, 12)}…, ${CLIENT_ID.length} chars)`);

if (!CLIENT_SECRET) bad("GOOGLE_OAUTH_CLIENT_SECRET is not set.");
else ok(`GOOGLE_OAUTH_CLIENT_SECRET set (${CLIENT_SECRET.length} chars)`);

// ── 2. The authorize URL this app will actually build ───────────────────────
//
// Read from the real registry rather than reconstructed here, so this checks
// what the app will send and not a copy that can drift from it.

step(2, "Authorize URL, built from the real provider registry");

let redirectUri = null;
try {
  const registry = await import("../app/api/_lib/socialProviders.js");
  const provider = registry.PROVIDERS.youtube;

  redirectUri = registry.redirectUriFor("youtube", env("NEXT_PUBLIC_APP_URL") || CANONICAL_APP_URL);

  const scopeParam = registry.authorizeScopeParam(provider);
  const extra = provider.extraAuthParams || {};

  // The two parameters that decide whether a refresh token exists at all.
  // Google issues one ONLY on first consent, and ONLY when both are present.
  // Missing either produces an integration that works for one hour and then
  // dies with no recovery short of a full reconnect.
  if (extra.access_type === "offline") ok("access_type=offline is requested");
  else bad("access_type=offline is MISSING — Google will issue no refresh token.");

  if (extra.prompt === "consent") ok("prompt=consent is requested");
  else bad("prompt=consent is MISSING — a re-authorisation returns no refresh token.");

  const required = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ];
  const missing = required.filter((s) => !provider.scopes.includes(s));
  if (missing.length === 0) {
    ok(`all ${required.length} scopes requested (upload, readonly, analytics)`);
    info("Scopes are fixed at consent — adding one later forces every user to reconnect.");
  } else {
    bad(`scope(s) missing from the request: ${missing.join(", ")}`);
  }

  if (scopeParam.includes(",")) {
    bad("YouTube scopes are comma-joined; Google expects a space-delimited list.");
  } else ok("scopes are space-delimited, as Google requires");
} catch (err) {
  bad(`Could not read the provider registry: ${err.message}`);
}

// ── 3. The redirect URI — matched EXACTLY, no redirect following ────────────

step(3, "Redirect URI");

const appUrl = env("NEXT_PUBLIC_APP_URL");
if (!appUrl) {
  warn("NEXT_PUBLIC_APP_URL is not set locally; the connect route falls back to the request origin.");
} else if (appUrl.replace(/\/+$/, "") !== CANONICAL_APP_URL) {
  warn(`NEXT_PUBLIC_APP_URL is "${appUrl}" locally.`);
  info(`In Vercel it MUST be ${CANONICAL_APP_URL} — the apex 308-redirects to www,`);
  info("and OAuth compares the redirect URI byte for byte without following redirects.");
} else ok(`NEXT_PUBLIC_APP_URL is the canonical ${CANONICAL_APP_URL}`);

console.log("");
info("Register EXACTLY this in Google Cloud → Credentials → your OAuth client:");
console.log(`\n      \x1b[36m${CANONICAL_APP_URL}${CALLBACK_PATH}\x1b[0m\n`);
if (redirectUri && redirectUri !== `${CANONICAL_APP_URL}${CALLBACK_PATH}`) {
  info(`(locally this computed ${redirectUri} — expected if NEXT_PUBLIC_APP_URL is localhost)`);
}

// ── 4. Live credential probe ────────────────────────────────────────────────

step(4, "Are the credentials valid? (asks Google, mints nothing)");

if (!CLIENT_ID || !CLIENT_SECRET) {
  warn("skipped — credentials missing above.");
} else {
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      // Deliberately invalid. We are testing the CLIENT credentials, not a code.
      code: "preflight-invalid-code-not-a-real-grant",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: `${CANONICAL_APP_URL}${CALLBACK_PATH}`,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const json = await res.json().catch(() => null);
    const code = json?.error || `http_${res.status}`;
    const desc = json?.error_description || "";

    if (code === "invalid_grant") {
      // The PASS. Google accepted the client and rejected only the fake code.
      ok("Google accepted client_id + client_secret (rejected only the fake code).");
      info("This proves the credentials against Google's servers, not just their docs.");
    } else if (code === "invalid_client") {
      bad("Google rejected the credentials: invalid_client.");
      info("The client id or secret is wrong, or belongs to a different Cloud project.");
      info("Check you copied the WEB application client, not an Android/iOS/Desktop one.");
    } else if (code === "redirect_uri_mismatch") {
      bad("Google rejected the redirect URI: redirect_uri_mismatch.");
      info(`Register ${CANONICAL_APP_URL}${CALLBACK_PATH} exactly, www included.`);
    } else if (code === "unauthorized_client") {
      bad("Google says unauthorized_client — this client is not allowed this grant type.");
    } else {
      warn(`Unexpected response from Google: ${code}${desc ? ` — ${desc}` : ""}`);
      info("Not necessarily a failure, but it is not the invalid_grant this probe expects.");
    }
  } catch (err) {
    bad(`Could not reach Google: ${err.message}`);
  }
}

// ── 5. A connected account, if one exists yet ───────────────────────────────

step(5, "Stored connection");

if (!ACCOUNT_ID) {
  warn("skipped — pass --account <connected_account_id> once a channel is connected.");
  info("No YouTube account has ever been connected, so this is expected for now.");
} else {
  const SUPABASE_URL = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SERVICE_KEY) {
    bad("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are needed to read the stored token.");
  } else {
    try {
      const base = SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
      const url = `${base}/rest/v1/connected_account_secrets`
        + `?connected_account_id=eq.${encodeURIComponent(ACCOUNT_ID)}`
        + "&select=expires_at,refresh_after,refresh_failures,last_refresh_error,"
        + "granted_scopes,refresh_token_ciphertext";

      const res = await fetch(url, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });

      if (!res.ok) {
        bad(`Could not read the stored secret (http ${res.status}).`);
        if (res.status === 401) {
          info("A 401 here is the service-role key mismatch recorded in");
          info("docs/handoff/2026-09-09 §10 — the key differs from the one the runtime holds.");
        }
      } else {
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;

        if (!row) {
          bad("No stored secret for that connected_account_id.");
          info("An account row with no secret renders as connected and can never publish.");
        } else {
          // Presence only. The ciphertext is never decrypted or printed.
          if (row.refresh_token_ciphertext) {
            ok("a refresh token is stored — this account can be auto-refreshed");
          } else {
            bad("NO refresh token stored.");
            info("Google issues one only on FIRST consent with access_type=offline and");
            info("prompt=consent. Disconnect and reconnect to get one; without it the");
            info("account dies in an hour and reconnecting is the only recovery.");
          }

          const scopes = row.granted_scopes || [];
          for (const [label, s] of [
            ["upload", "https://www.googleapis.com/auth/youtube.upload"],
            ["readonly", "https://www.googleapis.com/auth/youtube.readonly"],
            ["analytics", "https://www.googleapis.com/auth/yt-analytics.readonly"],
          ]) {
            if (scopes.includes(s)) ok(`granted: ${label}`);
            else bad(`NOT granted: ${label} (${s}) — cannot be added without reconnecting`);
          }

          if (row.expires_at) {
            const hours = (new Date(row.expires_at) - Date.now()) / 3_600_000;
            if (hours < 0) {
              bad(`access token expired ${Math.abs(hours).toFixed(1)}h ago — the refresh worker should have caught this.`);
              info("Check the refresh cron actually runs: docs/handoff/2026-09-09 §10.");
            } else ok(`access token valid for another ${hours.toFixed(1)}h`);
          }

          if (row.refresh_failures > 0) {
            warn(`${row.refresh_failures} consecutive refresh failure(s): ${row.last_refresh_error || "no detail"}`);
            info("Three failures marks the account expired and stops retrying.");
          }
        }
      }
    } catch (err) {
      bad(`Could not reach Supabase: ${err.message}`);
    }
  }
}

// ── 6. What this cannot check ───────────────────────────────────────────────

step(6, "Still manual — this script cannot see any of these");

info("• Google Cloud → APIs: BOTH 'YouTube Data API v3' and 'YouTube Analytics API'");
info("  must be enabled on the project. A disabled API returns a 403 that reads");
info("  exactly like a missing scope.");
info("• The redirect URI above must be registered on the OAuth client, exactly.");
info("• OAuth consent screen publishing status. While it is in TESTING, Google");
info("  expires refresh tokens after 7 DAYS — which presents as every account");
info("  failing at once and looks like a bug in the refresh worker.");
info("• The compliance audit. Until it passes, every upload is forced PRIVATE,");
info("  permanently and unappealably. Test with throwaway content on a throwaway");
info("  channel — a video uploaded now cannot be made public later.");

// ── Verdict ─────────────────────────────────────────────────────────────────

console.log("");
if (failures > 0) {
  console.log(`\x1b[31m✖ ${failures} blocker(s)\x1b[0m${warnings ? `, ${warnings} warning(s)` : ""}. Fix the blockers before connecting.\n`);
  process.exit(1);
}
console.log(`\x1b[32m✔ No blockers\x1b[0m${warnings ? `, ${warnings} warning(s)` : ""}.`);
console.log(`Next: connect a channel on ${CANONICAL_APP_URL}, then re-run with --account <id>.\n`);
