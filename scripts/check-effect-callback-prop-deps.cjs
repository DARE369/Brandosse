#!/usr/bin/env node
/**
 * check-effect-callback-prop-deps.cjs — a component must not depend on a
 * caller-owned callback prop that it calls directly inside a useEffect.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * On 2026-09-25, choosing an answer to YouTubeOptionsPanel's "Is this video
 * made for kids?" radio turned the whole Generate/Studio page white. Its two
 * effects called the caller's props and also listed them as dependencies:
 *
 *     useEffect(() => {
 *       if (isValid) onChange?.(settings);
 *     }, [isValid, settings, onChange]);
 *
 * Every call site (Generate/PostProductionPanel.jsx:1293,
 * Studio/PostProductionPanel.jsx:254) passes an inline arrow function for
 * onChange — a fresh identity on every render. So: effect fires -> caller's
 * setState -> re-render -> new onChange identity -> effect fires again,
 * unbounded. React caught it before first paint and threw "Maximum update
 * depth exceeded" (error #185) — a white screen, same failure mode as
 * check-undefined-identifiers.cjs documents for a ReferenceError, from a
 * different cause.
 *
 * TikTokOptionsPanel.jsx — the sibling panel, same shape of prop — had
 * already hit this and fixed it by excluding onChange/onValidityChange from
 * its effect's own dependency array (comment at line ~172: "onChange/
 * onValidityChange are caller-owned and often inline; depending on them
 * would loop"). That fix was recorded only in a code comment in one file, so
 * it did not stop the same mistake landing in YouTubeOptionsPanel.jsx —
 * exactly the "fix without a detector has a demonstrated half-life here"
 * pattern CLAUDE.md's Law 1 names.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 * For every `useEffect` / `useLayoutEffect` call with an inline arrow or
 * function-expression first argument and an array-literal second argument:
 * no identifier may be listed in the dependency array AND named like a
 * callback prop (/^on[A-Z]/) AND called directly at the effect's own TOP
 * LEVEL — i.e. not inside a nested function the effect itself registers (an
 * event handler, a .then(), a timer callback). That nested-function case is a
 * legitimate, different pattern several files in this repo already use
 * correctly — CalendarCommandBar.jsx subscribes onClose inside a keydown
 * handler, and never calls it synchronously during the effect's own
 * execution, so a fresh onClose identity each render just re-subscribes a
 * listener; it never sets state synchronously and cannot loop.
 *
 * A component cannot control what identity its caller passes a callback
 * prop — three separate call sites in this repo pass a fresh inline arrow
 * each render for these two panels alone — so the only correct rule for a
 * component that invokes its own callback prop synchronously inside an
 * effect is: never depend on that prop.
 *
 * ── Why the TypeScript compiler API and not a regex ─────────────────────────
 * The line between "safe" and "white screen" is scope, not text:
 * `onClose()` called inside a nested keydown handler is safe; the identical
 * text at the effect's own top level is not. A regex cannot see that
 * distinction; walking the AST and tracking function-boundary nesting can.
 * typescript is already a dependency and several sibling guards already
 * drive it this way (check-undefined-identifiers.cjs among them) — no new
 * parser to configure or keep in agreement with this one.
 *
 * This is a syntax-only pass (ts.createSourceFile, not a type-checked
 * Program) — it needs no module graph and cannot fail for reasons unrelated
 * to what it asserts.
 *
 * READ-ONLY. Exit 0 = no effect depends on a callback prop it calls itself.
 * Exit 1 = a white-screen-on-render risk exists (fails CI).
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'app'];
const SOURCE_FILE = /\.(?:jsx|tsx)$/; // hooks with JSX callers live in component files
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '__snapshots__']);
const CALLBACK_PROP = /^on[A-Z]/;
const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);

// ── Collect the files ───────────────────────────────────────────────────────

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(full, out);
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const root of SCAN_ROOTS) {
  const abs = path.join(ROOT, root);
  if (fs.existsSync(abs)) collect(abs, files);
}

if (files.length === 0) {
  console.error('\n\x1b[31m✖ check-effect-callback-prop-deps FAILED\x1b[0m\n');
  console.error(
    '  • Scanned ' + SCAN_ROOTS.join(', ') + ' and found no .jsx/.tsx files. '
    + 'A check that examines nothing passes for the wrong reason.\n',
  );
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isFunctionBoundary(node) {
  return ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node);
}

/** The hook name for `useEffect(...)` or `React.useEffect(...)`; null otherwise. */
function effectHookName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
  return null;
}

const failures = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const relative = path.relative(ROOT, file).split(path.sep).join('/');

  let sourceFile;
  try {
    sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  } catch {
    continue; // unparsable file is out of scope for this check
  }

  (function visitTopLevel(node) {
    if (
      ts.isCallExpression(node)
      && EFFECT_HOOKS.has(effectHookName(node.expression))
      && node.arguments.length >= 2
    ) {
      const [effectFn, depsArg] = node.arguments;

      if (
        (ts.isArrowFunction(effectFn) || ts.isFunctionExpression(effectFn))
        && ts.isArrayLiteralExpression(depsArg)
      ) {
        const depNames = depsArg.elements
          .filter(ts.isIdentifier)
          .map((id) => id.text);
        const flaggedDeps = depNames.filter((n) => CALLBACK_PROP.test(n));

        if (flaggedDeps.length > 0) {
          const topLevelCalls = new Set();

          (function walkEffectBody(inner, insideNestedFn) {
            if (
              !insideNestedFn
              && ts.isCallExpression(inner)
              && ts.isIdentifier(inner.expression)
              && flaggedDeps.includes(inner.expression.text)
            ) {
              topLevelCalls.add(inner.expression.text);
            }
            const nextInsideNested = insideNestedFn || isFunctionBoundary(inner);
            ts.forEachChild(inner, (child) => walkEffectBody(child, nextInsideNested));
          })(effectFn.body, false);

          for (const name of topLevelCalls) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            failures.push(
              relative + ':' + (line + 1) + '  useEffect calls `' + name + '` directly '
              + 'and also lists it as a dependency. `' + name + '` reads as a callback '
              + 'prop; if any caller passes it as an inline arrow function (as three '
              + 'call sites in this repo already do for the two per-platform options '
              + 'panels), a fresh identity every render re-fires this effect every '
              + 'time it runs, which reproduces itself -> React throws "Maximum update '
              + 'depth exceeded" before first paint. Remove `' + name + '` from the '
              + 'dependency array (with an eslint-disable-next-line '
              + 'react-hooks/exhaustive-deps and a comment saying why, as '
              + 'TikTokOptionsPanel.jsx and YouTubeOptionsPanel.jsx both now do) '
              + 'rather than depending on it.',
            );
          }
        }
      }
    }
    ts.forEachChild(node, visitTopLevel);
  })(sourceFile);
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-effect-callback-prop-deps FAILED\x1b[0m\n');
  for (const failure of failures) console.error('  • ' + failure + '\n');
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-effect-callback-prop-deps\x1b[0m  ' + files.length + ' component files '
  + 'checked; no useEffect depends on a callback prop it also calls at its own top level.',
);
