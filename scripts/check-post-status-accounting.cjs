#!/usr/bin/env node
/**
 * LOCK L2.5 — the dashboard's status summary accounts for every post.
 *
 * ── The defect this guards ──────────────────────────────────────────────────
 * The Content Flow panel counted four statuses (draft, scheduled, published,
 * failed) out of the six in POST_STATUS. `publishing` was missing, so a QA user
 * with 110 posts was shown 107 and had no way to learn that three were stuck
 * mid-publish — the audit found them stranded for up to four months.
 *
 * The failure mode is not "someone forgot publishing". It is that the panel had
 * no relationship to the enum at all: statuses were hand-listed, so the panel
 * could drift the moment a status was added. This guard ties them together.
 *
 * Checks:
 *   1. Every POST_STATUS value is counted by useDashboardData.
 *   2. The hook reconciles its buckets against an unfiltered total, so a status
 *      added tomorrow surfaces as "unaccounted" instead of vanishing.
 *   3. The dashboard renders a bucket for every status the hook exposes.
 *
 * Usage: node scripts/check-post-status-accounting.cjs
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const STATUSES_FILE = "src/constants/statuses.js";
const HOOK_FILE = "src/hooks/useDashboardData.js";
const PANEL_FILE = "src/pages/Dashboard/PersonalDashboardPage.jsx";

const problems = [];

// ── 1. read the enum, so this guard can never drift from it ─────────────────
const statusesSrc = read(STATUSES_FILE);
const block = statusesSrc.match(/export const POST_STATUS = \{([\s\S]*?)\};/);
if (!block) {
  console.error(`❌ Could not find POST_STATUS in ${STATUSES_FILE}.`);
  process.exit(1);
}
const keys = [...block[1].matchAll(/^\s*([A-Z_]+)\s*:/gm)].map((m) => m[1]);
if (keys.length === 0) {
  console.error(`❌ POST_STATUS in ${STATUSES_FILE} parsed as empty.`);
  process.exit(1);
}

// ── 2. the hook counts each one ─────────────────────────────────────────────
const hookSrc = read(HOOK_FILE);
for (const key of keys) {
  if (!hookSrc.includes(`postCount(POST_STATUS.${key})`)) {
    problems.push(
      `${HOOK_FILE}: POST_STATUS.${key} is never counted. ` +
      `Every status a post can hold must appear in the dashboard's totals.`
    );
  }
}

// ── 3. the hook reconciles against an unfiltered total ──────────────────────
for (const [needle, why] of [
  ["allPostsCount", "the unfiltered total the buckets are checked against"],
  ["unaccountedPosts", "the remainder bucket that catches a status this file does not know about"],
]) {
  if (!hookSrc.includes(needle)) {
    problems.push(`${HOOK_FILE}: lost ${needle} — ${why}.`);
  }
}

// ── 4. the panel renders what the hook produces ─────────────────────────────
const panelSrc = read(PANEL_FILE);
const funnel = panelSrc.match(/const funnel = \[([\s\S]*?)\n  \];/);
if (!funnel) {
  problems.push(`${PANEL_FILE}: could not find the Content Flow funnel array.`);
} else {
  const rendered = funnel[1];
  const statField = {
    DRAFT: "stats.drafts",
    SCHEDULED: "stats.scheduledPosts",
    PUBLISHING: "stats.publishingPosts",
    PUBLISHED: "stats.publishedPosts",
    FAILED: "stats.failedPosts",
    ARCHIVED: "stats.archivedPosts",
  };
  for (const key of keys) {
    const field = statField[key];
    if (!field) {
      problems.push(
        `${PANEL_FILE}: POST_STATUS.${key} is new — add it to the funnel and to ` +
        `statField in this guard, so it is counted AND shown.`
      );
    } else if (!rendered.includes(field)) {
      problems.push(`${PANEL_FILE}: the funnel does not render ${field} (POST_STATUS.${key}).`);
    }
  }
  if (!rendered.includes("stats.unaccountedPosts")) {
    problems.push(`${PANEL_FILE}: the funnel drops stats.unaccountedPosts — unrecognised posts would vanish from the total again.`);
  }
}

if (problems.length) {
  console.error("❌ Post-status accounting is incomplete:\n");
  for (const p of problems) console.error("  " + p);
  console.error("\nSee LOCK L2.5 in src/hooks/useDashboardData.js.");
  process.exit(1);
}

console.log(`✅ Post-status accounting complete: all ${keys.length} POST_STATUS values counted and rendered.`);
