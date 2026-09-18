#!/usr/bin/env node
/**
 * scheduled-publish-probe.mjs — does a scheduled post actually publish itself?
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * Every YouTube publish so far has been a human pressing a button with the app
 * open. The UNATTENDED path — pg_cron fires process_scheduled_posts(), which
 * calls dispatch_scheduled_post(), which POSTs to publish-post through pg_net
 * with a Vault-held secret — has never been proven end to end. It is also the
 * path with the most ways to fail silently: cron reports success whatever the
 * HTTP response says, so an authentication failure and a successful publish
 * look identical from inside the database.
 *
 * That exact failure already happened here: every function call 401'd for days
 * after the project moved to the new API key system, while the jobs kept
 * "succeeding".
 *
 * ── Why this probe cannot publish anything ──────────────────────────────────
 * It seeds a post with NO MEDIA. The chain still has to work — cron has to see
 * it, dispatch has to authenticate, publish-post has to accept the call and
 * reach the adapter — and then it fails at media validation, which is our own
 * code refusing on purpose. So the probe proves the whole path without ever
 * uploading a video to a real channel.
 *
 * Reading the result:
 *
 *   still `scheduled`         cron is not running, or its match condition
 *                             does not cover this post
 *   `failed`, media error     THE PATH WORKS — cron → dispatch → publish-post
 *                             → adapter, stopping exactly where it should
 *   `failed`, auth error      dispatch cannot authenticate (the 2026-09 defect)
 *   `published`               it published something with no media, which is a
 *                             defect of its own
 *
 *   Usage:  node scripts/security/scheduled-publish-probe.mjs [--wait 240] [--keep]
 *   Exit 0 = the path works. 1 = it does not. 2 = cannot run.
 */

import fs from "node:fs";
import path from "node:path";

const KEEP = process.argv.includes("--keep");
const waitIndex = process.argv.indexOf("--wait");
const WAIT_SECONDS = waitIndex > -1 ? Number(process.argv[waitIndex + 1]) || 240 : 240;

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      if (!env[key]) env[key] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !svc) {
  console.error("FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(2);
}

const headers = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

async function rest(pathname, init = {}) {
  const res = await fetch(`${base}/rest/v1/${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ── 1. An account to schedule against ──────────────────────────────────────

const accounts = await rest(
  "connected_accounts?select=id,user_id,platform,account_name,connection_status,is_mock"
  + "&connection_status=eq.active&is_mock=eq.false&platform=eq.youtube&order=created_at.desc&limit=1",
);

if (!accounts.length) {
  console.error("FATAL: no active, non-mock YouTube account is connected. Nothing to schedule against.");
  process.exit(2);
}

const account = accounts[0];
console.log("scheduled-publish probe");
console.log(`  account: ${account.account_name} (${account.id})\n`);

// ── 2. Seed a post that is due now and carries no media ────────────────────

const scheduledAt = new Date(Date.now() - 60_000).toISOString();
const [post] = await rest("posts", {
  method: "POST",
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({
    user_id: account.user_id,
    account_id: account.id,
    platform: "youtube",
    caption: "__scheduled_publish_probe__",
    status: "scheduled",
    scheduled_at: scheduledAt,
  }),
});

console.log(`  seeded post ${post.id}, due ${scheduledAt}`);
console.log(`  waiting up to ${WAIT_SECONDS}s for the cron job to pick it up…\n`);

// ── 3. Watch it ────────────────────────────────────────────────────────────

const started = Date.now();
let final = null;
let lastSeen = post.status;

// Every observed status is printed, not only the terminal ones. The first run
// of this probe reported "never left scheduled" without ever saying what the
// row actually held — and a trigger silently rewriting the status on insert
// looks exactly the same from outside. A probe that cannot tell those apart is
// only half a probe.
console.log(`  [0s] status = ${lastSeen}`);

while (Date.now() - started < WAIT_SECONDS * 1000) {
  await new Promise((r) => setTimeout(r, 10_000));
  const [current] = await rest(
    `posts?select=id,status,error_message,external_post_id,failed_at,published_at,scheduled_at,account_id`
    + `&id=eq.${post.id}`,
  );
  if (!current) break;

  if (current.status !== lastSeen) {
    console.log(`  [${Math.round((Date.now() - started) / 1000)}s] status -> ${current.status}`);
    lastSeen = current.status;
  }

  if (current.status === "failed" || current.status === "published") {
    final = current;
    break;
  }
}

if (!final) {
  const [stuck] = await rest(
    `posts?select=status,scheduled_at,account_id,platform,error_message&id=eq.${post.id}`,
  );
  console.log(`  final observed row: ${JSON.stringify(stuck)}`);
}

// ── 4. Clean up before judging, so a verdict never leaves a row behind ─────

if (!KEEP) {
  await rest(`posts?id=eq.${post.id}`, { method: "DELETE" });
  console.log("  probe post deleted\n");
} else {
  console.log(`  probe post kept: ${post.id}\n`);
}

// ── 5. Verdict ─────────────────────────────────────────────────────────────

if (!final) {
  console.error("FAIL — the post never left `scheduled`.");
  console.error("       Either pg_cron is not running process_scheduled_posts(), or its match");
  console.error("       condition does not cover this post. Check:");
  console.error("         SELECT jobname, schedule, active FROM cron.job;");
  console.error("         SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;");
  process.exit(1);
}

const message = String(final.error_message || "");
const looksLikeAuth = /401|unauthor|forbidden|invalid.*secret|jwt/i.test(message);
const looksLikeMedia = /media|video file|no video|attach/i.test(message);

if (final.status === "published") {
  console.error("FAIL — it reported PUBLISHED for a post with no media attached.");
  console.error(`       external_post_id: ${final.external_post_id || "(none)"}`);
  console.error("       Either something was uploaded that should not have been, or the status");
  console.error("       is set without the platform confirming. Both are worse than a failure.");
  process.exit(1);
}

if (looksLikeAuth) {
  console.error("FAIL — the dispatch could not authenticate.");
  console.error(`       "${message.slice(0, 200)}"`);
  console.error("       This is the September 2026 defect: pg_cron records success while every");
  console.error("       call is refused. Check the Vault secret and the X-Invoke-Secret header:");
  console.error("         SELECT jobname, command FROM cron.job WHERE command LIKE '%publish%';");
  process.exit(1);
}

if (looksLikeMedia) {
  console.log("PASS — the unattended path works end to end.");
  console.log("  cron saw the post, dispatch authenticated, publish-post accepted the call and");
  console.log("  reached the adapter, which refused it for the one reason it should:");
  console.log(`    "${message.slice(0, 160)}"`);
  console.log("  Nothing was uploaded, by design.");
  process.exit(0);
}

console.error("FAIL — it failed, but for a reason this probe does not recognise.");
console.error(`       "${message.slice(0, 300)}"`);
console.error("       Read it before assuming the path is broken: an unrecognised message is");
console.error("       not the same as a broken chain, but it is not proof of a working one.");
process.exit(1);
