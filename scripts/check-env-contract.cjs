#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-env-contract.cjs — the guard for LOCK L6.3.
 *
 * This codebase runs across three environments that nothing connects:
 *
 *   Vercel            Next.js routes and the client bundle
 *   Supabase secrets  51 edge functions
 *   the worker host   the Python clipping worker
 *
 * A variable the code requires but the environment does not set fails at
 * runtime, in production, on whichever request happens to need it first. The
 * audit could not close a number of findings for exactly this reason — the code
 * was readable, the environment was not, so the question stayed open.
 *
 * This closes the offline half: every variable the code reads must be declared
 * in `.env.example`. That file is the contract. It is checked into the repo, it
 * costs nothing to read, and it is the only artefact that can tell somebody
 * setting up a new environment what the code will demand of it.
 *
 * The live half — is the variable actually SET in each environment — needs
 * credentials and network, so it lives in the scheduled `live-invariants` job
 * rather than here. Reconciled by hand 2026-08-22:
 *
 *   Supabase edge secrets: all 4 required present (SUPABASE_URL,
 *   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ZERNIO_API_KEY). Of 15
 *   optional, 3 unset — DEFAULT_AI_MODEL, GROQ_MODEL, RESEND_FROM_EMAIL — and
 *   all three fall back to pinned literals in _shared/llm.ts and _shared/mail.ts,
 *   so unset is a safe state, not a silent one.
 *
 * Run: node scripts/check-env-contract.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

/**
 * Variables the platform provides on its own. Declaring these in .env.example
 * would be wrong — nobody sets them, and listing them invites someone to try.
 */
const PLATFORM_PROVIDED = new Set([
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "NEXT_PUBLIC_VERCEL_ENV",
  "NEXT_RUNTIME",   // Next sets this per runtime inside instrumentation.ts
  "CI",
  // Supabase injects these into every edge function runtime.
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  // The worker host assigns the listen port; main.py falls back to WORKER_PORT.
  "PORT",
]);

/** Set by the test harness, not by a deployment. */
const TEST_ONLY = new Set(["E2E_BASE_URL", "E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_RUN_GENERATION"]);

/**
 * Directories that hold somebody else's code. Their env reads are their own
 * business — the Anthropic SDK reading ANTHROPIC_BEDROCK_BASE_URL is not a
 * contract this repository owes anyone.
 */
const VENDORED = new Set([
  "node_modules", ".next", "__pycache__",
  "venv", ".venv", "env", "site-packages", "dist", "build", ".git",
]);

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (VENDORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** Every variable the code reads, and where it reads it. */
function collectReads() {
  const found = new Map(); // NAME -> Set<"file:line">
  const add = (name, where) => {
    if (!found.has(name)) found.set(name, new Set());
    found.get(name).add(where);
  };

  const patterns = [
    // JS/TS: process.env.NAME, process.env["NAME"]
    /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
    /process\.env\[["'`]([A-Z][A-Z0-9_]{2,})["'`]\]/g,
    // Deno edge functions, direct and through _shared/env.ts
    /Deno\.env\.get\(\s*["'`]([A-Z][A-Z0-9_]{2,})["'`]/g,
    /readEnv\(\s*["'`]([A-Z][A-Z0-9_]{2,})["'`]/g,
    /readOptionalEnv\(\s*["'`]([A-Z][A-Z0-9_]{2,})["'`]/g,
  ];
  const pyPatterns = [
    /os\.environ\.get\(\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
    /os\.getenv\(\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
    /os\.environ\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\]/g,
    // The worker's config is pydantic, so its variables are named in an alias
    // rather than an os.environ call. Missing this made every WORKER_* look
    // dead when config.py reads all of them.
    /alias\s*=\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
  ];

  const jsFiles = [
    ...walk(path.join(ROOT, "src"), [".js", ".jsx", ".ts", ".tsx"]),
    ...walk(path.join(ROOT, "app"), [".js", ".jsx", ".ts", ".tsx"]),
    ...walk(path.join(ROOT, "supabase", "functions"), [".ts"]),
    // Tests read the E2E_* credentials, and are as much a consumer as the app.
    ...walk(path.join(ROOT, "tests"), [".js", ".ts"]),
    // Build-time config lives at the repository root, not under src/ — this is
    // where next.config.mjs reads SENTRY_ORG and the Sentry instrumentation
    // files read NEXT_PUBLIC_SENTRY_DSN. Walking only src/ and app/ made all
    // four look unused.
    ...["next.config.mjs", "instrumentation.ts", "instrumentation-client.ts",
        "sentry.server.config.ts", "sentry.edge.config.ts", "sentry.client.config.ts",
        "playwright.config.cjs"]
      .map((f) => path.join(ROOT, f))
      .filter((f) => fs.existsSync(f)),
  ];
  for (const file of jsFiles) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const re of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) add(m[1], `${rel}:${i + 1}`);
      }
    });
  }

  for (const file of walk(path.join(ROOT, "video-worker"), [".py"])) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const re of pyPatterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) add(m[1], `${rel}:${i + 1}`);
      }
    });
  }

  return found;
}

const examplePath = path.join(ROOT, ".env.example");
if (!fs.existsSync(examplePath)) {
  console.error("Env-contract guardrail failed: .env.example is missing.");
  console.error("It is the only checked-in record of what the code requires of an environment.");
  process.exit(1);
}
const declared = new Set(
  fs
    .readFileSync(examplePath, "utf8")
    .split(/\r?\n/)
    // A commented entry still counts as declared. .env.example deliberately
    // comments out the variables that belong to the WORKER host rather than to
    // this one, and a documented variable is documented whether or not this
    // environment sets it. The contract is "somebody wrote down that the code
    // needs this", not "this machine provides it".
    .map((l) => (/^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=/.exec(l) || [])[1])
    .filter(Boolean),
);

const reads = collectReads();
const undeclared = [];
for (const [name, where] of reads) {
  if (declared.has(name) || PLATFORM_PROVIDED.has(name) || TEST_ONLY.has(name)) continue;
  undeclared.push({ name, where: [...where].slice(0, 3) });
}
undeclared.sort((a, b) => a.name.localeCompare(b.name));

if (undeclared.length > 0) {
  console.error(
    `Env-contract guardrail failed — ${undeclared.length} variable(s) read by the code but absent from .env.example:\n`,
  );
  for (const item of undeclared) {
    console.error(`  ${item.name}`);
    for (const w of item.where) console.error(`      ${w}`);
  }
  console.error("\nAdd them to .env.example (with a placeholder, never a real value), or stop reading them.");
  console.error("An undeclared variable is a production failure waiting for the first request that needs it.");
  process.exit(1);
}

// ── And the other direction: declared, but read by nothing ──────────────────
// A key that nothing reads is not harmless. It is a live credential to a paid
// service that no failure would ever surface: steal it, and nothing in this
// product breaks, so nothing alerts. Seven of them were sitting in the Supabase
// edge secrets on 2026-08-22 — Grok (twice), Freepik, Gemini, Magnific,
// Pollinations and Replicate — for providers the code stopped calling long ago.
// Every generation on record used fal-ai.
//
// Declaring a variable here is how somebody learns to go and set it, so a stale
// declaration actively recruits new copies of a key nobody needs.
const IMPLICIT = new Set([
  // Read by tooling rather than by this repository's own source.
  "SENTRY_AUTH_TOKEN", // @sentry/nextjs reads it from the env for source-map upload
  "DATABASE_URL", // psql / migration tooling
  "CRON_SECRET", // asserted by pg_cron job bodies, which live in the database
]);

const unread = [];
for (const name of declared) {
  if (reads.has(name) || IMPLICIT.has(name) || TEST_ONLY.has(name)) continue;
  // WORKER_* names contain their unprefixed twin; treat a prefixed read as
  // covering only the prefixed name.
  if ([...reads.keys()].some((r) => r === name)) continue;
  unread.push(name);
}
unread.sort();

if (unread.length > 0) {
  console.error(
    `Env-contract guardrail failed — ${unread.length} variable(s) declared in .env.example that nothing reads:\n`,
  );
  for (const name of unread) console.error(`  ${name}`);
  console.error(
    "\nEither the code that used them is gone (delete the declaration, and the key\n"
      + "from every environment that holds it), or they are read by tooling rather\n"
      + "than source (add them to IMPLICIT above, with a note saying what reads them).\n"
      + "A credential nothing reads is one whose theft nothing would reveal.",
  );
  process.exit(1);
}

console.log(
  `Env-contract guardrail passed — ${reads.size} read, ${declared.size} declared, no drift in either direction.`,
);
