#!/usr/bin/env node
/**
 * check-kit-deletion.cjs — deleting a brand kit is reachable, confirmed, and
 * never leaves the account without an active kit.
 *
 * ── What this is guarding ───────────────────────────────────────────────────
 * `deleteKit` already existed in BrandKitStore and was called by nothing — the
 * repo's usual defect. Worse, the version that existed had both of the bugs
 * that make kit deletion dangerous:
 *
 *  1. NO ACTIVE-KIT HANDOVER. Studio generates from whichever kit has
 *     `is_active` (src/services/brandKitLoader.js:18). Deleting the active kit
 *     without promoting a replacement leaves ZERO active kits, and the loader
 *     then returns null — every later generation silently runs with no brand at
 *     all. Nothing surfaces; the user just gets off-brand output.
 *
 *  2. NO STORAGE CLEANUP. `brand_assets` ROWS cascade on the foreign key, but
 *     the FILES in the bucket do not — Postgres does not know they exist.
 *     Deleting the row without them strands every logo and document the user
 *     uploaded, invisibly, still counting against their storage.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. Exactly one deleteKit definition (a duplicate key silently wins).
 *  2. The UI calls it — an action nothing invokes is not a feature.
 *  3. It is confirmed, not one-tap. Deletion is irreversible.
 *  4. ORDER: storage paths are read before the row is deleted, and the
 *     replacement is promoted BEFORE the delete, not after.
 */

const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function read(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) { failures.push(`Missing file: ${relPath}`); return ''; }
  return stripComments(fs.readFileSync(full, 'utf8'));
}

const store = read('src/stores/BrandKitStore.js');
const dashboard = read('src/components/BrandKit/BrandKitDashboard.jsx');

// ── 1. One definition ────────────────────────────────────────────────────────

const definitions = (store.match(/deleteKit\s*:\s*async/g) || []).length;
assert(
  definitions === 1,
  `BrandKitStore defines deleteKit ${definitions} times. Duplicate keys in an object literal do `
  + 'not error — the last one silently wins, so half the codebase can be reading a version that '
  + 'never runs.',
);

// ── 2. The UI reaches it ─────────────────────────────────────────────────────

assert(
  /deleteKit/.test(dashboard),
  'Nothing in the dashboard calls deleteKit. It sat unwired in the store once already; an action '
  + 'no surface invokes is not a feature.',
);
assert(
  /Trash2|aria-label={`Delete/.test(dashboard),
  'There is no delete control in the kit switcher, so the action cannot be reached.',
);

// ── 3. Confirmed, not one-tap ────────────────────────────────────────────────

assert(
  /pendingDelete/.test(dashboard) && /role="dialog"/.test(dashboard),
  'Deletion is not behind a confirmation. It is irreversible and takes the kit\'s uploaded logos '
  + 'and documents with it, so it must never be a single tap.',
);
assert(
  /aria-modal="true"/.test(dashboard) && /aria-labelledby/.test(dashboard),
  'The confirmation dialog is not announced to assistive tech.',
);
// The dialog must say what is actually lost, not just "are you sure".
assert(
  /logos|documents/i.test(dashboard),
  'The confirmation does not say that uploaded files go with the kit — that is the part people '
  + 'do not expect to lose.',
);

// ── 4. Ordering inside deleteKit ─────────────────────────────────────────────

const body = (() => {
  const start = store.indexOf('deleteKit: async');
  if (start < 0) return '';
  const end = store.indexOf('\n  },', start);
  return end < 0 ? store.slice(start) : store.slice(start, end);
})();

assert(body.length > 0, 'Could not read the deleteKit body — this check would silently pass.');

const idxStorageRead = body.indexOf("from('brand_assets')");
const idxStorageRemove = body.indexOf('.remove(');
const idxPromote = body.search(/is_active:\s*true/);
const idxDelete = body.search(/\.delete\(\)/);

assert(
  idxStorageRead >= 0 && idxStorageRead < idxDelete,
  'deleteKit does not read the kit\'s asset rows BEFORE deleting it. The foreign key cascades the '
  + 'rows away, so once the kit is gone nothing knows which files to remove and they are stranded '
  + 'in the bucket forever.',
);
assert(
  idxStorageRemove >= 0,
  'deleteKit never removes the stored files. Row cascade is not file cleanup — Postgres does not '
  + 'know the bucket exists.',
);
assert(
  idxPromote >= 0,
  'deleteKit never promotes a replacement active kit. Deleting the active kit would leave the '
  + 'account with none, and brandKitLoader would return null — every later generation silently '
  + 'runs with no brand.',
);
assert(
  idxPromote >= 0 && idxDelete >= 0 && idxPromote < idxDelete,
  'deleteKit promotes the replacement AFTER the delete. Between the two there is no active kit, '
  + 'and if the promotion fails the account is left that way permanently. Promote first: a failed '
  + 'delete then still leaves exactly one active kit.',
);

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-kit-deletion FAILED\x1b[0m\n');
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-kit-deletion\x1b[0m  one definition, reachable from the kit switcher, behind a '
  + 'confirmation that names what is lost, and the active kit is handed over before the delete.',
);
