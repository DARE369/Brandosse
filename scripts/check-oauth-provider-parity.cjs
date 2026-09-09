#!/usr/bin/env node
/**
 * check-oauth-provider-parity
 *
 * Two guards over the OAuth credential plumbing, both of which exist because
 * the exact defects below were shipped and went unnoticed.
 *
 * ── 1. The credential parameter name must not be hardcoded ───────────────────
 * TikTok names its client credential `client_key`, not `client_id`, on BOTH
 * the authorize and the token endpoint. socialProviders.js records that as
 * `clientIdParam`, with a comment warning that getting it wrong "yields an
 * opaque error that reads like a bad secret".
 *
 * connect/route.js honoured it. callback/route.js hardcoded `client_id` and
 * ignored it. TikTok therefore cleared the consent screen and failed every
 * token exchange — no TikTok account could be connected at all, and the error
 * pointed at the secret rather than the parameter name. The whole TikTok
 * publish path sat behind that, untestable, with nothing failing loudly.
 *
 * ── 2. The Deno copy of the provider table must not drift ────────────────────
 * supabase/functions/refresh-social-tokens/ cannot import socialProviders.js:
 * that file is Next.js/Node, the worker is Deno, and no build step bridges
 * them. So it keeps its own small copy. Divergence there is silent — a stale
 * token URL would fail only at refresh time, hours later, on a background job
 * nobody watches, and would surface to the user as an unexplained
 * "reconnect your account".
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = path.join(ROOT, "app", "api", "_lib", "socialProviders.js");
const WORKER = path.join(ROOT, "supabase", "functions", "refresh-social-tokens", "index.ts");

// Routes that send client credentials to a provider's token endpoint.
const CREDENTIAL_ROUTES = [
  path.join(ROOT, "app", "api", "auth", "social", "[provider]", "callback", "route.js"),
  path.join(ROOT, "app", "api", "auth", "social", "[provider]", "connect", "route.js"),
];

const failures = [];

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/**
 * Pull `key: 'value'` pairs out of each top-level provider block.
 *
 * Deliberately regex over a real parse: the alternative is executing or
 * transpiling a Next.js module inside a CI guard, which is a far larger
 * surface than the two string fields being compared. Anything unparseable is
 * reported rather than skipped, so the guard cannot pass by failing to look.
 */
function extractProviders(source, fields) {
  const out = {};
  // A provider block opens with `<id>: {` at two-space indentation.
  const blockRe = /^ {2}(\w+):\s*\{$/gm;
  let match;
  while ((match = blockRe.exec(source)) !== null) {
    const id = match[1];
    const rest = source.slice(match.index + match[0].length);
    // Ends at the first line that closes the block at the same indentation.
    const end = rest.search(/^ {2}\},?$/m);
    const body = end === -1 ? rest : rest.slice(0, end);

    const found = {};
    for (const field of fields) {
      const fieldRe = new RegExp(`^\\s*${field}:\\s*['"\`]([^'"\`]+)['"\`]`, "m");
      const fm = body.match(fieldRe);
      if (fm) found[field] = fm[1];
    }
    out[id] = found;
  }
  return out;
}

// ── Guard 1: no hardcoded credential parameter ───────────────────────────────

for (const file of CREDENTIAL_ROUTES) {
  const src = read(file);
  const rel = path.relative(ROOT, file);
  if (src === null) {
    failures.push(`${rel} is missing. This guard's target moved — repoint it rather than deleting it.`);
    continue;
  }

  src.split("\n").forEach((line, i) => {
    // A literal `client_id:` key sent alongside the secret. The correct form is
    // the computed key [providerConfig.clientIdParam || 'client_id'].
    if (/^\s*client_id:\s*providerConfig/.test(line)) {
      failures.push(
        `${rel}:${i + 1} hardcodes \`client_id\` when building a credential payload.\n`
        + "    Use [providerConfig.clientIdParam || 'client_id'] instead — TikTok requires\n"
        + "    `client_key`, and sending the wrong name fails in a way that reads like a\n"
        + "    bad secret rather than a wrong parameter.",
      );
    }
  });
}

// ── Guard 2: registry and Deno worker agree ──────────────────────────────────

const registrySrc = read(REGISTRY);
const workerSrc = read(WORKER);

if (registrySrc === null) {
  failures.push(`${path.relative(ROOT, REGISTRY)} is missing — the OAuth provider registry moved.`);
} else if (workerSrc === null) {
  failures.push(
    `${path.relative(ROOT, WORKER)} is missing. If the refresh worker was removed, remove this\n`
    + "    guard with it — but a repo with stored refresh tokens and no refresher lets every\n"
    + "    connected account silently expire, which is what this worker was built to stop.",
  );
} else {
  const FIELDS = ["tokenUrl", "clientIdParam"];
  const registry = extractProviders(registrySrc, FIELDS);
  const worker = extractProviders(workerSrc, FIELDS);

  const shared = Object.keys(worker).filter((id) => id in registry);

  if (shared.length === 0) {
    failures.push(
      "The refresh worker declares no provider that the registry also declares.\n"
      + "    Either the worker's PROVIDERS table is empty, or this guard's block parsing\n"
      + "    has stopped matching the file's shape. Both mean it is no longer checking.",
    );
  }

  for (const id of shared) {
    for (const field of FIELDS) {
      const a = registry[id][field];
      const b = worker[id][field];

      // clientIdParam is optional in the registry (it defaults to client_id),
      // but if the worker states one, the registry must agree.
      if (b === undefined) continue;
      const expected = a === undefined && field === "clientIdParam" ? "client_id" : a;

      if (expected !== b) {
        failures.push(
          `Provider "${id}" disagrees on ${field}:\n`
          + `      registry (app/api/_lib/socialProviders.js): ${expected ?? "<absent>"}\n`
          + `      worker   (refresh-social-tokens/index.ts):  ${b}\n`
          + "    These must match. The worker cannot import the registry (Node vs Deno), so\n"
          + "    drift is only ever caught here — at refresh time it fails on a background\n"
          + "    job and reaches the user as an unexplained reconnect prompt.",
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("OAuth provider parity guardrail failed.\n");
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}

console.log(
  "OAuth provider parity passed — no hardcoded credential parameter, and the Deno "
  + "refresh worker matches the provider registry.",
);
