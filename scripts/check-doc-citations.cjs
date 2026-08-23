#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-doc-citations.cjs — the guard for LOCK L-1.6.
 *
 * CLAUDE.md's second law is "Code is the source of truth. Documentation is a
 * claim." It was the only law in that file with no detector behind it, and the
 * corpus grew from the 107 files the audit counted to 264 while the lockdown
 * ran. Docs got staler, and nothing said so.
 *
 * This cannot check whether prose is TRUE — no script can. What it can check is
 * the one claim docs make constantly and mechanically: "this behaviour lives in
 * this file". A citation pointing at a path that does not exist is a claim about
 * the code that the code disproves, and it is the single largest class of
 * staleness here. The 2026-08-22 sweep found docs citing
 * `src/services/freepik.service.js`, `_shared/freepik.service.ts`,
 * `src/config/magnificModels.js`, `supabase/functions/start-generation`,
 * `src/app/` and `src/api/` — every one deleted, every one still confidently
 * cited as where to look.
 *
 * Docs that have been marked "Historical" or "Superseded" are exempt: a record
 * of what a system used to be SHOULD name files that are gone. That exemption
 * is the whole reason the banners exist, and it is what keeps this guard from
 * forcing history to be rewritten.
 *
 *   Usage:  node scripts/check-doc-citations.cjs [--fix-list]
 *   Exit 0 = every citation in a current-state doc resolves.
 *
 * `--fix-list` prints the offenders grouped by file, for triage.
 */
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = process.cwd();
const FIX_LIST = process.argv.includes("--fix-list");

/** A doc that says it is a record of the past may cite the past. */
const EXEMPT_MARKER = /^>\s*\*\*(Historical|Superseded)/m;

/**
 * Directories whose contents are records rather than descriptions of now.
 * `audit/` is a dated snapshot; CHANGELOG records what changed, which means
 * naming what was removed.
 */
const EXEMPT_PATHS = [
  /^audit\//,
  /^CHANGELOG\.md$/,
  /^audit-brief\//,
  /^praise-presentation\//,
  // A filename that declares itself a dated record IS one. These name files as
  // they stood on the day they were written, which is the point of them —
  // forcing a decisions log to be rewritten every time the code moves would
  // destroy the only record of why anything was decided.
  /(^|\/)[^/]*_?(DECISIONS_LOG|SETUP_LOG|AS_IS_AUDIT|DESIGN_SYSTEM_COMPLIANCE|QA_PERSONA_REVIEW)[^/]*\.md$/,
  /(^|\/)[^/]*(IMPLEMENTATION_REPORT|_SIGNOFF|WEEKLY_OBJECTIVE_AUDIT|DEAD_CODE_AUDIT)[^/]*\.md$/,
  // A date in the filename is the author saying "this is a snapshot".
  /\d{4}-\d{2}-\d{2}\.md$/,
  /(^|\/)[^/]*-stage-\d+\.md$/,
  // The index whose job is describing the doc corpus, history included. Its
  // "Historical Material" section necessarily names files that were removed —
  // that is the section telling you they were.
  /^docs\/CANONICAL_DOCS\.md$/,
];

/**
 * Citations look like `src/foo/bar.js` or `supabase/functions/x/index.ts` in
 * backticks. Only paths rooted at a real top-level directory are treated as
 * citations — otherwise every `node_modules/x` and `foo/bar` in prose counts.
 */
const ROOTS = ["src/", "app/", "supabase/", "video-worker/", "scripts/", "tests/", "engineering/", "audit/", "docs/"];
const CITATION = /`([A-Za-z0-9_@./\\[\]-]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|sql|json|css|md|yml|yaml))`/g;

function docs() {
  return cp
    .execSync('git ls-files "*.md"', { encoding: "utf8", cwd: ROOT })
    .trim()
    .split("\n")
    .filter(Boolean);
}

/** A citation may name a file, or a directory, or use a [id] route segment. */
function resolves(citation) {
  const clean = citation.replace(/\\/g, "/").replace(/^\.\//, "");
  if (fs.existsSync(path.join(ROOT, clean))) return true;
  // Next.js dynamic segments and glob-ish suffixes are legitimate in prose.
  if (/\[[^\]]+\]|\*/.test(clean)) return true;
  // Template placeholders are instructions for naming a file, not claims that
  // one exists — e.g. `supabase/migrations/YYYYMMDDHHMMSS_short_snake_description.sql`
  // in the versioning standard.
  if (/YYYY|MMDD|HHMMSS|<[^>]+>|\{[^}]+\}|_short_snake_|example|placeholder/i.test(clean)) return true;
  return false;
}

const offenders = [];
let checkedDocs = 0;
let checkedCitations = 0;

for (const doc of docs()) {
  const rel = doc.replace(/\\/g, "/");
  if (EXEMPT_PATHS.some((re) => re.test(rel))) continue;

  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, doc), "utf8");
  } catch {
    continue;
  }
  if (EXEMPT_MARKER.test(text.slice(0, 1200))) continue;

  checkedDocs += 1;
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  lines.forEach((line, i) => {
    CITATION.lastIndex = 0;
    let m;
    while ((m = CITATION.exec(line)) !== null) {
      const cited = m[1];
      if (!ROOTS.some((r) => cited.startsWith(r))) continue;
      checkedCitations += 1;
      const key = `${rel}|${cited}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!resolves(cited)) offenders.push({ doc: rel, line: i + 1, cited });
    }
  });
}

if (offenders.length > 0) {
  console.error(
    `Doc-citation guardrail failed — ${offenders.length} citation(s) point at files that do not exist,\n`
      + `across ${new Set(offenders.map((o) => o.doc)).size} of ${checkedDocs} current-state doc(s).\n`,
  );
  if (FIX_LIST) {
    const byDoc = new Map();
    for (const o of offenders) {
      if (!byDoc.has(o.doc)) byDoc.set(o.doc, []);
      byDoc.get(o.doc).push(o);
    }
    for (const [doc, items] of [...byDoc].sort((a, b) => b[1].length - a[1].length)) {
      console.error(`  ${doc}  (${items.length})`);
      for (const o of items.slice(0, 8)) console.error(`      :${o.line}  ${o.cited}`);
      if (items.length > 8) console.error(`      ... ${items.length - 8} more`);
    }
  } else {
    for (const o of offenders.slice(0, 40)) console.error(`  ${o.doc}:${o.line}  ${o.cited}`);
    if (offenders.length > 40) console.error(`  ... and ${offenders.length - 40} more (run with --fix-list)`);
  }
  console.error(
    "\nThree ways out, in order of preference:\n"
      + "  1. Repoint the citation at the file that replaced it.\n"
      + "  2. Delete the doc, if what it describes is gone.\n"
      + "  3. Mark it \"> **Historical**\" or \"> **Superseded**\" at the top, if it is a\n"
      + "     record of the past rather than a description of the present.\n"
      + "Do not exempt a doc that is still presented as current — that is the failure\n"
      + "this guard exists to catch.",
  );
  process.exit(1);
}

console.log(
  `Doc-citation guardrail passed — ${checkedCitations} citation(s) across ${checkedDocs} current-state doc(s) all resolve.`,
);
