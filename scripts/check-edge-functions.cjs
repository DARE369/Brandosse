#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const functionsDir = path.join(root, "supabase", "functions");
const envExamplePath = path.join(root, ".env.example");
const strict = process.env.EDGE_FUNCTIONS_STRICT === "1" || process.argv.includes("--strict");

const ignoredDirs = new Set(["_shared"]);
const tsFiles = [];
const findings = [];
const warnings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      tsFiles.push(fullPath);
    }
  }
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function resolveLocalImport(file, specifier) {
  const base = path.resolve(path.dirname(file), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

if (!fs.existsSync(functionsDir)) {
  console.error("supabase/functions does not exist.");
  process.exit(1);
}

walk(functionsDir);

for (const entry of fs.readdirSync(functionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || ignoredDirs.has(entry.name)) continue;
  const indexPath = path.join(functionsDir, entry.name, "index.ts");
  if (!fs.existsSync(indexPath)) {
    warnings.push(`${entry.name}: missing index.ts entrypoint`);
  }
}

const envExample = fs.existsSync(envExamplePath)
  ? fs.readFileSync(envExamplePath, "utf8")
  : "";
const documentedEnv = new Set([...envExample.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)].map((match) => match[0]));
const envRefs = new Map();

for (const file of tsFiles) {
  const source = fs.readFileSync(file, "utf8");
  const importRegex = /\bfrom\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let importMatch;
  while ((importMatch = importRegex.exec(source))) {
    const specifier = importMatch[1] || importMatch[2];
    if (!specifier || !specifier.startsWith(".")) continue;
    if (!resolveLocalImport(file, specifier)) {
      findings.push(`${rel(file)} imports missing local module: ${specifier}`);
    }
  }

  const envRegex = /(?:readEnv|readOptionalEnv)\(\s*["']([A-Z0-9_]+)["']|Deno\.env\.get\(\s*["']([A-Z0-9_]+)["']\s*\)/g;
  let envMatch;
  while ((envMatch = envRegex.exec(source))) {
    const name = envMatch[1] || envMatch[2];
    if (!name) continue;
    if (!envRefs.has(name)) envRefs.set(name, new Set());
    envRefs.get(name).add(rel(file));
  }
}

const undocumented = [...envRefs.keys()]
  .filter((name) => !documentedEnv.has(name))
  .sort();

for (const name of undocumented) {
  const files = [...envRefs.get(name)].slice(0, 4).join(", ");
  warnings.push(`${name} is referenced by edge functions but not documented in .env.example (${files})`);
}

console.log("Supabase edge function static check");
console.log(`TypeScript files scanned: ${tsFiles.length}`);
console.log(`Environment variables referenced: ${envRefs.size}`);

if (warnings.length > 0) {
  console.log(`\nWarnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 30)) {
    console.log(`  - ${warning}`);
  }
  if (warnings.length > 30) {
    console.log(`  ... ${warnings.length - 30} more`);
  }
}

// ── Caller auth must not use the service-role key ───────────────────────────
//
// For weeks every scheduled invocation in this product returned 401 and nothing
// reported it. pg_cron records a job as having run because issuing the HTTP
// request IS the job; a 401 in the response body is not a failed run.
//
// The cause (2026-09-10): this project has Supabase's new API key system, so the
// edge runtime is injected with `sb_secret_…` as SUPABASE_SERVICE_ROLE_KEY while
// every caller still sent the legacy service_role JWT. PostgREST accepted that
// JWT, so only the functions broke.
//
// The underlying mistake was using a DATABASE CREDENTIAL as an RPC password.
// Caller auth now uses FUNCTION_INVOKE_SECRET via requireInvokeSecret();
// SUPABASE_SERVICE_ROLE_KEY is for createAdminClient() and nothing else.
//
// This fails if anyone reintroduces the old pattern — comparing the incoming
// Authorization header against the service-role key.
for (const file of tsFiles) {
  const source = fs.readFileSync(file, 'utf8');

  if (/requireServiceRole\s*\(/.test(source)) {
    findings.push(
      `${rel(file)} calls requireServiceRole(). That check compared the caller's ` +
      'Authorization header against SUPABASE_SERVICE_ROLE_KEY, which the runtime no ' +
      'longer holds. Use requireInvokeSecret() from _shared/connectionHelpers.ts.',
    );
  }

  // The shape of the old bug: the request's own Authorization header tested
  // against the service-role key, in any spelling.
  const comparesAuthToServiceRole =
    /headers\.get\(\s*["'`]Authorization["'`]\s*\)[\s\S]{0,120}SUPABASE_SERVICE_ROLE_KEY/i.test(source)
    || /SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,120}headers\.get\(\s*["'`]Authorization["'`]\s*\)/i.test(source);

  if (comparesAuthToServiceRole) {
    findings.push(
      `${rel(file)} compares the incoming Authorization header against ` +
      'SUPABASE_SERVICE_ROLE_KEY. That is the defect that silently disabled every ' +
      'cron in this product. Caller auth belongs to FUNCTION_INVOKE_SECRET ' +
      '(X-Invoke-Secret header); the service-role key is for database access only.',
    );
  }
}

if (findings.length > 0) {
  console.error(`\nFailures: ${findings.length}`);
  for (const finding of findings) {
    console.error(`  - ${finding}`);
  }
  process.exit(1);
}

if (strict && warnings.length > 0) {
  console.error("\nStrict mode failed because warnings are present.");
  process.exit(1);
}

console.log("\nEdge function static check passed.");
