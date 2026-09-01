#!/usr/bin/env node
/**
 * check-cost-ledger.cjs — LOCK L5.14 guard.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * `FAL_COST_USD` in _shared/fal.service.ts is labelled "Cost estimates
 * (informational)", and until 2026-09-01 nothing anywhere recorded what a
 * provider call ACTUALLY cost. That single absence made eight cost controls
 * unenforceable at once: the retry multiplier, per-user spend ceilings, real
 * COGS per delivered video, provider price-drift detection, invoice
 * reconciliation, egress-per-video, allowance utilisation, and the
 * estimate-versus-charge promise the customer actually judges the product on.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 * Any edge function that spends money with a provider also records that spend.
 * Concretely: if a function imports a paid-provider client, it must also import
 * `_shared/costLedger.ts` and call `recordCost`.
 *
 * A function that legitimately calls a provider without spending — a status
 * poll, a cancellation, a webhook handler reading a result someone else paid
 * for — is exempt via NO_SPEND, with a stated reason, so the exemption is a
 * decision on the record rather than a silence.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');

/** Importing any of these means the function can incur provider spend. */
const PAID_PROVIDER_IMPORTS = [
  { pattern: /_shared\/fal\.service\.ts/, provider: 'fal.ai' },
];

/**
 * Functions that touch a paid provider module but do not themselves buy
 * anything. Each needs a reason — the point is that someone decided, not that
 * nobody looked.
 */
const NO_SPEND = {
  'supabase/functions/job-webhook/index.ts':
    'Receives fal\'s completion callback. Reads a result already paid for at ' +
    'submit time by generateVideo, which recorded it. Recording again here ' +
    'would double-count every video.',
  'supabase/functions/process-jobs/index.ts':
    'Reconciliation sweep. Polls fal for the status of jobs already submitted ' +
    'and recorded; status checks are not billed.',
  'supabase/functions/cancel-video-job/index.ts':
    'Cancels an in-flight fal job. Spends nothing; the original submit was ' +
    'already recorded.',
  'supabase/functions/_shared/videoJobFinalize.ts':
    'Observes completion for jobs generateVideo already submitted and recorded. Uses getQueueStatus/getQueueResult only — status polls and result fetches are not billed, and recording here would double-count every video.',
  'supabase/functions/_shared/fal.service.ts':
    'The provider adapter itself. It has no database handle by design — ' +
    'keeping it a pure adapter is what lets it be tested and swapped.',
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

if (!fs.existsSync(FUNCTIONS_DIR)) {
  console.error('  check-cost-ledger: FAIL — supabase/functions not found.');
  process.exit(1);
}

const failures = [];
const recording = [];
const exempt = [];

for (const file of walk(FUNCTIONS_DIR)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');

  const paid = PAID_PROVIDER_IMPORTS.find((p) => p.pattern.test(src));
  if (!paid) continue;

  if (NO_SPEND[rel]) {
    exempt.push(rel);
    continue;
  }

  const importsLedger = /_shared\/costLedger\.ts/.test(src);
  const callsRecord = /\brecordCost\s*\(/.test(src);

  if (!importsLedger || !callsRecord) {
    failures.push(
      `${rel} calls ${paid.provider} but ${
        !importsLedger ? 'does not import _shared/costLedger.ts' : 'never calls recordCost()'
      }.\n` +
      `      A provider call that is not recorded is invisible to every cost ` +
      `control in the system — the retry multiplier, per-user ceilings, real ` +
      `COGS, and invoice reconciliation all read this ledger.\n` +
      `      Either call recordCost(), or add this file to NO_SPEND with a ` +
      `reason it spends nothing.`,
    );
  } else {
    recording.push(rel);
  }
}

if (failures.length > 0) {
  console.error('  check-cost-ledger: FAIL\n');
  for (const f of failures) console.error(`    - ${f}\n`);
  process.exit(1);
}

console.log(
  `  check-cost-ledger: OK (${recording.length} spending function(s) record; ` +
  `${exempt.length} exempt with a stated reason)`,
);
