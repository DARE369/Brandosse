#!/usr/bin/env node
/**
 * delete-rule-probe.mjs — the guard for 20260917120000.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-16 a user disconnected their YouTube account and two PUBLISHED
 * posts vanished — rows for videos still live on YouTube. No application code
 * deletes posts on disconnect. The database did it, through a foreign key whose
 * live rule was ON DELETE CASCADE while the migration that "added" it
 * (20260321113000:310-317) declared SET NULL and then skipped itself, because
 * it guarded on the constraint NAME and a constraint of that name already
 * existed. It reported success having changed nothing.
 *
 * A second rule, generations <- sessions CASCADE, exists in the live database
 * and in NO migration at all: deleting a chat deleted the user's images and
 * videos with it.
 *
 * Neither was detectable from the repository. Migrations record INTENT; only
 * the catalog records BEHAVIOUR, and nothing here could read the catalog. So
 * this probe reads the live rules and holds them against a reviewed manifest.
 *
 * WHAT IT CHECKS
 *   1. PINNED  — rules whose behaviour was decided deliberately must match
 *                exactly, and must be VALID (a NOT VALID constraint applies to
 *                new rows only: existing rows keep the old behaviour silently).
 *   2. CASCADE — any CASCADE that DELETES USER CONTENT must be listed in
 *                APPROVED_CASCADES with a reason. Deleting a parent that merely
 *                references content (an account, a chat, a job) must never
 *                delete the content itself. Owners are the exception: deleting
 *                a user or an organization is meant to take their data.
 *   3. BLOCKED — NO ACTION/RESTRICT references to auth.users are reported.
 *                Each one can block a user's own account deletion, which the
 *                published data-deletion page commits us to honouring. Reported,
 *                not failed: they destroy nothing, and the list is the input to
 *                the decision about them.
 *
 *   Usage:  node scripts/security/delete-rule-probe.mjs [--json]
 *   Exit 0 = rules match the manifest. Exit 1 = drift. Exit 2 = cannot run.
 *
 *   Requires in .env.local (or the environment):
 *     NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   Service role is required because fk_delete_rules() is SECURITY DEFINER and
 *   revoked from anon/authenticated — schema shape is reconnaissance.
 */

import fs from 'node:fs';
import path from 'node:path';

const JSON_OUT = process.argv.includes('--json');

// ───────────────────────────────────────────────────────────────────────────
// 1. PINNED RULES — decided deliberately, asserted exactly
// ───────────────────────────────────────────────────────────────────────────

const PINNED = [
  {
    child: 'public.posts', column: 'account_id', parent: 'public.connected_accounts',
    rule: 'SET NULL',
    why: 'Disconnecting a social account is not deleting the posts made with it. '
       + 'THIS IS THE RULE THAT DELETED TWO PUBLISHED POSTS on 2026-09-16.',
  },
  {
    child: 'public.generations', column: 'session_id', parent: 'public.sessions',
    rule: 'SET NULL',
    why: 'Founder ruling 2026-09-17: deleting a chat keeps its images and videos. '
       + 'personal_assets cascades from generations by design (20260712170000), so '
       + 'the generation surviving is what keeps the library item.',
  },
  {
    child: 'public.posts', column: 'user_id', parent: 'auth.users',
    rule: 'CASCADE',
    why: 'Founder ruling 2026-09-17: deleting an account deletes its posts, as the '
       + 'data-deletion page promises. Was NO ACTION live, which BLOCKED deletion.',
  },
  {
    child: 'public.posts', column: 'flagged_by_admin_id', parent: 'auth.users',
    rule: 'SET NULL',
    why: 'Deleting an admin must neither destroy a user post nor pin it in place.',
  },
  {
    child: 'public.posts', column: 'force_published_by', parent: 'auth.users',
    rule: 'SET NULL',
    why: 'Same reason as flagged_by_admin_id.',
  },
];

// ───────────────────────────────────────────────────────────────────────────
// 2. CONTENT, OWNERS, AND THE CASCADES ALREADY REVIEWED
// ───────────────────────────────────────────────────────────────────────────

/** Tables holding something a user would be upset to lose without asking. */
const CONTENT_TABLES = new Set([
  'public.posts',
  'public.generations',
  'public.personal_assets',
  'public.content_library_items',
  'public.media_assets',
  'public.sessions',
  'public.content_plans',
  'public.studio_projects',
  'public.video_jobs',
  'public.video_clips',
  'public.brand_kit',
  'public.brand_assets',
  'public.connected_accounts',
  'public.org_asset_library',
]);

/**
 * Deleting one of these IS deleting the owner of the content, so cascading is
 * the correct and legally required behaviour rather than data loss.
 */
const OWNER_TABLES = new Set([
  'auth.users',
  'public.profiles',
  'public.organizations',
  'public.brand_projects',
]);

/**
 * Cascades into content from a NON-owner that have been reviewed and kept.
 * Matched on child + parent; the column is not pinned here because these are
 * approvals of a relationship, not of a specific FK's name.
 *
 * Adding an entry is a DECISION: it says "deleting this parent is supposed to
 * destroy this content". Anything not listed fails, which is the point — the
 * September 2026 defect was a destructive rule nobody had ever approved.
 */
const APPROVED_CASCADES = [
  {
    child: 'public.personal_assets', parent: 'public.generations',
    why: '20260712170000: personal_assets has a CHECK requiring generation_id NOT '
       + 'NULL when source = generation, so SET NULL is impossible. The asset IS '
       + 'the generation; they live and die together.',
  },
  {
    child: 'public.personal_assets', parent: 'public.posts',
    why: 'Same CHECK constraint, for post-sourced assets (20260712170000).',
  },
  // The three referents of content_library_items. Reviewed together on
  // 2026-09-18 after this probe flagged two of them on its first live run.
  //
  // 20260227090000:117-122 constrains the table with
  // content_library_items_one_reference_only: exactly ONE of post_id,
  // media_asset_id, template_id may be set. A row is therefore a pointer at one
  // thing and nothing else, so SET NULL would leave a row violating its own
  // CHECK — a rule that could only fail at delete time. Same situation as
  // personal_assets above, and the same resolution.
  //
  // Losing a pointer row is not losing content: the post, asset or template is
  // what the user made, and each of those deletions is user-initiated.
  {
    child: 'public.content_library_items', parent: 'public.posts',
    why: 'A library item derived from a post has no meaning without it, and the '
       + 'one_reference_only CHECK makes SET NULL impossible (20260227090000:117).',
  },
  {
    child: 'public.content_library_items', parent: 'public.media_assets',
    why: 'Same one_reference_only CHECK. The asset is the content; the library row '
       + 'is a pointer at it (20260227090000:98-101, deliberate and declared).',
  },
  {
    child: 'public.content_library_items', parent: 'public.content_templates',
    why: 'Same one_reference_only CHECK. A template-type library row exists only to '
       + 'surface that template (20260227090000:104-107).',
  },
  {
    child: 'public.video_clips', parent: 'public.video_jobs',
    why: 'Clips are outputs of a job; deleting the job is how a user discards them.',
  },
  {
    child: 'public.brand_assets', parent: 'public.brand_kit',
    why: 'Assets belong to the kit. Kit deletion is itself guarded by '
       + 'scripts/check-kit-deletion.cjs.',
  },
  {
    child: 'public.sessions', parent: 'public.profiles',
    why: 'profiles is deleted only with the auth user it mirrors '
       + '(profiles.id -> auth.users CASCADE), so this is account deletion.',
  },
];

// ───────────────────────────────────────────────────────────────────────────
// 3. Environment
// ───────────────────────────────────────────────────────────────────────────

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const key = line.slice(0, i).trim();
      if (!env[key]) env[key] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !svc) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  console.error('       This probe reads the live catalog; there is nothing to check without a database.');
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Read the live rules
// ───────────────────────────────────────────────────────────────────────────

const res = await fetch(`${base}/rest/v1/rpc/fk_delete_rules`, {
  method: 'POST',
  headers: {
    apikey: svc,
    Authorization: `Bearer ${svc}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
});

if (!res.ok) {
  const body = await res.text().catch(() => '');
  console.error(`FATAL: fk_delete_rules() returned HTTP ${res.status}.`);
  if (res.status === 404) {
    console.error('       The function does not exist. Apply migration');
    console.error('       supabase/migrations/20260917120000_delete_rules_protect_user_content.sql.');
  } else if (res.status === 401 || res.status === 403) {
    console.error('       Not authorised. This needs the SERVICE ROLE key: the function is');
    console.error('       revoked from anon and authenticated on purpose.');
  }
  if (body) console.error(`       ${body.slice(0, 300)}`);
  process.exit(2);
}

const rules = await res.json();
if (!Array.isArray(rules) || rules.length === 0) {
  console.error('FATAL: fk_delete_rules() returned no rows. A database with no foreign keys');
  console.error('       is not a database this probe can say anything useful about.');
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Compare
// ───────────────────────────────────────────────────────────────────────────

const failures = [];
const notices = [];

// 5a. Pinned rules.
for (const want of PINNED) {
  const matches = rules.filter(
    (r) => r.child_table === want.child
        && r.child_column === want.column
        && r.parent_table === want.parent,
  );

  if (matches.length === 0) {
    failures.push({
      kind: 'missing',
      label: `${want.child}.${want.column} -> ${want.parent}`,
      detail: `no foreign key at all; expected ON DELETE ${want.rule}`,
      why: want.why,
    });
    continue;
  }

  if (matches.length > 1) {
    // Two rules on one relationship is how a reviewed SET NULL and an
    // unreviewed CASCADE coexist, with the destructive one winning.
    failures.push({
      kind: 'duplicate',
      label: `${want.child}.${want.column} -> ${want.parent}`,
      detail: `${matches.length} foreign keys on the same column: `
            + matches.map((m) => `${m.constraint_name} (${m.delete_rule})`).join(', '),
      why: want.why,
    });
    continue;
  }

  const got = matches[0];
  if (got.delete_rule !== want.rule) {
    failures.push({
      kind: 'wrong-rule',
      label: `${want.child}.${want.column} -> ${want.parent}`,
      detail: `live rule is ${got.delete_rule}, expected ${want.rule} (${got.constraint_name})`,
      why: want.why,
    });
  } else if (!got.is_validated) {
    failures.push({
      kind: 'not-valid',
      label: `${want.child}.${want.column} -> ${want.parent}`,
      detail: `${got.constraint_name} is NOT VALID — it governs new rows only, `
            + 'existing rows keep the old behaviour',
      why: want.why,
    });
  }
}

// 5b. Unreviewed destructive cascades.
const pinnedKeys = new Set(PINNED.map((p) => `${p.child}|${p.column}|${p.parent}`));

for (const r of rules) {
  if (r.delete_rule !== 'CASCADE') continue;
  if (!CONTENT_TABLES.has(r.child_table)) continue;
  if (OWNER_TABLES.has(r.parent_table)) continue;
  if (pinnedKeys.has(`${r.child_table}|${r.child_column}|${r.parent_table}`)) continue;
  if (APPROVED_CASCADES.some((a) => a.child === r.child_table && a.parent === r.parent_table)) continue;

  failures.push({
    kind: 'unreviewed-cascade',
    label: `${r.child_table}.${r.child_column} -> ${r.parent_table}`,
    detail: `ON DELETE CASCADE destroys rows in ${r.child_table} when a `
          + `${r.parent_table} row is deleted, and nobody approved that (${r.constraint_name})`,
    why: 'If this is intended, add it to APPROVED_CASCADES in this file WITH THE '
       + 'REASON. If it is not, write a migration repointing it. Do not delete the '
       + 'check: this exact shape cost two published posts.',
  });
}

// 5c. Account-deletion blockers — reported, not failed.
for (const r of rules) {
  if (r.parent_table !== 'auth.users') continue;
  if (r.delete_rule !== 'NO ACTION' && r.delete_rule !== 'RESTRICT') continue;
  notices.push(`${r.child_table}.${r.child_column} (${r.delete_rule})`);
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Report
// ───────────────────────────────────────────────────────────────────────────

if (JSON_OUT) {
  console.log(JSON.stringify({
    checked: rules.length,
    pinned: PINNED.length,
    failures,
    account_deletion_blockers: notices,
  }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

console.log('delete-rule probe — live ON DELETE rules vs the reviewed manifest\n');
console.log(`  read ${rules.length} foreign keys from the live catalog`);
console.log(`  ${PINNED.length} pinned rule(s), ${APPROVED_CASCADES.length} approved cascade(s)\n`);

for (const want of PINNED) {
  const failed = failures.find((f) => f.label === `${want.child}.${want.column} -> ${want.parent}`);
  if (failed) {
    console.log(`  FAIL   ${want.child}.${want.column} -> ${want.parent}`);
    console.log(`         ${failed.detail}`);
  } else {
    console.log(`  ok     ${want.child}.${want.column} -> ${want.parent}  ${want.rule}`);
  }
}

const cascadeFailures = failures.filter((f) => f.kind === 'unreviewed-cascade');
if (cascadeFailures.length) {
  console.log('');
  for (const f of cascadeFailures) {
    console.log(`  FAIL   ${f.label}`);
    console.log(`         ${f.detail}`);
  }
}

if (notices.length) {
  console.log(`\n  note   ${notices.length} foreign key(s) to auth.users still block account deletion:`);
  for (const n of notices.slice(0, 12)) console.log(`         ${n}`);
  if (notices.length > 12) console.log(`         … and ${notices.length - 12} more`);
  console.log('         Each one makes DELETE FROM auth.users fail for a user who has such a row.');
}

console.log('');

if (failures.length === 0) {
  console.log('PASS — every reviewed delete rule matches the live database.');
  process.exit(0);
}

console.error(`FAIL — ${failures.length} delete rule(s) differ from what was approved.`);
for (const f of failures) {
  console.error(`\n  ${f.label}`);
  console.error(`    ${f.detail}`);
  console.error(`    ${f.why}`);
}
console.error('\n  A destructive rule nobody approved is how two published posts were deleted');
console.error('  on 2026-09-16. Fix it with a migration; never by editing the live schema.');
process.exit(1);
