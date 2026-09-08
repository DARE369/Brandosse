#!/usr/bin/env node
/**
 * check-brand-version-hash.cjs — the brand-kit hash covers everything that can
 * change generated output.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * `brand_kit.version_hash` is stamped onto every generation receipt
 * (src/services/generationPipeline.js:150) as the answer to "which version of
 * this brand produced this asset". Until 2026-09-01 it was computed as
 * `btoa(JSON.stringify(kit)).slice(0, 16)`.
 *
 * Sixteen base64 characters is twelve bytes of input, and a brand_kit row
 * always begins `{"id":"<uuid>`. So the value was a function of the kit's UUID
 * and nothing else — byte-identical after changing the brand name AND the
 * entire colour palette. Every generation the product has ever made carries a
 * brand version that has never changed. A second, different hash
 * (`computeBrandKitHash`) covered five fields and drove the suggested-prompt
 * cache, so editing a palette also left that cache stale.
 *
 * This is precisely the failure this repo keeps finding: working code, quietly
 * producing a wrong answer, with nothing watching.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. COVERAGE — every column of public.brand_kit, read out of the migrations,
 *     appears in either BRAND_KIT_HASH_FIELDS or HASH_EXCLUDED_FIELDS. Adding a
 *     column forces an explicit decision about whether it affects output; it
 *     cannot be forgotten into existence.
 *  2. BEHAVIOUR — the hash actually changes when a visual field changes, and
 *     actually does not change when only metadata changes. A field list that
 *     is correct while the function ignores it would pass check 1 alone.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const HASH_MODULE = path.join(ROOT, 'src', 'utils', 'brandKitHash.js');

const failures = [];

// ── Read the real columns of public.brand_kit out of the migrations ──────────

function readBrandKitColumns() {
  const columns = new Set();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // CREATE TABLE ... public.brand_kit ( ... );
    const createMatch = sql.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.brand_kit\s*\(([\s\S]*?)\n\s*\);/i,
    );
    if (createMatch) {
      for (const rawLine of createMatch[1].split('\n')) {
        const line = rawLine.trim().replace(/--.*$/, '').trim();
        if (!line) continue;
        if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(line)) continue;
        const nameMatch = line.match(/^([a-z_][a-z0-9_]*)\s+/i);
        if (nameMatch) columns.add(nameMatch[1].toLowerCase());
      }
    }

    // ALTER TABLE public.brand_kit ... ADD COLUMN ...;
    // Scoped to the brand_kit statement only: 20260220041938_brand_kit.sql also
    // ALTERs other tables in the same file, and their columns are not ours.
    const alterRe = /ALTER\s+TABLE\s+(?:ONLY\s+)?public\.brand_kit\b([\s\S]*?);/gi;
    let alter;
    while ((alter = alterRe.exec(sql)) !== null) {
      const addRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
      let add;
      while ((add = addRe.exec(alter[1])) !== null) columns.add(add[1].toLowerCase());
    }
  }
  return columns;
}

async function main() {
  if (!fs.existsSync(HASH_MODULE)) {
    console.error(`✖ check-brand-version-hash: ${HASH_MODULE} not found`);
    process.exit(1);
  }

  const mod = await import(pathToFileURL(HASH_MODULE).href);
  const { computeBrandKitHash, BRAND_KIT_HASH_FIELDS, HASH_EXCLUDED_FIELDS } = mod;

  if (!Array.isArray(BRAND_KIT_HASH_FIELDS) || typeof computeBrandKitHash !== 'function') {
    console.error('✖ check-brand-version-hash: brandKitHash.js must export computeBrandKitHash and BRAND_KIT_HASH_FIELDS');
    process.exit(1);
  }

  // ── 1. Coverage ────────────────────────────────────────────────────────────
  const columns = readBrandKitColumns();
  if (columns.size === 0) {
    failures.push('No brand_kit columns were found in supabase/migrations — the parser is broken, not the schema.');
  }

  const hashed = new Set(BRAND_KIT_HASH_FIELDS);
  const excluded = new Set(Object.keys(HASH_EXCLUDED_FIELDS || {}));

  for (const column of columns) {
    if (!hashed.has(column) && !excluded.has(column)) {
      failures.push(
        `Column "${column}" of public.brand_kit is in neither BRAND_KIT_HASH_FIELDS nor\n` +
        '    HASH_EXCLUDED_FIELDS. Decide: does its value change what a generator produces?\n' +
        '    If yes, add it to the hash. If no, add it to HASH_EXCLUDED_FIELDS with the reason.',
      );
    }
  }

  for (const field of hashed) {
    if (!columns.has(field)) {
      failures.push(
        `BRAND_KIT_HASH_FIELDS lists "${field}", which is not a column of public.brand_kit.\n` +
        '    Either the column was renamed or removed, or the field name is a typo — in both\n' +
        '    cases the hash is silently reading undefined for it.',
      );
    }
  }

  // ── 2. Behaviour ───────────────────────────────────────────────────────────
  const base = {
    id: '4f8a1c2e-9b3d-4a11-8e77-abcdef012345',
    user_id: 'user-1',
    brand_name: 'Oriki Soda Co',
    color_palette: [{ hex: '#0A2540', name: 'Navy', usage: 'background' }],
    font_display: { family: 'Poppins', style: 'bold' },
    visual_style_keywords: ['clean', 'warm'],
    avoid_visual_elements: ['stock photography'],
    last_updated_at: '2026-09-01T00:00:00.000Z',
  };

  const cases = [
    {
      name: 'a changed colour palette changes the hash',
      mutate: (k) => { k.color_palette = [{ hex: '#C2185B', name: 'Rose', usage: 'background' }]; },
      expect: 'different',
    },
    {
      name: 'a changed display font changes the hash',
      mutate: (k) => { k.font_display = { family: 'Inter', style: 'regular' }; },
      expect: 'different',
    },
    {
      name: 'a changed brand name changes the hash',
      mutate: (k) => { k.brand_name = 'Something Else Entirely'; },
      expect: 'different',
    },
    {
      name: 'a new avoid_visual_elements entry changes the hash',
      mutate: (k) => { k.avoid_visual_elements = ['stock photography', 'lens flare']; },
      expect: 'different',
    },
    {
      name: 'a changed colour ROLE changes the hash',
      mutate: (k) => { k.color_roles = { cta_bg: { hex: '#00AA55' } }; },
      expect: 'different',
    },
    {
      name: 'changed layout rules change the hash',
      mutate: (k) => { k.layout_rules = { safe_margin_pct: 12 }; },
      expect: 'different',
    },
    {
      name: 'a changed type scale changes the hash',
      mutate: (k) => { k.type_scale = { display: { family: 'Poppins', weight: 900 } }; },
      expect: 'different',
    },
    {
      name: 'provenance alone does not change the hash',
      // Re-importing a site and confirming the SAME values must not invalidate
      // every cached suggestion — the values did not move, only the note about
      // where they came from.
      mutate: (k) => { k.extraction_evidence = { brand_name: { source: 'measured', url: 'https://x.test' } }; },
      expect: 'same',
    },
    {
      name: 'touching only last_updated_at leaves the hash alone',
      mutate: (k) => { k.last_updated_at = '2027-01-01T00:00:00.000Z'; },
      expect: 'same',
    },
    {
      name: 'a different row id with identical content leaves the hash alone',
      mutate: (k) => { k.id = '00000000-0000-0000-0000-000000000000'; },
      expect: 'same',
    },
    {
      name: 'key insertion order does not change the hash',
      mutate: (k) => { k.font_display = { style: 'bold', family: 'Poppins' }; },
      expect: 'same',
    },
  ];

  const baseHash = computeBrandKitHash(base);

  if (!baseHash || baseHash === 'none' || baseHash.length < 8) {
    failures.push(`computeBrandKitHash returned a suspicious value for a populated kit: "${baseHash}"`);
  }
  if (computeBrandKitHash(null) !== 'none') {
    failures.push('computeBrandKitHash(null) must return "none" so "no kit" is distinguishable from "empty kit".');
  }

  for (const testCase of cases) {
    const mutated = JSON.parse(JSON.stringify(base));
    testCase.mutate(mutated);
    const mutatedHash = computeBrandKitHash(mutated);
    const isSame = mutatedHash === baseHash;

    if (testCase.expect === 'different' && isSame) {
      failures.push(`BEHAVIOUR: ${testCase.name} — but the hash did not change (${baseHash}).`);
    }
    if (testCase.expect === 'same' && !isSame) {
      failures.push(`BEHAVIOUR: ${testCase.name} — but the hash changed (${baseHash} -> ${mutatedHash}).`);
    }
  }

  // ── 3. The old broken implementation must not come back ────────────────────
  // Comments stripped first: the comment in BrandKitStore.js that explains why
  // this pattern is forbidden necessarily contains the pattern.
  const storeSource = stripComments(
    fs.readFileSync(path.join(ROOT, 'src', 'stores', 'BrandKitStore.js'), 'utf8'),
  );
  if (/btoa\s*\([\s\S]{0,80}JSON\.stringify/.test(storeSource)) {
    failures.push(
      'BrandKitStore.js contains a btoa(JSON.stringify(...)) version hash again.\n' +
      '    That truncates to the first twelve bytes of the row, which is the kit UUID.\n' +
      '    Use computeBrandKitHash from src/utils/brandKitHash.js.',
    );
  }

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-brand-version-hash FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  console.log(
    `\x1b[32m✔ check-brand-version-hash\x1b[0m  ${columns.size} brand_kit columns accounted for ` +
    `(${hashed.size} hashed, ${excluded.size} excluded); ${cases.length} behavioural assertions passed.`,
  );
}

main().catch((err) => {
  console.error('✖ check-brand-version-hash crashed:', err);
  process.exit(1);
});
