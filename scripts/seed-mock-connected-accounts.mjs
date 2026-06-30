#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

async function loadSeedFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.accounts || [];
}

function printUsage() {
  console.log(`
Usage:
  node scripts/seed-mock-connected-accounts.mjs --file ./seed-accounts.json

Required env vars:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Seed file example:
[
  {
    "target_user_id": "00000000-0000-0000-0000-000000000000",
    "scope": "personal",
    "platform": "instagram",
    "display_name": "Nike Official",
    "username": "nikeofficial"
  },
  {
    "target_user_id": "00000000-0000-0000-0000-000000000001",
    "scope": "organization",
    "organization_id": "11111111-1111-1111-1111-111111111111",
    "platform": "linkedin",
    "display_name": "Acme B2B",
    "username": "acmeb2b"
  }
]
  `.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.findIndex((arg) => arg === '--file');
  if (fileIndex === -1 || !args[fileIndex + 1]) {
    printUsage();
    process.exit(1);
  }

  const seedFile = args[fileIndex + 1];
  const supabaseUrl = getEnv('SUPABASE_URL', getEnv('NEXT_PUBLIC_SUPABASE_URL'));
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const rows = await loadSeedFile(seedFile);
  if (!rows.length) {
    console.error('No accounts found in the seed file.');
    process.exit(1);
  }

  for (const [index, row] of rows.entries()) {
    const response = await fetch(`${supabaseUrl}/functions/v1/admin-seed-connected-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(row),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`Seed ${index + 1} failed:`, payload.error || response.statusText);
      process.exitCode = 1;
      continue;
    }

    console.log(`Seeded ${payload?.connected_account?.platform || row.platform} for ${payload?.connected_account?.username || row.username || row.target_user_id}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
