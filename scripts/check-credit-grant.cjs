#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-credit-grant.cjs — the guard for the signup credit promise (LOCK L5.15).
 *
 * The signup page and the landing page tell people how many free credits they
 * get. The database decides how many they actually get. Nothing connected those
 * two facts, so they drifted: the UI said 100, the trigger granted 30, and a new
 * user watched the promise break in the header within seconds of signing up.
 *
 * This asserts the number the UI promises is the number the schema grants.
 * It is deliberately static — no network, no credentials — so it runs in CI on
 * every push. The behavioural half (does a real signup actually receive it?)
 * lives in tests/e2e/time-to-first-value.spec.js.
 *
 * If you want to change the free grant: change the trigger in a new migration,
 * apply it, then change SIGNUP_CREDIT_GRANT. In that order — this guard exists
 * to stop the promise moving before the product does.
 *
 * Run: node scripts/check-credit-grant.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const CONSTANT_FILE = path.join(ROOT, "src/constants/credits.js");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

function fail(message) {
  console.error(`Credit-grant guardrail failed.\n\n${message}`);
  process.exit(1);
}

// ── 1. What the product promises ────────────────────────────────────────────
if (!fs.existsSync(CONSTANT_FILE)) {
  fail(`Missing ${path.relative(ROOT, CONSTANT_FILE)} — the single source of truth for the signup grant.`);
}
const constantSource = fs.readFileSync(CONSTANT_FILE, "utf8");
const declared = /export const SIGNUP_CREDIT_GRANT\s*=\s*(\d+)/.exec(constantSource);
if (!declared) {
  fail("Could not find `export const SIGNUP_CREDIT_GRANT = <number>` in src/constants/credits.js.");
}
const promised = Number(declared[1]);

// ── 2. What the schema actually grants ──────────────────────────────────────
// The newest migration that defines handle_new_user_credits() wins, since a
// later migration replaces the function.
const migrationFiles = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let granted = null;
let grantedIn = null;
for (const file of migrationFiles) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
  if (!/FUNCTION\s+public\.handle_new_user_credits/i.test(sql)) continue;
  // INSERT INTO public.user_credits (user_id, balance) VALUES (NEW.id, 30)
  const match = /INSERT\s+INTO\s+public\.user_credits[^;]*?VALUES\s*\(\s*NEW\.id\s*,\s*(\d+)/is.exec(sql);
  if (match) {
    granted = Number(match[1]);
    grantedIn = file;
  }
}

if (granted === null) {
  fail(
    "Could not find the credit grant in any migration.\n" +
      "Expected handle_new_user_credits() to INSERT INTO public.user_credits ... VALUES (NEW.id, <n>).\n" +
      "If the grant moved somewhere else, point this guard at it — do not delete the check.",
  );
}

// ── 3. They must agree ──────────────────────────────────────────────────────
if (promised !== granted) {
  fail(
    `The signup page promises ${promised} credits. The database grants ${granted}.\n\n` +
      `  promised : src/constants/credits.js (SIGNUP_CREDIT_GRANT = ${promised})\n` +
      `  granted  : supabase/migrations/${grantedIn} (handle_new_user_credits -> ${granted})\n\n` +
      "A new account will see the real number in the header within seconds of signing up.\n" +
      "Either raise the grant in a new migration, or lower the promise — but they cannot differ.",
  );
}

// ── 4. And nobody may hardcode it back into the copy ────────────────────────
const COPY_FILES = ["src/pages/Auth/Register.jsx", "src/pages/Landing/LandingPage.jsx"];
const hardcoded = [];
for (const rel of COPY_FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  fs.readFileSync(full, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/\b\d+\s+free\s+(AI\s+)?credits/i.test(line)) {
        hardcoded.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    });
}
if (hardcoded.length > 0) {
  fail(
    "Free-credit count hardcoded back into marketing copy — import SIGNUP_CREDIT_GRANT instead:\n\n" +
      hardcoded.map((h) => `  ${h}`).join("\n") +
      "\n\nThis is exactly how the UI and the database drifted apart the first time.",
  );
}

console.log(
  `Credit-grant guardrail passed — promise and schema agree at ${promised} credits (${grantedIn}).`,
);
