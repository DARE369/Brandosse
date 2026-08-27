#!/usr/bin/env node
/**
 * LOCK L5.6 / L5.7 — the app chrome has exactly one definition.
 *
 * ── The defect this guards ──────────────────────────────────────────────────
 * Twice now the same thing has happened. Nine pages each declared their own
 * `NAV_ITEMS` and drifted until five showed Analytics and four did not (L5.7).
 * Ten pages each hand-wrote the `<AppHeader>` block and defined an identical
 * `ThemeToggleButton`, and drifted the same way (L5.6): Calendar rendered
 * nothing where every other page rendered a credit skeleton, Billing pinned
 * its credit meter to `pct="100%"` over a real balance, and Brand Kit shipped
 * a bare `Avatar` where every other page had the full `AvatarMenu`.
 *
 * Nobody chose any of that. It is what N copies of the same block do over time.
 *
 * L5.6 introduced `ui-v2/shell/AppShell` to end it, then applied it to only the
 * four pages it happened to be migrating — leaving the ten originals as they
 * were, and no guard. This is that guard.
 *
 * Usage: node scripts/check-app-shell.cjs
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/** The one file allowed to define the nav. */
const NAV_SOURCE = "src/ui-v2/shell/navItems.js";
/** The one file allowed to define the theme switch. */
const TOGGLE_SOURCE = "src/ui-v2/shell/ThemeToggleButton.jsx";
/** Chrome components only the shell may render. */
const SHELL_ONLY = ["AppHeader", "MobileNavDrawer", "NotificationBell", "AvatarMenu", "CreditPill"];

/**
 * Personal routes that legitimately render no app chrome, each with the reason.
 * A route may only be added here with one — "it doesn't use AppShell" is not a
 * reason, it is the thing being checked.
 */
const NO_CHROME_ROUTES = {
  "app/app/page.jsx": "pure redirect to /app/dashboard — renders no UI",
  "app/app/profile/page.jsx": "pure redirect to /app/settings — renders no UI",
  "app/app/onboarding/page.jsx": "first-run wizard: full nav before setup is complete would let a user skip into a half-configured app",
  "app/app/settings/connect/page.jsx": "OAuth connect wizard: navigating away mid-flow strands a half-linked account",
  "app/app/design/page.jsx": "internal design reference, not a user-facing route",
  "app/app/video/new/page.jsx": "pure redirect to /app/video/jobs?new=1 — submitting is a sheet over the job list now, because every number the form needs (slots, hourly usage, balance) lives on the list behind it",
};

/** Surfaces with their own separate shells, out of scope for the personal one. */
const OUT_OF_SCOPE = ["app/app/admin/", "app/app/org/"];

const violations = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── 1. one nav, one toggle, one set of chrome components ────────────────────
for (const file of walk(path.join(ROOT, "src"))) {
  if (!/\.(jsx?|tsx?)$/.test(file)) continue;
  const r = rel(file);
  const code = stripComments(fs.readFileSync(file, "utf8"));

  if (r !== NAV_SOURCE && /\bNAV_ITEMS\s*=/.test(code)) {
    violations.push(`${r}: declares NAV_ITEMS. The nav is defined once, in ${NAV_SOURCE}.`);
  }

  if (r !== TOGGLE_SOURCE && /function\s+ThemeToggleButton\s*\(/.test(code)) {
    violations.push(`${r}: defines ThemeToggleButton. Import it from ui-v2 instead — ${TOGGLE_SOURCE}.`);
  }

  // The org surface has its own shell; only the personal one is locked here.
  if (r.startsWith("src/ui-v2/shell/") || r.startsWith("src/org/") || r.startsWith("src/admin/")) continue;

  for (const component of SHELL_ONLY) {
    // No backslash classes here: a template literal would eat the escape.
    if (new RegExp("<" + component + "(?![A-Za-z0-9_])").test(code)) {
      violations.push(`${r}: renders <${component}> directly. Pages compose chrome through <AppShell>, not piece by piece.`);
    }
  }
}

// ── 2. every personal route actually reaches the shell ──────────────────────
const IMPORT_RE = /import\s+(?:\w+)\s+from\s+["']([^"']+)["']/g;

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  for (const candidate of [base, base + ".jsx", base + ".js", base + ".tsx", base + ".ts",
                           path.join(base, "index.jsx"), path.join(base, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Does this component reach AppShell, directly or through what it renders? */
function reachesShell(file, depth = 0, seen = new Set()) {
  if (depth > 3 || seen.has(file)) return false;
  seen.add(file);
  const code = stripComments(fs.readFileSync(file, "utf8"));
  if (/\bAppShell\b/.test(code)) return true;

  IMPORT_RE.lastIndex = 0;
  let m;
  const targets = [];
  while ((m = IMPORT_RE.exec(code))) targets.push(m[1]);
  for (const spec of targets) {
    const resolved = resolveImport(file, spec);
    if (resolved && /\.(jsx|tsx)$/.test(resolved) && reachesShell(resolved, depth + 1, seen)) return true;
  }
  return false;
}

for (const file of walk(path.join(ROOT, "app", "app"))) {
  if (path.basename(file) !== "page.jsx") continue;
  const r = rel(file);
  if (OUT_OF_SCOPE.some((prefix) => r.startsWith(prefix))) continue;
  if (r in NO_CHROME_ROUTES) continue;

  if (!reachesShell(file)) {
    violations.push(
      `${r}: renders no <AppShell>. Every personal route carries the app chrome, ` +
      `or is listed in NO_CHROME_ROUTES with a reason.`
    );
  }
}

if (violations.length) {
  console.error("❌ App chrome is not centralised:\n");
  for (const v of violations) console.error("  " + v);
  console.error("\nSee src/ui-v2/shell/AppShell.jsx.");
  process.exit(1);
}

console.log("✅ App chrome centralised: one nav, one theme toggle, every personal route on AppShell.");
