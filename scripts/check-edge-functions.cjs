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
