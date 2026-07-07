#!/usr/bin/env node
/**
 * Enforces the anti-regression rule from the 2026-07-05 design-system-v2
 * rewrite: nothing under src/ui-v2/** may import old UI (any other path in
 * the repo). Business-logic imports (services/hooks/stores) are fine for
 * pages that USE ui-v2 components, but ui-v2 itself must stay presentation
 * only and self-contained.
 *
 * Usage: node scripts/check-ui-v2-isolation.cjs
 * Exit code 1 + printed violations if anything under src/ui-v2 imports a
 * path outside src/ui-v2 (other than react/react-dom/next/node built-ins).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UI_V2_DIR = path.join(ROOT, "src", "ui-v2");

const ALLOWED_BARE_PREFIXES = ["react", "react-dom", "next"];
const CODE_EXT = new Set([".js", ".jsx", ".ts", ".tsx"]);

const IMPORT_RE = /\bfrom\s+["']([^"']+)["']/g;
const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const CSS_IMPORT_RE = /@import\s+["']([^"']+)["']/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function isViolation(specifier) {
  if (specifier.startsWith(".")) {
    // relative import — violation only if it resolves outside ui-v2
    return specifier.split("/").filter((s) => s === "..").length > 0 &&
      !specifier.startsWith("./"); // conservative: any ".." segment gets flagged below by resolution check
  }
  return false;
}

function resolvesOutsideUiV2(fileDir, specifier) {
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(fileDir, specifier);
    return !resolved.startsWith(UI_V2_DIR);
  }
  if (specifier.startsWith("@/")) {
    return !specifier.startsWith("@/ui-v2");
  }
  if (specifier.startsWith("@/../") || specifier.startsWith("src/")) {
    return !specifier.startsWith("src/ui-v2");
  }
  // bare package specifier
  return !ALLOWED_BARE_PREFIXES.some((p) => specifier === p || specifier.startsWith(p + "/"));
}

function main() {
  if (!fs.existsSync(UI_V2_DIR)) {
    console.log("src/ui-v2 does not exist yet — nothing to check.");
    return;
  }

  const files = walk(UI_V2_DIR);
  const violations = [];

  for (const file of files) {
    const ext = path.extname(file);
    const rel = path.relative(ROOT, file);
    const content = fs.readFileSync(file, "utf8");
    const fileDir = path.dirname(file);

    if (CODE_EXT.has(ext)) {
      for (const re of [IMPORT_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE]) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(content))) {
          const specifier = match[1];
          if (resolvesOutsideUiV2(fileDir, specifier)) {
            violations.push(`${rel}: imports "${specifier}"`);
          }
        }
      }
    } else if (ext === ".css") {
      CSS_IMPORT_RE.lastIndex = 0;
      let match;
      while ((match = CSS_IMPORT_RE.exec(content))) {
        const specifier = match[1];
        if (resolvesOutsideUiV2(fileDir, specifier)) {
          violations.push(`${rel}: @import "${specifier}"`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("❌ src/ui-v2 isolation violated:\n");
    for (const v of violations) console.error("  " + v);
    console.error("\nsrc/ui-v2 must not import anything outside itself (except react/next). See src/ui-v2/README.md.");
    process.exit(1);
  }

  console.log(`✅ src/ui-v2 isolation OK (${files.length} files checked).`);
}

main();
