#!/usr/bin/env node
/**
 * check-oauth-scope-coverage
 *
 * OAuth scope sets are decided ONCE, at first consent, and are the most
 * expensive thing in this integration to get wrong.
 *
 * ── Why a guard rather than a comment ────────────────────────────────────────
 * A scope that is missing from the authorize request does not fail at connect.
 * It fails later, on the first API call that needed it, as a 401 or an empty
 * result — and the fix is not a code change, it is asking every connected user
 * to disconnect and reconnect. There is no way to widen a granted token in
 * place. A scope silently dropped in a refactor is therefore a defect whose
 * blast radius is "every user who connected since", discovered weeks after the
 * commit that caused it.
 *
 * That is the same shape as the `client_key` defect recorded in
 * docs/handoff/2026-09-09: correct config, one caller ignoring it, a failure
 * that blames something else entirely.
 *
 * Note what this does NOT replace. scripts/smoke-tiktok-publish.mjs checks
 * `granted_scopes` on an account that is already connected — by then the token
 * has been issued and a missing scope can only be fixed by reconnecting. This
 * guard checks what we ASK for, before anyone connects.
 *
 * ── The four assertions ──────────────────────────────────────────────────────
 *   1. Every scope this product's features REQUIRE is actually requested.
 *      The table below is an independent restatement of what each capability
 *      needs; if it and the registry disagree, one of them is wrong and a
 *      human should decide which.
 *   2. `pendingScopes` never leak into `scopes`. A pending scope is one the
 *      platform has not yet approved, and requesting one early is fatal to the
 *      WHOLE authorization, not just that scope (LinkedIn returns 401 "Invalid
 *      scope"). This is a gate, so it is checked rather than trusted.
 *   3. TikTok declares a comma scope separator. TikTok documents a
 *      comma-separated scope string while RFC 6749 and every other provider
 *      here use a space.
 *   4. The connect route serialises scopes through authorizeScopeParam() and
 *      never hardcodes a delimiter — which is what makes assertion 3 load-
 *      bearing rather than decorative.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = path.join(ROOT, "app", "api", "_lib", "socialProviders.js");
const CONNECT_ROUTE = path.join(
  ROOT, "app", "api", "auth", "social", "[provider]", "connect", "route.js",
);

/**
 * What each capability genuinely needs, per platform.
 *
 * Deliberately duplicated from the registry rather than derived from it: a
 * guard that reads its expectations out of the file it is checking asserts
 * only that the file equals itself. Each entry cites the capability that
 * justifies it, because an unused scope is a real cost at app review — both
 * Google and TikTok assess scopes one at a time against a demonstrated use.
 *
 * `optional: true` marks a scope the product wants but the platform has not
 * approved yet. Those must appear in `pendingScopes`, not `scopes`.
 */
const REQUIRED_SCOPES = {
  tiktok: {
    publish: ["video.publish"],
    // open_id is the account identity the connection is keyed on.
    connect: ["user.info.basic"],
    // The only analytics TikTok exposes: per-video lifetime counters via
    // video.list, and account totals via user.info.stats.
    analytics: ["video.list", "user.info.stats"],
  },
  youtube: {
    publish: ["https://www.googleapis.com/auth/youtube.upload"],
    // channels.list for discovery; videos.list to poll processing status,
    // because an accepted upload is not yet a published video.
    connect: ["https://www.googleapis.com/auth/youtube.readonly"],
    analytics: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
  },
  linkedin: {
    publish: ["w_member_social"],
    connect: ["openid", "profile"],
    // Gated on LinkedIn approving the Member Post Analytics product. Until
    // then this must stay OUT of the request: an unapproved scope returns 401
    // and breaks connect for everyone, and changing the scope set invalidates
    // every access token already issued.
    analytics: [{ scope: "r_member_postAnalytics", optional: true }],
  },
};

const failures = [];

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/** Isolate one top-level provider block's body, or null if it is not there. */
function providerBody(source, providerId) {
  const blockRe = new RegExp(`^ {2}${providerId}:\\s*\\{$`, "m");
  const m = source.match(blockRe);
  if (!m) return null;
  const rest = source.slice(source.search(blockRe) + m[0].length);
  const end = rest.search(/^ {2}\},?$/m);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Pull a string-array field out of a provider block.
 *
 * Regex over a real parse for the same reason check-oauth-provider-parity.cjs
 * does it: the alternative is transpiling a Next.js ESM module inside a CI
 * guard. Anything unparseable is REPORTED, never skipped — a guard that passes
 * because it failed to look is worse than no guard.
 */
function extractArrayField(body, field) {
  if (body === null) return { found: false, values: [] };
  const m = body.match(new RegExp(`^\\s{4}${field}:\\s*\\[([\\s\\S]*?)\\]`, "m"));
  if (!m) return { found: false, values: [] };
  return { found: true, values: [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]) };
}

function extractStringField(body, field) {
  if (body === null) return null;
  const m = body.match(new RegExp(`^\\s*${field}:\\s*['"\`]([^'"\`]*)['"\`]`, "m"));
  return m ? m[1] : null;
}

const registrySrc = read(REGISTRY);

if (registrySrc === null) {
  failures.push(
    `${path.relative(ROOT, REGISTRY)} is missing — the OAuth provider registry moved.\n`
    + "    Repoint this guard rather than deleting it.",
  );
} else {
  for (const [providerId, capabilities] of Object.entries(REQUIRED_SCOPES)) {
    const body = providerBody(registrySrc, providerId);
    const granted = extractArrayField(body, "scopes");
    const pending = extractArrayField(body, "pendingScopes");

    if (!granted.found) {
      failures.push(
        `Provider "${providerId}" declares no \`scopes\` array in the registry, or this\n`
        + "    guard's block parsing no longer matches the file's shape. Either way it has\n"
        + "    stopped checking, which is indistinguishable from passing.",
      );
      continue;
    }

    for (const [capability, scopes] of Object.entries(capabilities)) {
      for (const entry of scopes) {
        const scope = typeof entry === "string" ? entry : entry.scope;
        const optional = typeof entry === "object" && entry.optional === true;

        const isGranted = granted.values.includes(scope);
        const isPending = pending.values.includes(scope);

        // ── Assertion 2: a pending scope must not be requested ──────────────
        if (isGranted && isPending) {
          failures.push(
            `Provider "${providerId}" lists "${scope}" in BOTH \`scopes\` and \`pendingScopes\`.\n`
            + "    A pending scope is one the platform has not approved. Requesting it fails the\n"
            + "    ENTIRE authorization, not just that scope — LinkedIn returns 401 \"Invalid\n"
            + "    scope\" and no user can connect. Remove it from one list or the other.",
          );
          continue;
        }

        if (isGranted) continue;

        if (optional) {
          // ── Assertion 2b: an unapproved scope must be recorded, not lost ──
          if (!isPending) {
            failures.push(
              `Provider "${providerId}" is missing "${scope}" (capability: ${capability}).\n`
              + "    It is not approved yet, so it correctly cannot go in `scopes` — but it must\n"
              + "    then be declared in `pendingScopes` so the intent survives. A capability the\n"
              + "    product needs and nothing records is a capability that gets forgotten until a\n"
              + "    feature is built against it and fails.",
            );
          }
          continue;
        }

        // ── Assertion 1: a required scope is genuinely missing ──────────────
        failures.push(
          `Provider "${providerId}" does not request "${scope}", which ${capability} requires.\n`
          + "    Scopes are fixed at consent: this cannot be corrected for accounts that are\n"
          + "    already connected without asking every one of those users to disconnect and\n"
          + "    reconnect. Add it BEFORE the next account connects, not after.",
        );
      }
    }
  }

  // ── Assertion 3: TikTok's comma separator ─────────────────────────────────
  const tiktokSeparator = extractStringField(providerBody(registrySrc, "tiktok"), "scopeSeparator");
  if (tiktokSeparator !== ",") {
    failures.push(
      `TikTok must declare \`scopeSeparator: ','\` (found: ${
        tiktokSeparator === null ? "<absent>" : `'${tiktokSeparator}'`
      }).\n`
      + "    TikTok documents \"a comma (,) separated string of authorization scope(s)\";\n"
      + "    RFC 6749 and every other provider here use a space. Sending a space-joined\n"
      + "    string produces a well-formed request that fails on scopes, so the error points\n"
      + "    at the permissions rather than at the formatting.\n"
      + "    https://developers.tiktok.com/doc/login-kit-web/",
    );
  }
}

// ── Assertion 4: the route must not hardcode a delimiter ─────────────────────

const connectSrc = read(CONNECT_ROUTE);
if (connectSrc === null) {
  failures.push(`${path.relative(ROOT, CONNECT_ROUTE)} is missing — repoint this guard.`);
} else {
  if (/scopes\.join\(/.test(connectSrc)) {
    failures.push(
      `${path.relative(ROOT, CONNECT_ROUTE)} joins scopes inline.\n`
      + "    Use authorizeScopeParam(providerConfig) instead. The delimiter belongs to the\n"
      + "    provider — TikTok needs a comma — and a hardcoded join is correct for three\n"
      + "    providers and silently wrong for the fourth.",
    );
  }
  if (!/authorizeScopeParam\s*\(/.test(connectSrc)) {
    failures.push(
      `${path.relative(ROOT, CONNECT_ROUTE)} never calls authorizeScopeParam().\n`
      + "    Without it the per-provider scope separator is declared and then ignored, which\n"
      + "    is exactly how `clientIdParam` was honoured by connect and dropped by callback,\n"
      + "    blocking TikTok entirely (docs/handoff/2026-09-09 §4.1).",
    );
  }
}

if (failures.length > 0) {
  console.error("OAuth scope coverage guardrail failed.\n");
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}

console.log(
  "OAuth scope coverage passed — every required scope is requested, no unapproved "
  + "scope leaks into the request, and the connect route honours each provider's separator.",
);
