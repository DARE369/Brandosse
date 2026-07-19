// verify-rate-limit.js
//
// WHAT THIS CHECKS: check_rate_limit()'s advisory-lock-based concurrency
// safety (Week 2 Fix 5 + Addendum Upgrade 3) under REAL parallel load —
// does firing 15 truly-simultaneous requests against a 10/min limit let
// through exactly 10, or does the read-then-write race let 11 (or more)
// through, or incorrectly block 9 (or fewer)?
//
// Uses enhance-prompt (configured limit: 10/min — see
// _shared/rateLimit.ts RATE_LIMITS). Calls the function directly over HTTP
// (not through the app) so the exact response status/body of every one of
// the 15 calls is visible to this script.
//
// Closes: FIXLOG Week 2 Fix 5 "Could not verify: actual wall-clock behavior
// of the advisory-lock-based concurrency safety under real parallel load
// (e.g. firing 20 simultaneous requests via a script and confirming exactly
// 10 succeed, not 9 or 11)."
'use strict';

const { loadEnv, signIn, section, pass, fail, info, finish, sleep } = require('./lib/helpers');

const FUNCTION_NAME = 'enhance-prompt';
const CONFIGURED_LIMIT = 10; // _shared/rateLimit.ts RATE_LIMITS['enhance-prompt']
const PARALLEL_CALLS = 15;

async function callEnhancePrompt(env, accessToken) {
  const url = `${env.SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: env.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ prompt: 'QA-VERIFY- rate limit test prompt, a friendly cartoon fox in a forest' }),
  });
  let body = null;
  try { body = await res.json(); } catch (_e) { /* non-JSON body, leave null */ }
  return { status: res.status, body };
}

async function main() {
  const env = loadEnv();

  section('SETUP');
  const { session } = await signIn(env, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD, 'TEST_USER');
  const accessToken = session.access_token;
  info(
    `About to fire ${PARALLEL_CALLS} truly-simultaneous calls to ${FUNCTION_NAME}`,
    `Configured limit: ${CONFIGURED_LIMIT}/min. Expect exactly ${CONFIGURED_LIMIT} to succeed and ` +
    `${PARALLEL_CALLS - CONFIGURED_LIMIT} to get 429.\n` +
    `NOTE: if you've called enhance-prompt (via the app or a prior run of this script) in the last 60s, ` +
    `some of your quota may already be used — for a clean result, wait 60s since your last enhance-prompt ` +
    `call before running this script.`,
  );

  section(`FIRING ${PARALLEL_CALLS} PARALLEL CALLS`);
  const results = await Promise.all(
    Array.from({ length: PARALLEL_CALLS }, () => callEnhancePrompt(env, accessToken)),
  );

  const succeeded = results.filter((r) => r.status === 200);
  const rateLimited = results.filter((r) => r.status === 429);
  const other = results.filter((r) => r.status !== 200 && r.status !== 429);

  info('Raw status code split', JSON.stringify({
    succeeded_200: succeeded.length,
    rate_limited_429: rateLimited.length,
    other_unexpected: other.map((r) => r.status),
  }));

  section('VERDICT — did exactly 10 succeed and exactly 5 get 429?');
  if (other.length > 0) {
    fail(
      `${other.length} call(s) returned an unexpected status code (neither 200 nor 429)`,
      `Statuses/bodies: ${JSON.stringify(other, null, 2)}\n` +
      `This usually means an auth or validation problem unrelated to rate limiting — fix that first.`,
    );
  } else if (succeeded.length === CONFIGURED_LIMIT && rateLimited.length === PARALLEL_CALLS - CONFIGURED_LIMIT) {
    pass(
      `Exactly ${CONFIGURED_LIMIT} succeeded and exactly ${PARALLEL_CALLS - CONFIGURED_LIMIT} were rate-limited`,
      'The advisory-lock-based concurrency guard in check_rate_limit() is serializing correctly under real parallel load.',
    );
  } else {
    fail(
      `Expected exactly ${CONFIGURED_LIMIT}/${PARALLEL_CALLS - CONFIGURED_LIMIT} split, got ${succeeded.length}/${rateLimited.length}`,
      succeeded.length > CONFIGURED_LIMIT
        ? 'MORE than the configured limit succeeded — this means the advisory-lock read-then-insert sequence ' +
          'in check_rate_limit() is NOT actually serializing concurrent calls for this (user, function) pair. ' +
          'This is exactly the race the lock was built to prevent.'
        : 'FEWER than the configured limit succeeded — either your quota was already partially used before this ' +
          'run (see the NOTE above — wait 60s and retry), or check_rate_limit() is over-counting.',
    );
  }

  section('VERDICT — does every 429 carry a numeric retry_after_seconds?');
  const retryValues = rateLimited.map((r) => r.body?.retry_after_seconds);
  const allNumeric = retryValues.length > 0 && retryValues.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  info('retry_after_seconds values observed', JSON.stringify(retryValues));
  if (allNumeric) {
    pass('Every 429 response carried a real, positive numeric retry_after_seconds.');
  } else if (rateLimited.length === 0) {
    fail('No 429 responses were received at all, so this cannot be checked — see the split verdict above.');
  } else {
    fail(
      'At least one 429 response was missing a valid numeric retry_after_seconds',
      `Raw bodies: ${JSON.stringify(rateLimited.map((r) => r.body), null, 2)}\n` +
      `Check _shared/http.ts toErrorPayload() and _shared/rateLimit.ts createRateLimitError() — the field ` +
      `must be named exactly "retry_after_seconds" (snake_case) in the JSON body.`,
    );
  }

  if (retryValues.length > 0 && allNumeric) {
    const waitSeconds = Math.max(...retryValues) + 1;
    section(`WAITING ${waitSeconds}s (max retry_after_seconds + 1) THEN FIRING ONE MORE CALL`);
    await sleep(waitSeconds * 1000);
    const final = await callEnhancePrompt(env, accessToken);
    if (final.status === 200) {
      pass('After waiting out the window, a fresh call succeeded as expected.');
    } else {
      fail(
        `After waiting ${waitSeconds}s, the follow-up call still did not succeed (status ${final.status})`,
        `Body: ${JSON.stringify(final.body)}\n` +
        `The sliding window may not actually be clearing events after they age out — check ` +
        `check_rate_limit()'s "now() - window_seconds" lookback logic and its per-call cleanup.`,
      );
    }
  } else {
    info('Skipping the "wait it out and retry" check — no valid retry_after_seconds to wait on (see verdict above).');
  }

  finish();
}

main().catch((err) => {
  console.error('\nUNEXPECTED SCRIPT ERROR:', err);
  process.exitCode = 1;
});
