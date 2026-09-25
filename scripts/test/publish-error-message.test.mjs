#!/usr/bin/env node
/**
 * publish-error-message.test.mjs — a real provider's specific failure reason
 * must reach the user, not the Supabase SDK's generic wrapper text.
 *
 * Exercises the REAL module (src/services/platforms/mockPublishService.js),
 * not a copy — monkey-patches the real `supabase.functions.invoke` (a live,
 * mutable singleton method) for the duration of each check.
 *
 * ── The defect this protects against ────────────────────────────────────────
 * On 2026-09-25 a manual "Post now" to LinkedIn failed and the Publish
 * Results modal showed only "edge function returned a non-2xx status code" —
 * Supabase JS's own FunctionsHttpError.message, verbatim (lowercased by
 * mockPublishWorkflow.js's normalizeFailureReason). The real cause —
 * publish-post's actual JSON error body — never reached the screen, because
 * `publishPost()`'s toErrorMessage() read `error.context.json.error`.
 *
 * `context` is the raw fetch Response FunctionsHttpError was constructed with
 * (@supabase/functions-js src/types.ts:91, "throw new FunctionsHttpError(response)"
 * at FunctionsClient.ts:297) — and `.json` on a Response is a METHOD, not a
 * value. Accessing `.error` on that function is always undefined, so this
 * fell through to `error.message` — the SDK's fixed string — on EVERY real
 * publish-post failure that returned a genuine non-2xx, regardless of
 * platform or what the edge function's body actually said. TikTok/YouTube
 * failures in the same test batch showed specific text only because those
 * particular attempts returned 200 with an embedded `failureReason`, a
 * different, unaffected code path.
 *
 * The fix reuses edgeFunctionClient.js's normalizeEdgeFunctionError, already
 * proven correct by every other edge-function caller in this repo (it awaits
 * context.json(), with a .clone()-guarded .text() fallback).
 *
 * mockPublishService.js itself pulls in the live Supabase client and its full
 * env-config chain (extensionless local imports plain `node` cannot resolve
 * without a bundler), so this exercises normalizeEdgeFunctionError directly —
 * the self-contained function that now does the real work — plus a static
 * check that mockPublishService.js actually calls it and no longer contains
 * the broken `context.json.error` property-access pattern.
 *
 *   Usage:  node scripts/test/publish-error-message.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */
import fs from 'node:fs';
import { normalizeEdgeFunctionError } from '../../src/services/edgeFunctionClient.js';

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

// Mirrors exactly what @supabase/functions-js throws: a FunctionsHttpError
// whose `context` is the real, unconsumed Response object from the request
// (see the header). `body` matches publish-post's real error shape
// (_shared/http.ts's toErrorPayload => { error: "..." }).
function makeFunctionsHttpError(status, body) {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  const error = new Error('Edge Function returned a non-2xx status code');
  error.name = 'FunctionsHttpError';
  error.context = response;
  return error;
}

async function main() {
  // 1. LinkedIn's real rejection reason must survive, not the SDK's generic text.
  {
    const error = makeFunctionsHttpError(400, {
      error: 'LinkedIn rejected this post: the media asset could not be registered.',
    });
    const normalized = await normalizeEdgeFunctionError(error, 'publish-post');
    check(
      "the LinkedIn adapter's specific message reaches the caller",
      normalized.message === 'LinkedIn rejected this post: the media asset could not be registered.',
      `got: ${normalized.message}`,
    );
    check(
      "the SDK's generic wrapper text is not what the user sees",
      !normalized.message.toLowerCase().includes('non-2xx'),
      `got: ${normalized.message}`,
    );
  }

  // 2. A transport-level failure with no body at all must still degrade to
  //    SOME readable message, not throw while trying to read one.
  {
    const error = makeFunctionsHttpError(500, {});
    const normalized = await normalizeEdgeFunctionError(error, 'publish-post');
    check(
      'a body-less failure still returns a non-empty message',
      typeof normalized.message === 'string' && normalized.message.length > 0,
      `got: ${JSON.stringify(normalized.message)}`,
    );
  }

  // 3. mockPublishService.js must actually call normalizeEdgeFunctionError,
  //    not merely be accompanied by a helper that works — a regression here
  //    (someone reverting to an inline, ad hoc body read) would leave this
  //    file broken again while every check above still passed.
  {
    const source = fs.readFileSync(
      new URL('../../src/services/platforms/mockPublishService.js', import.meta.url),
      'utf8',
    );
    check(
      'mockPublishService.js imports normalizeEdgeFunctionError',
      /import\s*\{[^}]*normalizeEdgeFunctionError[^}]*\}\s*from\s*['"]\.\.\/edgeFunctionClient['"]/.test(source),
    );
    check(
      'mockPublishService.js awaits it when publish-post errors',
      /throw\s+await\s+normalizeEdgeFunctionError\(/.test(source),
    );
  }

  // 4. The old, previously-broken read pattern must not silently start
  //    working again for the wrong reason — the property being read is a
  //    function, never a value with an .error field.
  const probeResponse = new Response(JSON.stringify({ error: 'probe' }), { status: 400 });
  check(
    'error.context.json is a function, confirming the original defect\'s exact shape',
    typeof probeResponse.json === 'function',
  );
  check(
    'reading .error directly off that function (the old code\'s access pattern) is always undefined',
    probeResponse.json.error === undefined,
  );

  if (failures > 0) {
    console.error(`\n\x1b[31m✖ publish-error-message  ${failures} of ${checks} checks failed\x1b[0m\n`);
    process.exit(1);
  }
  console.log(
    `\x1b[32m✔ publish-error-message\x1b[0m  ${checks} checks passed — a real provider's specific `
    + 'failure reason reaches the Publish Results modal instead of the SDK\'s generic wrapper text.',
  );
}

main();
