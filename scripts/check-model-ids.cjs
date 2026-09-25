#!/usr/bin/env node
// scripts/check-model-ids.cjs
//
// GUARD (fixed + proven + guarded): fail if any AI model ID this app depends on
// has been retired by — or was never valid at — its provider.
//
// Born from the 2026-09-24 outage: Groq decommissioned `llama-3.3-70b-versatile`
// on 2026-08-16 and the Anthropic default in _shared/llm.ts was `claude-sonnet-5`,
// a model ID that never existed. Both 404'd, so EVERY AI edge function failed
// with no signal — surfacing to users only as a 504 on generate-content-plan and
// "no image generated". A code default nobody revisited had silently gone dead.
//
// This guard makes the NEXT deprecation loud: run it on a daily CI schedule and
// it checks every model ID referenced in _shared/llm.ts (plus any GROQ_MODEL /
// ANTHROPIC_MODEL override) against the provider's LIVE catalog. If an ID is
// gone, CI goes red the day the provider retires it — not a week later via a
// confused user.
//
// Usage:
//   node scripts/check-model-ids.cjs                 # verify (warns if keys absent)
//   REQUIRE_KEYS=1 node scripts/check-model-ids.cjs  # CI mode: missing key = failure
//
// Env: GROQ_API_KEY, ANTHROPIC_API_KEY (to reach the live catalogs),
//      GROQ_MODEL, ANTHROPIC_MODEL (runtime overrides to also verify).

const fs = require('fs');
const path = require('path');

const LLM_FILE = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'llm.ts');
const REQUIRE_KEYS = process.env.REQUIRE_KEYS === '1';

function fail(msg) { console.error(`❌ ${msg}`); process.exitCode = 1; }
function warn(msg) { console.warn(`⚠️  ${msg}`); }
function ok(msg)   { console.log(`✅ ${msg}`); }

// Extract the model IDs referenced in _shared/llm.ts. Parses string literals and
// classifies them so new models added to that file are covered automatically —
// there is no second list to keep in sync (which is how the last one drifted).
function collectExpectedModels() {
  const src = fs.readFileSync(LLM_FILE, 'utf8');
  const literals = src.match(/"[^"]+"|'[^']+'/g) || [];
  const anthropic = new Set();
  const groq = new Set();

  const ANTHROPIC_ID = /^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
  // Groq hosts open-weight models under vendor-prefixed ids (openai/..., qwen/...,
  // meta-llama/...) and bare llama-*/gemma-* ids. Matches those, not URLs/headers.
  const GROQ_ID = /^(?:openai|meta-llama|llama|gpt|qwen|mixtral|gemma|deepseek|moonshotai|groq)[a-z0-9]*(?:\/[a-z0-9]+(?:[.-][a-z0-9]+)*)*(?:[.-][a-z0-9]+)*$/;

  for (const raw of literals) {
    const s = raw.slice(1, -1);
    if (ANTHROPIC_ID.test(s)) anthropic.add(s);
    else if (GROQ_ID.test(s)) groq.add(s);
  }

  // Runtime overrides win in production (resolveProviders reads these) — verify them too.
  if (process.env.ANTHROPIC_MODEL) anthropic.add(process.env.ANTHROPIC_MODEL);
  if (process.env.GROQ_MODEL) groq.add(process.env.GROQ_MODEL);

  return { anthropic: [...anthropic], groq: [...groq] };
}

// Lenient match: alias vs dated-snapshot ids differ between config and catalog
// (e.g. "claude-haiku-4-5-20251001" vs a catalog "claude-haiku-4-5"). Treat a
// prefix relationship in EITHER direction as present, so the guard fires on a
// genuinely-gone model without false-failing on alias/date formatting.
function isPresent(id, live) {
  if (live.has(id)) return true;
  for (const l of live) {
    if (id.startsWith(l) || l.startsWith(id)) return true;
  }
  return false;
}

async function fetchIds(url, headers, label) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`${label} /models ${res.status}: ${String(body).slice(0, 200)}`);
  }
  const json = await res.json();
  return new Set((json.data || []).map((m) => m.id));
}

async function verify(label, ids, key, keyName, fetcher) {
  if (!ids.length) return;
  if (!key) {
    (REQUIRE_KEYS ? fail : warn)(`${keyName} not set — cannot verify ${label} model IDs against the live catalog.`);
    return;
  }
  let live;
  try {
    live = await fetcher(key);
  } catch (e) {
    (REQUIRE_KEYS ? fail : warn)(`${label} live-catalog check errored: ${e.message}`);
    return;
  }
  for (const id of ids) {
    isPresent(id, live)
      ? ok(`${label} model live: ${id}`)
      : fail(`${label} model NOT in live catalog (retired or invalid): ${id}`);
  }
}

(async () => {
  const { anthropic, groq } = collectExpectedModels();
  console.log(`Verifying model IDs from ${path.relative(process.cwd(), LLM_FILE)}`);
  console.log(`  anthropic: [${anthropic.join(', ') || '(none)'}]`);
  console.log(`  groq:      [${groq.join(', ') || '(none)'}]\n`);

  await verify('Groq', groq, process.env.GROQ_API_KEY, 'GROQ_API_KEY', (key) =>
    fetchIds('https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${key}` }, 'Groq'));

  await verify('Anthropic', anthropic, process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY', (key) =>
    fetchIds('https://api.anthropic.com/v1/models?limit=1000', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, 'Anthropic'));

  if (process.exitCode === 1) {
    console.error('\nA model ID is missing from its provider’s live catalog. Update the default in');
    console.error('supabase/functions/_shared/llm.ts (and the GROQ_MODEL / ANTHROPIC_MODEL Supabase secrets),');
    console.error('then redeploy the edge functions.');
  } else {
    console.log('\nAll configured model IDs are present in their provider catalogs.');
  }
})();
