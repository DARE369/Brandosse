#!/usr/bin/env node
/**
 * check-direct-oauth-wiring
 *
 * "Connected but cannot publish" is this repository's signature defect. It has
 * shipped at least three times: four `provider='direct'` accounts rendering
 * green "Healthy" while structurally unable to publish (20260821220000), a
 * LinkedIn insert rejected by a frozen CHECK constraint at the end of a
 * successful OAuth flow (20260904180000), and TikTok cleared through consent
 * only to fail every token exchange on a wrong parameter name
 * (docs/handoff/2026-09-09 §4.1).
 *
 * Every one of those was a chain with a link missing in the middle. This guard
 * checks the chain.
 *
 * ── The chain ────────────────────────────────────────────────────────────────
 * For a platform to work end to end, FOUR things must agree, and they live in
 * four files that nothing else forces to stay in step:
 *
 *   1. src/services/platforms/connectionService.js — DIRECT_OAUTH_PLATFORMS.
 *      The UI consults this set to decide whether to start a real OAuth flow.
 *      A platform ABSENT here falls through to the mock fallback and the user
 *      is handed a fake account that renders as connected and never publishes.
 *
 *   2. app/api/auth/social/[provider]/callback/route.js — the DISCOVERY map.
 *      Absent, the callback throws `discovery_unimplemented` AFTER the user has
 *      already granted consent. Fails closed, but only at the last step.
 *
 *   3. supabase/functions/_shared/<platform>.service.ts — the adapter itself.
 *
 *   4. supabase/functions/publish-post/index.ts — the provider dispatch.
 *      Absent, publishing returns "No publishing adapter for provider X" for an
 *      account the UI has been showing as healthy since the day it connected.
 *
 * ── Why the set is checked in this direction ─────────────────────────────────
 * DIRECT_OAUTH_PLATFORMS is the PROMISE: listing a platform there tells users
 * they can connect it for real. So everything in that set must be backed by the
 * other three. The reverse is deliberately allowed — an adapter can exist
 * before the UI offers it, which is exactly how a platform gets built and
 * tested before launch.
 *
 * The comment above DIRECT_OAUTH_PLATFORMS already states the rule in prose:
 * "Add a platform here only once its adapter exists in publish-post —
 * otherwise the connect flow succeeds and publishing then fails." A rule that
 * only exists in a comment is a rule nobody is checking.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const CONNECTION_SERVICE = path.join(ROOT, "src", "services", "platforms", "connectionService.js");
const CALLBACK_ROUTE = path.join(ROOT, "app", "api", "auth", "social", "[provider]", "callback", "route.js");
const DISCONNECT_ROUTE = path.join(ROOT, "app", "api", "auth", "social", "[provider]", "disconnect", "route.js");
const PUBLISH_POST = path.join(ROOT, "supabase", "functions", "publish-post", "index.ts");
const SHARED_DIR = path.join(ROOT, "supabase", "functions", "_shared");

const failures = [];

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function missing(file) {
  failures.push(
    `${path.relative(ROOT, file)} is missing. This guard's target moved — repoint it\n`
    + "    rather than deleting it. Without this check, a platform can be offered in the UI\n"
    + "    with no adapter behind it, which is the defect this exists to prevent.",
  );
}

// ── Source 1: what the UI promises ──────────────────────────────────────────

const connectionSrc = read(CONNECTION_SERVICE);
let promised = [];

if (connectionSrc === null) {
  missing(CONNECTION_SERVICE);
} else {
  const m = connectionSrc.match(/DIRECT_OAUTH_PLATFORMS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  if (!m) {
    failures.push(
      "Could not find DIRECT_OAUTH_PLATFORMS in connectionService.js, or its shape changed.\n"
      + "    Either way this guard has stopped checking, which is indistinguishable from\n"
      + "    passing. Repoint the pattern.",
    );
  } else {
    promised = [...m[1].matchAll(/['"`]([a-z0-9_]+)['"`]/gi)].map((x) => x[1]);
    if (promised.length === 0) {
      failures.push("DIRECT_OAUTH_PLATFORMS is empty — no platform can be connected for real.");
    }
  }
}

// ── Source 2: account discovery ─────────────────────────────────────────────

const callbackSrc = read(CALLBACK_ROUTE);
let discovered = [];

if (callbackSrc === null) {
  missing(CALLBACK_ROUTE);
} else {
  const m = callbackSrc.match(/const DISCOVERY\s*=\s*\{([^}]*)\}/);
  if (!m) {
    failures.push(
      "Could not find the DISCOVERY map in the callback route. This guard has stopped\n"
      + "    checking whether a connected platform can identify the account it just authorised.",
    );
  } else {
    discovered = [...m[1].matchAll(/([a-z0-9_]+)\s*:/gi)].map((x) => x[1]);
  }
}

// ── Sources 3 and 4: the adapter and its dispatch ───────────────────────────

const publishSrc = read(PUBLISH_POST);
if (publishSrc === null) missing(PUBLISH_POST);

// ── Source 5: withdrawing the grant ─────────────────────────────────────────
//
// Connecting is half a promise. A user who disconnects believes they have taken
// the permission back, and if we only delete our own row the authorization sits
// live in their Google or TikTok settings indefinitely — a privacy claim we
// would be breaking invisibly. LinkedIn's API terms §4.4 and Google's OAuth
// policies both require it, so this is a compliance link in the chain, not a
// nicety.
//
// YouTube had no revoke endpoint from the day it shipped until 2026-09-17.
// Nothing noticed, because a missing revocation looks exactly like a successful
// one from inside the app.

const disconnectSrc = read(DISCONNECT_ROUTE);
let revocable = [];

if (disconnectSrc === null) {
  missing(DISCONNECT_ROUTE);
} else {
  const m = disconnectSrc.match(/const REVOKE_ENDPOINTS\s*=\s*\{([\s\S]*?)\n\};/);
  if (!m) {
    failures.push(
      "Could not find REVOKE_ENDPOINTS in the disconnect route, or its shape changed.\n"
      + "    This guard has stopped checking whether disconnecting actually withdraws the\n"
      + "    grant, which is indistinguishable from passing.",
    );
  } else {
    // Top-level keys only: each entry is an object, so nested keys like `url`
    // and `prefers` must not be mistaken for platforms.
    revocable = [...m[1].matchAll(/^\s{2}([a-z0-9_]+)\s*:/gim)].map((x) => x[1]);
  }
}

// ── The chain, per promised platform ────────────────────────────────────────

for (const platform of promised) {
  if (callbackSrc !== null && !discovered.includes(platform)) {
    failures.push(
      `"${platform}" is offered as a real connection but has NO entry in the DISCOVERY map\n`
      + `    (${path.relative(ROOT, CALLBACK_ROUTE)}).\n`
      + "    The user would grant consent on the platform, be redirected back, and only THEN\n"
      + "    hit `discovery_unimplemented` — after handing over access. Fails closed, but at\n"
      + "    the most expensive possible moment.",
    );
  }

  const adapter = path.join(SHARED_DIR, `${platform}.service.ts`);
  if (!fs.existsSync(adapter)) {
    failures.push(
      `"${platform}" is offered as a real connection but there is no adapter at\n`
      + `    supabase/functions/_shared/${platform}.service.ts.\n`
      + "    Connecting would succeed and publishing would then fail — the exact sequence the\n"
      + "    comment above DIRECT_OAUTH_PLATFORMS warns against.",
    );
  }

  if (disconnectSrc !== null && revocable.length > 0 && !revocable.includes(platform)) {
    failures.push(
      `"${platform}" is offered as a real connection but has NO entry in REVOKE_ENDPOINTS\n`
      + `    (${path.relative(ROOT, DISCONNECT_ROUTE)}).\n`
      + "    Disconnecting would delete our row and leave the grant live in the user's account\n"
      + "    settings. They would believe they had revoked access; they would be wrong, and\n"
      + "    nothing in the product would ever tell them. If the platform genuinely has no\n"
      + "    revoke endpoint, add the entry with a comment saying so rather than omitting it.",
    );
  }

  if (publishSrc !== null) {
    // The dispatch tests the provider by string equality. Accept either quote
    // style; what matters is that the branch exists at all.
    const dispatched = new RegExp(`provider\\s*===\\s*["'\`]${platform}["'\`]`).test(publishSrc);
    if (!dispatched) {
      failures.push(
        `"${platform}" is offered as a real connection but publish-post/index.ts never\n`
        + `    dispatches on provider === "${platform}".\n`
        + "    Every post to this platform would return \"No publishing adapter for provider\n"
        + `    ${platform}. Reconnect this account.\" — telling the user to fix a connection\n`
        + "    that is perfectly fine.",
      );
    }
  }
}

// ── The prose rule, kept honest ─────────────────────────────────────────────
//
// The comment above DIRECT_OAUTH_PLATFORMS is load-bearing documentation: it is
// where the next person learns the rule. If it is deleted, the rule survives
// only here, and a guard with no stated reason gets removed as noise.

// Whitespace-tolerant: the sentence wraps across lines with a ' * ' comment
// prefix, so a literal match fails on formatting rather than on meaning.
const RULE_STATED = /Add a platform here only once[\s*]+its adapter exists/;
if (connectionSrc !== null && !RULE_STATED.test(connectionSrc)) {
  failures.push(
    "The comment above DIRECT_OAUTH_PLATFORMS explaining WHY a platform may only be added\n"
    + "    once its adapter exists has been removed or reworded.\n"
    + "    Restore it. This guard enforces the rule; that comment is where anyone reading the\n"
    + "    code finds out it exists.",
  );
}

if (failures.length > 0) {
  console.error("Direct-OAuth wiring guardrail failed.\n");
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}

console.log(
  `Direct-OAuth wiring passed — ${promised.length} platform(s) offered for real connection `
  + `(${promised.join(", ")}), each with discovery, an adapter, and a publish dispatch branch.`,
);
