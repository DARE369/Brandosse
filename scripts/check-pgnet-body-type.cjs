#!/usr/bin/env node
/**
 * check-pgnet-body-type.cjs
 *
 * pg_net's http_post takes a JSONB body. Passing text raises
 *
 *   ERROR: function net.http_post(url => text, headers => jsonb, body => text)
 *          does not exist
 *
 * at RUNTIME — never at deploy time, because a plpgsql function body is not
 * resolved until it executes.
 *
 * ── Why this guard exists ───────────────────────────────────────────────────
 * This exact defect has shipped TWICE.
 *
 *   2026-07-10  The first real run of process-scheduled-posts fails on it.
 *               Fixed by 20260710160000, whose header notes the bug "existed in
 *               the source from the start and was only caught now because the
 *               function had never actually executed before today".
 *
 *   2026-09-10  20260910130000 rewrites dispatch_scheduled_post to add the
 *               X-Invoke-Secret header and reintroduces the ::text cast.
 *               Scheduled publishing dies again, silently: the exception
 *               unwinds the cron transaction, the post returns to `scheduled`,
 *               and it is retried every minute forever with nothing surfaced to
 *               the user. Found 2026-09-18 by
 *               scripts/security/scheduled-publish-probe.mjs, eight days later.
 *               Fixed by 20260918120000.
 *
 * Both times the broken and working versions differed by one cast. Both times
 * it was invisible until a post was actually scheduled. That is precisely the
 * shape a static check catches for free.
 *
 *   Usage:  node scripts/check-pgnet-body-type.cjs
 *   Exit 0 = clean. Exit 1 = a finding.
 */

const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/**
 * The migrations that shipped the defect. They are applied history and are not
 * rewritten; each is superseded by a later migration that fixes it. Listed so
 * the guard stays useful instead of failing on the past.
 */
const KNOWN_HISTORIC = new Set([
  // Never applied (superseded before it ran), but carries the original cast.
  "20260601000000_scheduled_publish_worker.sql",
  // Carried it over; fixed by 20260710160000.
  "20260710120000_vault_based_cron_secrets.sql",
  // Reintroduced it; fixed by 20260918120000.
  "20260910130000_dispatch_scheduled_post_invoke_secret.sql",
]);

const findings = [];

for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

  // Each net.http_post(...) call, taken up to the closing parenthesis of its
  // argument list. Nested parentheses are common (jsonb_build_object), so the
  // scan counts depth rather than matching a naive pattern.
  let index = sql.indexOf("net.http_post(");
  while (index !== -1) {
    let depth = 0;
    let end = index + "net.http_post".length;
    for (; end < sql.length; end += 1) {
      if (sql[end] === "(") depth += 1;
      else if (sql[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    const call = sql.slice(index, end + 1);
    const line = sql.slice(0, index).split("\n").length;

    // The body argument, scanned at PAREN DEPTH rather than by pattern.
    //
    // A naive match reports every correct call as broken, because the last
    // entry inside jsonb_build_object is itself `p_organization_id::text` — a
    // per-VALUE cast, which is required and correct. What matters is whether
    // the whole expression is cast, i.e. a ::text sitting at depth 0 after the
    // object's closing parenthesis. Only a depth-aware scan can tell the two
    // apart, and getting this wrong in either direction makes the guard
    // worthless: noisy, or silent.
    const bodyKey = call.search(/\bbody\s*:=/);
    if (bodyKey !== -1) {
      let cursor = call.indexOf(":=", bodyKey) + 2;
      let depth = 0;
      let expression = "";

      for (; cursor < call.length; cursor += 1) {
        const ch = call[cursor];
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          if (depth === 0) break; // the call's own closing parenthesis
          depth -= 1;
        } else if (ch === "," && depth === 0) {
          break; // next named argument
        }
        expression += ch;
      }

      const body = expression.trim();
      const castToText = /::\s*text$/i.test(body);

      if (castToText && !KNOWN_HISTORIC.has(file)) {
        findings.push(
          `${file}:${line} passes a TEXT body to net.http_post.\n`
          + "    pg_net's body parameter is jsonb. This resolves at runtime, not at deploy\n"
          + "    time, so the migration applies cleanly and the call raises every time it\n"
          + "    runs — unwinding the caller's transaction with it.\n"
          + "    This exact defect killed scheduled publishing in July 2026 and again in\n"
          + "    September 2026. Drop the ::text cast.",
        );
      }
    }

    index = sql.indexOf("net.http_post(", end);
  }
}

// The fix must still be present: a guard that only bans the bad pattern would
// pass on a tree where the repair had been reverted.
const fixFile = path.join(MIGRATIONS_DIR, "20260918120000_dispatch_body_is_jsonb.sql");
if (!fs.existsSync(fixFile)) {
  findings.push(
    "20260918120000_dispatch_body_is_jsonb.sql is missing — the migration that repairs\n"
    + "    dispatch_scheduled_post. Without it the live function keeps the text cast, and\n"
    + "    scheduled posts never publish.",
  );
}

if (findings.length === 0) {
  console.log("check-pgnet-body-type: PASS");
  console.log("  every net.http_post call passes a jsonb body.");
  process.exit(0);
}

console.error(`check-pgnet-body-type: FAIL — ${findings.length} finding(s)\n`);
for (const f of findings) console.error(`  ${f}\n`);
console.error("  Verify the live behaviour, not just the text:");
console.error("    node scripts/security/scheduled-publish-probe.mjs");
process.exit(1);
