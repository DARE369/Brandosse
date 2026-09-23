#!/usr/bin/env node
/**
 * check-undefined-identifiers.cjs — no file may reference a name that has no
 * binding anywhere in its scope chain.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * On 2026-09-14, commit d1dd694 added a jobId and a title to the Library
 * handoff in src/pages/VideoEngine/VideoJobPage.jsx:
 *
 *     { jobId: id, title: detail?.job ? jobTitle(detail.job) : null },
 *     ...
 *     [savedClips, markSaved, id, detail],
 *
 * `id` and `detail` are locals of VideoJobBody. The edit landed in JobView, a
 * sibling component, where neither has ever been in scope. Because a
 * useCallback dependency array is evaluated during RENDER, not on invocation,
 * "ReferenceError: id is not defined" was thrown before the page painted:
 * every video job detail page in production showed "Something went wrong" from
 * 2026-09-14 until 2026-09-23. Nine days. The feature it killed — reviewing and
 * keeping clips — is the product's most distinctive capability.
 *
 * The same scan found a second, older instance the same day:
 * src/pages/Studio/StudioPage.jsx called supabase.from("generations") with no
 * import of `supabase`. That one sat inside a try/catch, so it never crashed —
 * it threw on every open of the Studio source picker and the catch reported
 * "Couldn't load your images — you can still paste a URL", which reads exactly
 * like a transient outage. The picker had never worked once.
 *
 * ── Why nothing caught either one ───────────────────────────────────────────
 * This repository has no ESLint configuration and no ESLint dependency, so
 * no-undef — the rule that names this defect in one line — has never run. The
 * application source is .jsx, which Next compiles with SWC; SWC does not
 * resolve identifiers, and `next build` typechecks .ts/.tsx only. A free
 * variable is syntactically valid JavaScript, so it survives every stage of the
 * build and fails in the browser, on the user's screen, in code nobody is
 * looking at.
 *
 * ── Why the TypeScript compiler API and not a new dependency ────────────────
 * typescript is already a dependency, and seven sibling guards already drive it
 * (check-compose-wiring.cjs among them). Its binder does exactly the scope
 * resolution needed and reports it as TS2304, "Cannot find name 'X'". Adding
 * ESLint to obtain one rule the existing toolchain can already answer would be
 * a second parser to configure, version and keep in agreement with this one.
 *
 * Module resolution is disabled (noResolve). An `import { x } from "..."`
 * declares the binding x whether or not the module is found, which is all this
 * check needs — so it runs in about a second, needs no node_modules graph, and
 * cannot fail for reasons unrelated to what it asserts.
 *
 * ── Deliberate exemption ────────────────────────────────────────────────────
 * A name is permitted when the same file guards it with `typeof <name>`, which
 * is the only legal way to reference a binding that may not exist at runtime.
 * app/api/_lib/tokenCrypto.js:102 uses it to read an env var under both Node
 * and Deno. The check reads that intent from the AST, not from an allowlist
 * that would grow silently.
 *
 * supabase/functions/ is out of scope: those are Deno modules with a different
 * global environment and their own deploy-time check (check:edge-functions).
 *
 * READ-ONLY. Exit 0 = every name resolves. Exit 1 = a free variable is present
 * and will throw in the browser (fails CI).
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'app'];
const SOURCE_FILE = /\.(?:jsx?|tsx?)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '__snapshots__']);

// TS2304 — "Cannot find name 'X'." The binder resolved no declaration for this
// identifier in any enclosing scope, nor in the global lib.
const CANNOT_FIND_NAME = 2304;

// ── Collect the files ───────────────────────────────────────────────────────

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(full, out);
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full.split(path.sep).join('/'));
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
  console.error('\n\x1b[31m✖ check-undefined-identifiers FAILED\x1b[0m\n');
  console.error('  • Scanned ' + SCAN_ROOTS.join(', ') + ' and found no source '
    + 'files. A check that examines nothing passes for the wrong reason.\n');
  process.exit(1);
}

// ── Bind every file and read back the unresolved names ──────────────────────

const program = ts.createProgram(files, {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: [],
  skipLibCheck: true,
  // See the header: bindings come from the import statement, not the target.
  noResolve: true,
});

/**
 * Names this file guards with `typeof <name>` — the author has declared that
 * the binding may be absent at runtime, which is legal and intentional.
 */
function typeofGuardedNames(sourceFile) {
  const guarded = new Set();
  (function visit(node) {
    if (ts.isTypeOfExpression(node) && ts.isIdentifier(node.expression)) {
      guarded.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  })(sourceFile);
  return guarded;
}

const NAME_IN_MESSAGE = /Cannot find name '([^']+)'/;
const failures = [];

for (const sourceFile of program.getSourceFiles()) {
  if (sourceFile.isDeclarationFile) continue;

  const diagnostics = program
    .getSemanticDiagnostics(sourceFile)
    .filter((d) => d.code === CANNOT_FIND_NAME);

  if (diagnostics.length === 0) continue;

  const guarded = typeofGuardedNames(sourceFile);
  const seen = new Set();

  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    const match = NAME_IN_MESSAGE.exec(message);
    const name = match ? match[1] : null;
    if (name && guarded.has(name)) continue;

    const { line } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
    const relative = path.relative(ROOT, sourceFile.fileName).split(path.sep).join('/');
    const location = relative + ':' + (line + 1);

    // One report per name per line; TS emits a diagnostic per occurrence.
    const key = location + '::' + name;
    if (seen.has(key)) continue;
    seen.add(key);

    failures.push(
      location + '  ' + message
      + ' This name has no binding in any enclosing scope, so it throws'
      + ' ReferenceError the moment the line is evaluated. If it is a module'
      + ' export, import it; if it belongs to another component, pass it as a'
      + ' prop; if it is a runtime global that may be absent, guard it with'
      + ' typeof.',
    );
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-undefined-identifiers FAILED\x1b[0m\n');
  for (const failure of failures) console.error('  • ' + failure + '\n');
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-undefined-identifiers\x1b[0m  ' + files.length + ' files in '
  + SCAN_ROOTS.join('/ and ') + '/ bound cleanly; every identifier resolves to a '
  + 'declaration, an import, or a documented typeof guard.',
);
