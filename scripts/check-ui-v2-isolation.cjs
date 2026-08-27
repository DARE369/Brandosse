#!/usr/bin/env node
/**
 * Enforces the anti-regression rule from the 2026-07-05 design-system-v2
 * rewrite: nothing under src/ui-v2/** may import old *presentation* code —
 * src/components/**, src/styles/**, src/legacy/**, src/calendar/**,
 * src/org/**, or any stylesheet outside ui-v2. That is the rule README.md
 * states, and the one that matters: v2 must not inherit v1's look.
 *
 * -- Why there is an allowlist --------------------------------------------
 * This guard used to reject EVERY import outside src/ui-v2, which is stricter
 * than the rule it was written to enforce. It went red the moment ui-v2 grew a
 * shell: AppShell needs the auth/navigation contexts and the credit balance,
 * AvatarMenu needs useLogout, NotificationBell needs useUserNotifications and
 * lucide-react. Those are business logic and a third-party icon set, not old
 * UI. A permanently-red guard is not a guard — it stops being read, and the
 * next real violation lands underneath the noise.
 *
 * So: presentation imports are hard-blocked, and the small set of
 * business-logic modules the shell genuinely needs is listed explicitly below.
 * Adding to that list should require justifying it in review; that friction is
 * the point. Anything not listed and not internal to ui-v2 still fails.
 *
 * Usage: node scripts/check-ui-v2-isolation.cjs
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UI_V2_DIR = path.join(ROOT, "src", "ui-v2");

const ALLOWED_BARE_PREFIXES = ["react", "react-dom", "next", "lucide-react"];

/**
 * Business-logic modules the ui-v2 shell may reach for, by exact path.
 * Presentation is NOT on this list and never should be.
 */
const ALLOWED_INTERNAL = new Set([
  "src/Context/AuthContext",
  "src/Context/AppNavigationContext",
  "src/hooks/useCreditBalance",
  "src/hooks/useLogout",
  "src/hooks/useUserNotifications",
  // Count of clipping jobs in flight, shown as a badge on the Videos nav entry.
  // Justification, since this list is meant to be argued for: clipping is the
  // only work in the product that runs for minutes with the user elsewhere, and
  // without a signal in the chrome the product goes silent about it the moment
  // they navigate away. It is a head-only count query plus a realtime
  // subscription — business logic, no presentation, same shape as
  // useCreditBalance directly above.
  "src/hooks/video-engine/useActiveJobCount",
]);

/** Old presentation. Importing any of these from ui-v2 is the actual defect. */
const FORBIDDEN_ROOTS = ["src/components/", "src/styles/", "src/legacy/", "src/calendar/", "src/org/"];
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


/** Normalise a specifier to a repo-relative "src/..." path, or null if it is a package. */
function toRepoPath(fileDir, specifier) {
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(fileDir, specifier);
    return path.relative(ROOT, resolved).split(path.sep).join("/");
  }
  if (specifier.startsWith("@/")) return "src/" + specifier.slice(2);
  if (specifier.startsWith("src/")) return specifier;
  return null;
}

/**
 * Returns a violation reason, or null if the import is permitted.
 * `cssOnly` keeps the old strict rule for stylesheets: a v2 stylesheet has no
 * business-logic excuse for reaching outside ui-v2.
 */
function violationReason(fileDir, specifier, cssOnly) {
  const repoPath = toRepoPath(fileDir, specifier);

  if (repoPath === null) {
    if (cssOnly) return "stylesheet imports a package";
    return ALLOWED_BARE_PREFIXES.some((p) => specifier === p || specifier.startsWith(p + "/"))
      ? null
      : "package not on the allowlist";
  }

  if (repoPath.startsWith("src/ui-v2")) return null;
  if (cssOnly) return "stylesheet imports outside ui-v2";

  const forbidden = FORBIDDEN_ROOTS.find((root) => repoPath.startsWith(root));
  if (forbidden) return "old presentation code (" + forbidden + "*) — the rule ui-v2 exists to enforce";

  const withoutExt = repoPath.replace(/\.(jsx?|tsx?)$/, "");
  if (ALLOWED_INTERNAL.has(withoutExt)) return null;

  return "not on the business-logic allowlist (see ALLOWED_INTERNAL in this file)";
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
          const reason = violationReason(fileDir, specifier, false);
          if (reason) {
            violations.push(`${rel}: imports "${specifier}" — ${reason}`);
          }
        }
      }
    } else if (ext === ".css") {
      CSS_IMPORT_RE.lastIndex = 0;
      let match;
      while ((match = CSS_IMPORT_RE.exec(content))) {
        const specifier = match[1];
        const reason = violationReason(fileDir, specifier, true);
        if (reason) {
          violations.push(`${rel}: @import "${specifier}" — ${reason}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("❌ src/ui-v2 isolation violated:\n");
    for (const v of violations) console.error("  " + v);
    console.error("\nsrc/ui-v2 must not import old presentation code, and may only reach the business-logic modules allowlisted in this script. See src/ui-v2/README.md.");
    process.exit(1);
  }

  console.log(`✅ src/ui-v2 isolation OK (${files.length} files checked).`);
}

main();
