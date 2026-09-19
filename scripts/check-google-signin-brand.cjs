#!/usr/bin/env node
/**
 * check-google-signin-brand.cjs
 *
 * Google sign-in goes through Google Identity Services + signInWithIdToken
 * (src/pages/Auth/googleIdentity.js), so Google's account chooser names
 * Brandosse instead of "to continue to <project>.supabase.co". The alternative
 * was Supabase's custom-domain add-on at $35/month, declined 2026-09-19.
 *
 * Four ways this breaks, none of which throws at build time:
 *
 *   1. THE NONCE BACKWARDS. Google must receive the SHA-256 hash and Supabase
 *      the raw value. Swapped, every sign-in fails with a nonce mismatch that
 *      says nothing about direction.
 *
 *   2. NO FALLBACK. If Google's script is blocked, or the client ID is missing
 *      or not yet authorised in Supabase, the page must render the redirect
 *      flow. Remove that and an ad-blocker user sees a sign-in page with no way
 *      to sign in with Google.
 *
 *   3. A PAGE QUIETLY REVERTED to supabase.auth.signInWithOAuth as its only
 *      path — which works, and puts the supabase.co host back on screen, in the
 *      flow a Google reviewer films during OAuth verification.
 *
 *   4. FIRST-LOGIN PROVISIONING SKIPPED. /auth/callback creates the profile
 *      row for a brand-new user. The ID-token flow never visits it unless we
 *      send it there.
 *
 *   Usage:  node scripts/check-google-signin-brand.cjs
 *   Exit 0 = clean. Exit 1 = a finding.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

const IDENTITY = "src/pages/Auth/googleIdentity.js";
const BUTTON = "src/pages/Auth/GoogleSignInButton.jsx";
const PAGES = ["src/pages/Auth/Login.jsx", "src/pages/Auth/Register.jsx"];
const CONTEXT = "src/Context/AuthContext.jsx";

const findings = [];

const identity = read(IDENTITY);
const button = read(BUTTON);
const context = read(CONTEXT);

if (!identity) findings.push(`${IDENTITY} is missing.`);
if (!button) findings.push(`${BUTTON} is missing.`);

// ── 1. Nonce direction ─────────────────────────────────────────────────────
if (button) {
  if (!/nonce:\s*nonce\.hashed/.test(button)) {
    findings.push(
      `${BUTTON}: google.accounts.id.initialize must receive \`nonce.hashed\`.\n`
      + "    Google is given the SHA-256 hash; Supabase is given the raw value.",
    );
  }
  if (!/signInWithGoogleIdToken\([^)]*nonceRef\.current\?\.raw/.test(button)) {
    findings.push(
      `${BUTTON}: signInWithGoogleIdToken must receive the RAW nonce (nonceRef.current?.raw).\n`
      + "    Supabase hashes it and compares to the claim in the token; passing the hash\n"
      + "    fails every sign-in with a nonce mismatch.",
    );
  }
}
if (context && !/signInWithIdToken\(\{[\s\S]{0,120}provider:\s*['"]google['"][\s\S]{0,120}nonce:\s*rawNonce/.test(context)) {
  findings.push(
    `${CONTEXT}: signInWithGoogleIdToken must call supabase.auth.signInWithIdToken with\n`
    + "    provider 'google' and the raw nonce it was given.",
  );
}

// ── 2. The fallback survives every failure path ────────────────────────────
if (button) {
  if (!/if\s*\(\s*mode_\s*===\s*["']fallback["']\s*\)\s*return\s+children/.test(button)) {
    findings.push(
      `${BUTTON}: must render \`children\` (the redirect-flow button) in fallback mode.\n`
      + "    Without it, a blocked Google script leaves no way to sign in with Google.",
    );
  }
  if (!/catch\s*\([^)]*\)\s*\{[\s\S]{0,400}setMode\(["']fallback["']\)/.test(button)) {
    findings.push(`${BUTTON}: a Google Identity load failure must switch to the fallback.`);
  }
  if (!/audience_not_authorised[\s\S]{0,300}setMode\(["']fallback["']\)/.test(button)) {
    findings.push(
      `${BUTTON}: an audience rejection (client ID not authorised in Supabase) must switch\n`
      + "    to the fallback — the redirect flow does not depend on that setting.",
    );
  }
  if (!/useState\(\s*clientId\s*\?\s*["']loading["']\s*:\s*["']fallback["']\s*\)/.test(button)) {
    findings.push(
      `${BUTTON}: with no NEXT_PUBLIC_GOOGLE_CLIENT_ID the component must start in fallback.\n`
      + "    The env var is what makes this safe to deploy before Google and Supabase are\n"
      + "    configured; without the gate, production Google sign-in breaks on push.",
    );
  }
}

// ── 3. Every sign-in page uses it, with the redirect button inside ─────────
for (const page of PAGES) {
  const src = read(page);
  if (!src) {
    findings.push(`${page} is missing.`);
    continue;
  }
  if (!/<GoogleSignInButton[\s\S]*?<\/GoogleSignInButton>/.test(src)) {
    findings.push(
      `${page} does not render <GoogleSignInButton>. Its Google sign-in would go through\n`
      + "    Supabase's redirect only, and the chooser would read the supabase.co host.",
    );
  } else if (!/<GoogleSignInButton[\s\S]*?onClick=\{handleGoogle\}[\s\S]*?<\/GoogleSignInButton>/.test(src)) {
    findings.push(`${page}: the redirect-flow button must stay inside <GoogleSignInButton> as the fallback.`);
  }
}

// ── 4. First-login provisioning still runs ─────────────────────────────────
if (button && !/navigate\(\s*["']\/auth\/callback["']/.test(button)) {
  findings.push(
    `${BUTTON}: after signInWithIdToken it must navigate to /auth/callback.\n`
    + "    That page creates the profile row for a first-time user; the ID-token flow\n"
    + "    never passes through it otherwise, and a new Google user would have no profile.",
  );
}

if (findings.length === 0) {
  console.log("check-google-signin-brand: PASS");
  console.log("  nonce direction correct, fallback on every failure path, both sign-in pages");
  console.log("  wired, and first-login provisioning still runs.");
  process.exit(0);
}

console.error(`check-google-signin-brand: FAIL — ${findings.length} finding(s)\n`);
for (const f of findings) console.error(`  ✗ ${f}\n`);
process.exit(1);
