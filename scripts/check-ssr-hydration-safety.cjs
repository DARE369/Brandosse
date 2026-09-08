#!/usr/bin/env node
/**
 * check-ssr-hydration-safety.cjs — no component decides what to render by
 * reading a browser-only global during render.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * `useAuthenticatedRedirect` read localStorage during render:
 *
 *     const likelySignedIn = useMemo(() => hasStoredAuthSession(), []);
 *
 * There is no localStorage on the server, so the server rendered the public
 * page and the client's first render produced the redirect overlay. Every visit
 * to a public page by a signed-in user threw "Hydration failed because the
 * server rendered HTML didn't match the client", and React discarded the server
 * tree and re-rendered everything on the client.
 *
 * The comment above it claimed the useMemo avoided a flash of public content.
 * It did not — a mismatch forces a full client re-render anyway, so the flash
 * happened regardless, with an error and doubled work on top. That is the
 * instructive part: the optimisation did not merely fail, it cost more than
 * doing nothing, and it read as deliberate for months.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. useAuthenticatedRedirect resolves the stored-session flag through
 *     useSyncExternalStore WITH a server snapshot — the sanctioned way to say
 *     "this value differs between server and client".
 *  2. It does not go back to reading storage in a useMemo/useState initialiser.
 *  3. Nothing else in src/ starts doing that either. There are zero such reads
 *     today; this keeps it that way rather than waiting for the next one.
 */

const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const HOOK = path.join(ROOT, 'src', 'hooks', 'useAuthenticatedRedirect.js');
const SCAN_DIR = path.join(ROOT, 'src');
const EXTENSIONS = new Set(['.js', '.jsx']);

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

// ── 1 + 2. The hook itself ───────────────────────────────────────────────────

if (!fs.existsSync(HOOK)) {
  failures.push('src/hooks/useAuthenticatedRedirect.js is missing.');
} else {
  const hook = stripComments(fs.readFileSync(HOOK, 'utf8'));

  const call = (() => {
    const start = hook.indexOf('useSyncExternalStore(');
    if (start < 0) return '';
    const end = hook.indexOf(');', start);
    return end < 0 ? '' : hook.slice(start, end);
  })();

  assert(
    call.length > 0,
    'useAuthenticatedRedirect no longer uses useSyncExternalStore. Reading localStorage during '
    + 'render makes the server and the client render different trees, which is a hydration '
    + 'mismatch on every public page a signed-in user opens.',
  );
  // Two commas => three arguments => a server snapshot was supplied. Without the
  // third argument React has nothing to hydrate against and the mismatch is back.
  assert(
    (call.match(/,/g) || []).length >= 2,
    'useSyncExternalStore is called without a getServerSnapshot argument. That third argument is '
    + 'the entire point: it is what the server and the hydrating client both render.',
  );
  // The load-bearing part. Fixing the localStorage read alone left the bug
  // INTERMITTENT: `user` arrives from an async session restore, and on a warm
  // cache it can be set before hydration finishes, so the client swaps to the
  // overlay while the server's HTML is still the page. Gating the whole
  // decision on `hydrated` is what actually closes that race.
  assert(
    /redirecting:\s*enabled\s*&&\s*hydrated\s*&&/.test(hook),
    'The `redirecting` result is not gated on `hydrated`. Without that gate the decision can '
    + 'differ between the server and the hydrating client whenever the session restore wins the '
    + 'race — which makes the hydration error look random and survive a fix to the storage read.',
  );
  assert(
    !/useMemo\(\s*\(\)\s*=>\s*hasStoredAuthSession/.test(hook)
    && !/useState\(\s*\(\)\s*=>\s*hasStoredAuthSession/.test(hook),
    'useAuthenticatedRedirect reads hasStoredAuthSession() in a useMemo/useState initialiser '
    + 'again. That runs during render, where the server has no localStorage.',
  );
}

// ── 3. Nobody else starts doing it ───────────────────────────────────────────

const BROWSER_ONLY = /(localStorage|sessionStorage|document\.|window\.(?!__))/;
for (const file of walk(SCAN_DIR)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const source = stripComments(fs.readFileSync(file, 'utf8'));

  // Lazy initialisers and memos run DURING render, unlike effects.
  for (const match of source.matchAll(/(useMemo|useState)\(\s*\(\)\s*=>\s*([^\n]{0,120})/g)) {
    const [, hookName, tail] = match;
    if (!BROWSER_ONLY.test(tail)) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    failures.push(
      `${rel}:${line} reads a browser-only global inside a ${hookName} initialiser:\n`
      + `    ${hookName}(() => ${tail.trim().slice(0, 90)}\n`
      + '    Initialisers run during render, and the server has no window/document/storage. If the '
      + 'value changes what is rendered, this is a hydration mismatch. Use useSyncExternalStore '
      + 'with a server snapshot, or move the read into an effect.',
    );
  }
}

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-ssr-hydration-safety FAILED\x1b[0m\n');
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-ssr-hydration-safety\x1b[0m  the stored-session flag is resolved through '
  + 'useSyncExternalStore with a server snapshot, and no render-time read of a browser-only '
  + 'global was found in src/.',
);
