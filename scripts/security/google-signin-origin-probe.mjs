#!/usr/bin/env node
/**
 * google-signin-origin-probe.mjs — does Google accept our site for sign-in?
 *
 * WHY THIS EXISTS
 * ---------------
 * Google sign-in renders Google's own button through Google Identity Services
 * (src/pages/Auth/GoogleSignInButton.jsx). Google only draws that button on an
 * origin listed in the OAuth client's "Authorized JavaScript origins". On any
 * other origin nothing throws: Google answers the button iframe with a 403,
 * logs "[GSI_LOGGER]: The given origin is not allowed for the given client ID",
 * and leaves the iframe at 0×0. Measured 2026-09-22 against the live client,
 * when all three origins (www, apex, localhost) were refused.
 *
 * The component now falls back to the Supabase redirect button when that
 * happens, so users are never stranded — but the fallback is exactly the
 * "to continue to <project>.supabase.co" screen this work exists to remove,
 * after a ~6 second blank. A deleted origin, a renamed domain, or a swapped
 * client ID would produce that silently for every user. Nothing else notices.
 *
 * WHAT IT DOES
 *   1. Reads the client ID that PRODUCTION actually shipped, from the /login
 *      JavaScript bundle — not from an env file, which can disagree with Vercel.
 *      Not inlined means NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset in Vercel: the
 *      site is deliberately on the redirect flow. Reported as a warning.
 *   2. Serves a minimal page AT the production origin (request interception, so
 *      Google sees the real Origin header), renders Google's button with that
 *      client ID, and waits for Google to size the iframe.
 *
 * Read-only. Nobody is signed in; no credential is created.
 *
 *   Usage:  node scripts/security/google-signin-origin-probe.mjs [origin] [--require-client-id]
 *           origin falls back to $NEXT_PUBLIC_APP_URL, then https://www.brandosse.com.
 *           --require-client-id (or REQUIRE_GOOGLE_CLIENT_ID=1) makes an unset
 *           client ID a failure — turn it on once the rollout is complete.
 *   Exit 0 = button renders, or the Google path is intentionally off (warning).
 *   Exit 1 = client ID shipped but Google refuses the origin.
 *   Exit 2 = cannot run (site unreachable, no browser).
 */

import { createRequire } from "node:module";

const args = process.argv.slice(2);
const REQUIRE_CLIENT_ID = args.includes("--require-client-id")
  || /^(1|true)$/i.test(process.env.REQUIRE_GOOGLE_CLIENT_ID || "");
const ORIGIN = (args.find((a) => !a.startsWith("--")) || process.env.NEXT_PUBLIC_APP_URL || "https://www.brandosse.com").replace(/\/+$/, "");
const RENDER_TIMEOUT_MS = 12_000;
const CLIENT_ID_RE = /\b\d{6,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com\b/;

const inCI = !!process.env.GITHUB_ACTIONS;
const warn = (msg) => console.log(inCI ? `::warning::${msg}` : `WARN  ${msg}`);
const fail = (msg) => console.log(inCI ? `::error::${msg}` : `FAIL  ${msg}`);

async function fetchText(url) {
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (res.status !== 200) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

/** The client ID inlined into production's /login bundle, or null. */
async function shippedClientId() {
  const html = await fetchText(`${ORIGIN}/login`);
  const chunks = [...new Set(html.match(/\/_next\/static\/[^"']+\.js/g) || [])];
  if (chunks.length === 0) throw new Error(`${ORIGIN}/login lists no JavaScript chunks`);
  // Every chunk is searched for the ID: the minifier may inline
  // getGoogleClientId() into a different chunk from the one holding the GIS
  // script URL, and a missed ID would read as "unset" — a false green.
  let sawGis = false;
  let clientId = null;
  for (const chunk of chunks) {
    const js = await fetchText(ORIGIN + chunk);
    if (js.includes("accounts.google.com/gsi/client")) sawGis = true;
    const match = js.match(CLIENT_ID_RE);
    if (match && !clientId) clientId = match[0];
    if (sawGis && clientId) break;
  }
  return { clientId, sawGis };
}

async function probeOrigin(clientId) {
  // PLAYWRIGHT_DIR lets CI install Playwright in a scratch directory instead of
  // reifying this repo's whole dependency tree just to get one browser.
  let chromium;
  try {
    ({ chromium } = process.env.PLAYWRIGHT_DIR
      ? createRequire(`${process.env.PLAYWRIGHT_DIR.replace(/[\\/]+$/, "")}/package.json`)("playwright")
      : await import("playwright"));
  } catch {
    throw new Error("playwright is not installed (npm i --no-save playwright && npx playwright install chromium)");
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const gsiLogs = [];
    page.on("console", (m) => { if (/GSI_LOGGER/.test(m.text())) gsiLogs.push(m.text()); });
    let buttonStatus = null;
    page.on("response", (r) => { if (r.url().includes("accounts.google.com/gsi/button")) buttonStatus = r.status(); });

    const probePath = `${ORIGIN}/__google_signin_origin_probe`;
    await page.route(probePath, (route) => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><div id="b" style="width:320px"></div>
        <script src="https://accounts.google.com/gsi/client"></script>
        <script>window.onload = () => {
          google.accounts.id.initialize({ client_id: ${JSON.stringify(clientId)}, callback() {} });
          google.accounts.id.renderButton(document.getElementById("b"), { type: "standard", size: "large", width: 320 });
        };</script></body></html>`,
    }));
    await page.goto(probePath);

    const rendered = await page
      .waitForFunction(() => {
        const f = document.querySelector("#b iframe");
        return !!f && f.offsetHeight > 0;
      }, null, { timeout: RENDER_TIMEOUT_MS })
      .then(() => true, () => false);

    return { rendered, buttonStatus, gsiLogs };
  } finally {
    await browser.close();
  }
}

try {
  console.log(`Google sign-in origin probe — ${ORIGIN}`);
  const { clientId, sawGis } = await shippedClientId();

  if (!sawGis) {
    fail(`${ORIGIN}/login ships no Google Identity code. GoogleSignInButton is not in the production bundle.`);
    process.exit(1);
  }
  if (!clientId) {
    const msg = "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set in this deployment, so Google sign-in uses the "
      + "Supabase redirect and Google's chooser names the supabase.co host.";
    if (REQUIRE_CLIENT_ID) {
      // Once the rollout is done, losing the variable is a regression, not a state.
      fail(`${msg} REQUIRE_GOOGLE_CLIENT_ID is on, so this is a failure: restore it in Vercel and redeploy.`);
      process.exit(1);
    }
    warn(`${msg} Intentional only until the Google client's Authorized JavaScript origins are set; `
      + "then turn on REQUIRE_GOOGLE_CLIENT_ID so a lost variable fails this check.");
    process.exit(0);
  }

  console.log(`client ID shipped: ${clientId}`);
  const { rendered, buttonStatus, gsiLogs } = await probeOrigin(clientId);
  console.log(`gsi/button → ${buttonStatus ?? "no request"}; rendered: ${rendered}`);
  for (const l of gsiLogs) console.log(`  ${l}`);

  if (!rendered) {
    fail(
      `Google refuses ${ORIGIN} for ${clientId}. Every user gets a ~6s blank, then the supabase.co `
      + `redirect. Fix: Google Cloud → APIs & Services → Credentials → that OAuth client → `
      + `Authorized JavaScript origins → add ${ORIGIN}.`,
    );
    process.exit(1);
  }
  console.log("PASS — Google renders the sign-in button on the production origin.");
  process.exit(0);
} catch (error) {
  fail(`probe could not run: ${error.message}`);
  process.exit(2);
}
