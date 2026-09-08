#!/usr/bin/env node
/**
 * check-ssrf-blocklist.cjs — safeFetch's address validation actually blocks
 * what it claims to block.
 *
 * ── Why this exists separately from check-outbound-fetch-guard ──────────────
 * That guard proves every caller-influenced fetch ROUTES THROUGH safeFetch. It
 * says nothing about whether safeFetch works. A validator that accepted
 * everything would pass it completely.
 *
 * This is the behavioural half: a matrix of addresses that must be refused and
 * a set that must be allowed through, asserted against the real
 * `assertPublicUrl` implementation.
 *
 * ── Why it transpiles rather than importing ─────────────────────────────────
 * safeFetch.ts is Deno TypeScript. CI has Deno; a developer machine here does
 * not, and a check that only runs in CI is a check that fails after the push
 * rather than before it. The file has no imports, so transpiling it with the
 * TypeScript compiler this repo already depends on gives a Node-runnable module
 * with identical logic and no shims.
 *
 * The DNS half of the validator is not exercised here — that needs the network
 * and a controlled zone. Everything asserted below is pure address arithmetic
 * and hostname policy, which is where the exploitable mistakes live.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'supabase', 'functions', '_shared', 'safeFetch.ts');

// Addresses that must be REFUSED. Each carries why it matters, because a
// reviewer six months from now needs to know which of these are load-bearing.
const MUST_BLOCK = [
  ['http://169.254.169.254/latest/meta-data/', 'AWS/GCP/Azure instance metadata — the classic SSRF prize'],
  ['http://169.254.170.2/v2/credentials', 'ECS task credentials endpoint'],
  ['http://metadata.google.internal/computeMetadata/v1/', 'GCP metadata by name'],
  ['http://127.0.0.1:80/', 'loopback'],
  ['http://127.1/', 'loopback in short form — URL parser normalises it to 127.0.0.1'],
  ['http://2130706433/', 'loopback as a decimal integer'],
  ['http://0177.0.0.1/', 'loopback with an octal first octet'],
  ['http://0x7f.0.0.1/', 'loopback with a hex first octet'],
  ['http://localhost/', 'loopback by name'],
  ['http://LOCALHOST/', 'loopback by name, uppercased'],
  ['http://0.0.0.0/', '"this network"'],
  ['http://10.0.0.5/', 'RFC1918 private'],
  ['http://172.16.0.1/', 'RFC1918 private, low end of the range'],
  ['http://172.31.255.254/', 'RFC1918 private, high end of the range'],
  ['http://192.168.1.1/', 'RFC1918 private — the home router'],
  ['http://100.64.0.1/', 'CGNAT space'],
  ['http://198.18.0.1/', 'benchmarking range'],
  ['http://224.0.0.1/', 'multicast'],
  ['http://255.255.255.255/', 'broadcast'],
  ['http://[::1]/', 'IPv6 loopback'],
  ['http://[::]/', 'IPv6 unspecified'],
  ['http://[fd00::1]/', 'IPv6 unique-local'],
  ['http://[fe80::1]/', 'IPv6 link-local'],
  ['http://[::ffff:169.254.169.254]/', 'metadata address smuggled as IPv4-mapped IPv6'],
  ['http://[::ffff:127.0.0.1]/', 'loopback smuggled as IPv4-mapped IPv6'],
  ['http://[64:ff9b::7f00:1]/', 'loopback smuggled through the NAT64 well-known prefix'],
  ['http://[2002:7f00:1::]/', 'loopback smuggled through a 6to4 address'],
  ['http://router/', 'single-label host — only resolvable via a local search domain'],
  ['http://printer.local/', 'mDNS .local'],
  ['http://db.internal/', '.internal'],
  ['http://svc.lan/', '.lan'],
  ['file:///etc/passwd', 'non-http scheme'],
  ['gopher://example.com/', 'non-http scheme'],
  ['http://user:pass@example.com/', 'embedded credentials'],
  ['http://example.com:8080/', 'non-standard port — internal services live here'],
  ['http://example.com:22/', 'SSH port'],
  ['', 'empty input'],
];

// Addresses that must be ACCEPTED by the address policy. These are ordinary
// public websites; a validator that rejects them is useless in the product.
// DNS is skipped for these (see the header note) — only the policy is asserted.
const MUST_ALLOW = [
  'https://example.com/',
  'https://www.example.co.uk/about',
  'example.com',
  'http://example.com:80/',
  'https://example.com:443/',
  'https://sub.domain.example.org/path?q=1#frag',
];

function transpile() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safefetch-'));
  const file = path.join(dir, 'safeFetch.mjs');
  // The module references the Deno namespace for the DNS branch. Node has no
  // such global, so declare one that reports DNS as unavailable — which is the
  // documented degraded path, and exactly the path we want to test, since it
  // isolates the address policy from the network.
  fs.writeFileSync(file, `globalThis.Deno = globalThis.Deno ?? {};\n${output}`, 'utf8');
  return { file, dir };
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`✖ check-ssrf-blocklist: ${SOURCE} not found`);
    process.exit(1);
  }

  const { file, dir } = transpile();
  const failures = [];

  try {
    const mod = await import(require('node:url').pathToFileURL(file).href);
    const { assertPublicUrl } = mod;

    if (typeof assertPublicUrl !== 'function') {
      console.error('✖ check-ssrf-blocklist: safeFetch.ts must export assertPublicUrl');
      process.exit(1);
    }

    for (const [url, why] of MUST_BLOCK) {
      let blocked = false;
      try {
        await assertPublicUrl(url);
      } catch (err) {
        blocked = err && err.name === 'BlockedUrlError';
        if (!blocked) {
          failures.push(`${JSON.stringify(url)} threw ${err && err.name}, not BlockedUrlError (${why})`);
          continue;
        }
      }
      if (!blocked) {
        failures.push(`NOT BLOCKED: ${JSON.stringify(url)} — ${why}`);
      }
    }

    // Capture warnings rather than letting them scroll past: the degraded-DNS
    // path MUST be loud, and asserting that is worth more than reading it.
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));

    try {
      for (const url of MUST_ALLOW) {
        try {
          await assertPublicUrl(url);
        } catch (err) {
          failures.push(
            `WRONGLY BLOCKED: ${JSON.stringify(url)} is an ordinary public address but was refused ` +
            `(${err && err.message})`,
          );
        }
      }
    } finally {
      console.warn = realWarn;
    }

    // Law 3: nothing may silently degrade. With DNS unavailable the validator
    // is running on name and literal checks alone, and it has to say so.
    const degradedWarnings = warnings.filter((w) => w.includes('dns_check_unavailable'));
    if (degradedWarnings.length !== MUST_ALLOW.length) {
      failures.push(
        `The DNS check degraded silently: expected ${MUST_ALLOW.length} dns_check_unavailable ` +
        `warnings when Deno.resolveDns is absent, got ${degradedWarnings.length}. A validator ` +
        'running with half its checks disabled must never do so quietly.',
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-ssrf-blocklist FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}`);
    console.error('');
    process.exit(1);
  }

  console.log(
    `\x1b[32m✔ check-ssrf-blocklist\x1b[0m  ${MUST_BLOCK.length} hostile addresses refused, ` +
    `${MUST_ALLOW.length} ordinary addresses accepted.`,
  );
}

main().catch((err) => {
  console.error('✖ check-ssrf-blocklist crashed:', err);
  process.exit(1);
});
