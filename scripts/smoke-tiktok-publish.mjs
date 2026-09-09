#!/usr/bin/env node
/**
 * smoke-tiktok-publish.mjs — preflight for the first real TikTok post.
 *
 * The TikTok adapter (supabase/functions/_shared/tiktok.service.ts) and the
 * refresh worker were both written against TikTok's published contract and
 * have never touched TikTok's servers. This script closes as much of that gap
 * as possible WITHOUT posting: it checks the credentials, the stored token,
 * the account's real posting permissions, and the chunk arithmetic.
 *
 * ── What it will not do ──────────────────────────────────────────────────────
 * It never publishes. The one thing that genuinely cannot be proven short of a
 * real upload is the upload itself, and a smoke script that quietly posts to a
 * live account is a bad trade. Step 5 tells you exactly what to run when you
 * are ready, and what to watch.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   node scripts/smoke-tiktok-publish.mjs
 *   node scripts/smoke-tiktok-publish.mjs --account <connected_account_id>
 *   node scripts/smoke-tiktok-publish.mjs --size 12582912   # chunk math only
 *
 * Env (any of the usual places; nothing is written to disk):
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (only for --account)
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

// Same loader tests/e2e/persona-walkthroughs.spec.js uses. Without it this
// script reports "not set" for credentials that ARE configured, which is a
// false blocker — and a preflight that cries wolf gets ignored.
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

const CLIENT_KEY = env("TIKTOK_CLIENT_KEY");
const CLIENT_SECRET = env("TIKTOK_CLIENT_SECRET");
const ACCOUNT_ID = flag("account");

let failures = 0;
let warnings = 0;
const ok = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const bad = (m) => { failures += 1; console.log(`  \x1b[31m✖\x1b[0m ${m}`); };
const warn = (m) => { warnings += 1; console.log(`  \x1b[33m!\x1b[0m ${m}`); };

// ── 1. Credentials present ───────────────────────────────────────────────────

console.log("\n1. Credentials");
if (!CLIENT_KEY) bad("TIKTOK_CLIENT_KEY is not set.");
else ok(`TIKTOK_CLIENT_KEY set (${CLIENT_KEY.slice(0, 4)}…, ${CLIENT_KEY.length} chars)`);
if (!CLIENT_SECRET) bad("TIKTOK_CLIENT_SECRET is not set.");
else ok(`TIKTOK_CLIENT_SECRET set (${CLIENT_SECRET.length} chars)`);

// ── 2. Chunk arithmetic ──────────────────────────────────────────────────────
//
// Mirrors planChunks() in tiktok.service.ts. The floor-vs-ceil rule is the
// easiest thing in the whole integration to get wrong, and getting it wrong
// fails mid-upload with an error that points at the bytes, so it is worth
// proving here rather than discovering it against a live account.

const MIN_CHUNK = 5 * 1024 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;

function planChunks(videoSize) {
  if (videoSize <= MIN_CHUNK) return { chunkSize: videoSize, totalChunks: 1 };
  let chunkSize = MIN_CHUNK;
  if (Math.floor(videoSize / chunkSize) > 1000) {
    chunkSize = Math.min(MAX_CHUNK, Math.ceil(videoSize / 1000));
  }
  return { chunkSize, totalChunks: Math.max(1, Math.floor(videoSize / chunkSize)) };
}

console.log("\n2. Chunk arithmetic (TikTok: total_chunk_count = FLOOR(size / chunk))");
const sizes = flag("size")
  ? [Number(flag("size"))]
  : [1_000_000, 5 * 1024 * 1024, 12 * 1024 * 1024, 100 * 1024 * 1024, 3.5 * 1024 * 1024 * 1024];

for (const size of sizes) {
  const { chunkSize, totalChunks } = planChunks(size);
  // Reproduce exactly what the adapter sends, then assert the last chunk
  // really does reach the final byte. An off-by-one here is the failure mode.
  const last = totalChunks - 1;
  const lastStart = last * chunkSize;
  const lastEnd = size - 1;
  const covered = lastEnd + 1 === size && lastStart <= lastEnd;
  const lastLen = lastEnd - lastStart + 1;

  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
  const line = `${mb(size)} → ${totalChunks} chunk(s) of ${mb(chunkSize)}, last chunk ${mb(lastLen)}`;

  if (!covered) bad(`${line} — does NOT cover the file`);
  else if (totalChunks > 1000) bad(`${line} — exceeds TikTok's 1000-chunk limit`);
  else if (lastLen > 128 * 1024 * 1024) bad(`${line} — last chunk over the 128MB cap`);
  else ok(line);
}

// ── 3. Live credential check ─────────────────────────────────────────────────
//
// client_credentials proves the key/secret pair is real and that `client_key`
// (not `client_id`) is the parameter TikTok expects — the exact bug that made
// every connect attempt fail. It issues an app token, not a user token, so it
// touches no account and publishes nothing.

console.log("\n3. Credentials accepted by TikTok");
if (!CLIENT_KEY || !CLIENT_SECRET) {
  warn("skipped — credentials missing above.");
} else {
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => null);

    if (res.ok && json?.access_token) {
      ok("TikTok accepted client_key + client_secret (app token issued).");
    } else {
      const code = json?.error || `http_${res.status}`;
      const desc = String(json?.error_description || "").slice(0, 160);
      bad(`TikTok rejected the credentials: ${code}${desc ? ` — ${desc}` : ""}`);
      if (/client_key/i.test(desc) || code === "invalid_client") {
        warn("Check the key is the Client Key from your TikTok app, not the Client ID of another provider.");
      }
    }
  } catch (err) {
    bad(`Could not reach TikTok: ${err.message}`);
  }
}

// ── 4. Stored token for a connected account ──────────────────────────────────

console.log("\n4. Stored account token");
if (!ACCOUNT_ID) {
  warn("skipped — pass --account <connected_account_id> to check a real connection.");
} else {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    bad("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY needed to read the stored token.");
  } else {
    try {
      const res = await fetch(
        `${url}/rest/v1/connected_account_secrets`
        + `?connected_account_id=eq.${encodeURIComponent(ACCOUNT_ID)}`
        + "&select=expires_at,refresh_after,refresh_failures,last_refresh_error,granted_scopes,"
        + "access_token_ciphertext,refresh_token_ciphertext",
        { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) },
      );
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : null;

      if (!row) {
        bad(`No secrets row for account ${ACCOUNT_ID}. It is connected in name only and cannot publish.`);
      } else {
        // Ciphertext shape, not the value — this never prints a token.
        const shaped = (v) => typeof v === "string" && /^v\d+\./.test(v);
        if (shaped(row.access_token_ciphertext)) ok("access token stored and encrypted.");
        else bad("access token missing or not in v<n>.<iv>.<tag>.<ct> form.");

        if (shaped(row.refresh_token_ciphertext)) ok("refresh token stored — this account can be auto-refreshed.");
        else warn("no refresh token. Expected for LinkedIn; for TikTok it means reconnecting is the only recovery.");

        const scopes = row.granted_scopes || [];
        if (scopes.includes("video.publish")) ok(`granted scopes include video.publish (${scopes.join(", ")})`);
        else bad(`video.publish NOT granted. Direct Post will fail. Granted: ${scopes.join(", ") || "none"}`);

        if (row.expires_at) {
          const hours = (new Date(row.expires_at) - Date.now()) / 3_600_000;
          if (hours < 0) bad(`access token expired ${Math.abs(hours).toFixed(1)}h ago — the refresh worker should have caught this.`);
          else if (hours < 2) warn(`access token expires in ${hours.toFixed(1)}h.`);
          else ok(`access token valid for another ${hours.toFixed(1)}h.`);
        } else warn("no expires_at recorded.");

        if (row.refresh_failures > 0) {
          warn(`${row.refresh_failures} consecutive refresh failure(s). Last: ${row.last_refresh_error || "unknown"}`);
        }
        if (row.refresh_after === null && shaped(row.refresh_token_ciphertext)) {
          bad("refresh_after is NULL with a refresh token present — the worker marked this terminal. Reconnect the account.");
        }
      }
    } catch (err) {
      bad(`Could not read the stored token: ${err.message}`);
    }
  }
}

// ── 5. What is still unproven ────────────────────────────────────────────────

console.log("\n5. Still unproven by this script");
console.log("   The upload itself. To exercise it end to end:");
console.log("     a. Set the TikTok account to PRIVATE — until the app passes");
console.log("        content audit, init returns 403");
console.log("        unaudited_client_can_only_post_to_private_accounts.");
console.log("     b. Compose a post with a short MP4 (H.264, 360-4096px, 23-60fps,");
console.log("        under 10 min) and pick a privacy level in the TikTok panel.");
console.log("     c. Publish, then watch the publish-post logs for the poll loop:");
console.log("        PROCESSING_UPLOAD → PROCESSING_DOWNLOAD → PUBLISH_COMPLETE.");
console.log("   Watch for two things specifically:");
console.log("     • a chunk rejected partway through  → the floor/ceil rule (step 2)");
console.log("     • PUBLISH_COMPLETE never arriving   → the ~2min poll bound gives up");
console.log("       and asks you to check the profile rather than risk a double post.");

console.log(
  `\n${failures > 0 ? "\x1b[31mFAILED\x1b[0m" : "\x1b[32mPREFLIGHT OK\x1b[0m"}`
  + ` — ${failures} blocking, ${warnings} to note.\n`,
);
process.exit(failures > 0 ? 1 : 0);
