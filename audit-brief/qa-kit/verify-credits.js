// verify-credits.js
//
// WHAT THIS CHECKS: the Week 3 Fix 2 credit model end to end against the
// REAL generateImage edge function (not a mock): reserve-before-render
// concurrency safety, refund-on-post-reservation-failure, and idempotent
// replay (same request_id+request_slot -> cached response, no re-billing).
//
// COST NOTE: this script fires several real generateImage calls (each
// costs fal.ai API usage + would normally cost 1 credit — this script sets
// your balance directly via service-role before each case and restores your
// ORIGINAL balance/lifetime_consumed at the end, regardless of pass/fail).
//
// Closes: FIXLOG Week 3 Fix 0/Fix 2 "Could not verify: real concurrent-load
// behavior (e.g. firing the exact same request_id+slot from two parallel
// scripted requests and confirming only one actually renders) ... not
// executed against a live Postgres+Deno environment."
'use strict';

const {
  loadEnv, adminClient, signIn, section, pass, fail, info, skip, finish, qaTag, confirmCost, makeCleanupRegistry,
} = require('./lib/helpers');

const QA_PROMPT = 'QA-VERIFY- a simple flat-color icon of a coffee cup, minimal, white background';

function newRequestId() {
  return `${'QA-VERIFY'}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

async function insertPlaceholder(admin, userId, sessionId, requestId, requestSlot = 0) {
  const { data, error } = await admin
    .from('generations')
    .insert({
      user_id: userId, session_id: sessionId, prompt: QA_PROMPT, media_type: 'image',
      status: 'processing', request_id: requestId, request_slot: requestSlot,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function callGenerateImage(env, accessToken, body) {
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/generateImage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* ignore */ }
  return { status: res.status, body: json };
}

async function getCreditRow(admin, userId) {
  const { data, error } = await admin.from('user_credits').select('balance, lifetime_consumed').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function setBalance(admin, userId, balance) {
  const { error } = await admin.from('user_credits').update({ balance }).eq('user_id', userId);
  if (error) throw error;
}

async function main() {
  const env = loadEnv();
  const admin = adminClient(env);
  const cleanup = makeCleanupRegistry(admin);

  section('SETUP');
  const proceed = await confirmCost(
    'This script fires ~5 real generateImage calls against fal.ai (real API cost per image, ' +
    'typically a few cents each) to test credit reservation/refund/idempotency. It will change ' +
    'your test account\'s credit balance temporarily via service-role and restore the ORIGINAL ' +
    'balance at the end no matter what happens.',
  );
  if (!proceed) {
    skip('User declined the cost prompt — nothing was run.');
    finish();
    return;
  }

  const { user, session } = await signIn(env, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD, 'TEST_USER');
  const accessToken = session.access_token;

  const original = await getCreditRow(admin, user.id);
  if (!original) {
    fail(
      'No user_credits row exists for TEST_USER',
      'Generate at least one image via the app first (or purchase/receive starter credits) so a ' +
      'user_credits row exists, then re-run this script.',
    );
    finish();
    process.exit(1);
  }
  info('Original credit state (will be restored at the end)', JSON.stringify(original));

  const { data: qaSession, error: qaSessionError } = await admin
    .from('sessions')
    .insert({ user_id: user.id, title: qaTag('credits'), workspace_type: 'personal' })
    .select()
    .single();
  if (qaSessionError) {
    fail('Could not create QA session', qaSessionError.message);
    finish();
    process.exit(1);
  }
  cleanup.track('sessions', 'id', qaSession.id, 'QA session for credits test');

  // ── CASE A: concurrency at balance=1 ──────────────────────────────────────
  section('CASE A — two concurrent generateImage calls at balance=1 (1 credit each)');
  await setBalance(admin, user.id, 1);
  const genA = await insertPlaceholder(admin, user.id, qaSession.id, newRequestId(), 0);
  const genB = await insertPlaceholder(admin, user.id, qaSession.id, newRequestId(), 0);
  cleanup.track('generations', 'id', genA.id, 'QA generation (case A, call 1)');
  cleanup.track('generations', 'id', genB.id, 'QA generation (case A, call 2)');

  const [callA, callB] = await Promise.all([
    callGenerateImage(env, accessToken, { prompt: QA_PROMPT, request_id: genA.request_id, request_slot: 0, generation_id: genA.id }),
    callGenerateImage(env, accessToken, { prompt: QA_PROMPT, request_id: genB.request_id, request_slot: 0, generation_id: genB.id }),
  ]);

  const successesA = [callA, callB].filter((r) => r.status === 200);
  const insufficientA = [callA, callB].filter((r) => r.status === 402);
  info('Case A raw results', JSON.stringify({ callA: { status: callA.status }, callB: { status: callB.status } }));

  if (successesA.length === 1 && insufficientA.length === 1) {
    pass('Exactly one call succeeded (200) and the other got 402 Insufficient credits — no double-render.');
  } else {
    fail(
      `Expected exactly 1 success + 1 "insufficient credits", got ${successesA.length} success(es) and ${insufficientA.length} 402(s)`,
      `If both succeeded: this is the exact pre-Fix-2 credit-leak bug (the atomic deduct_credits ok flag ` +
      `is not being checked, or reserveCredits is no longer running before the render). ` +
      `Full responses: ${JSON.stringify([callA, callB], null, 2)}`,
    );
  }

  const balanceAfterA = await getCreditRow(admin, user.id);
  if (balanceAfterA.balance === 0) {
    pass('Final balance after Case A is exactly 0 (not -1, not still 1).');
  } else {
    fail(`Final balance after Case A is ${balanceAfterA.balance}, expected exactly 0.`);
  }
  // Whichever call succeeded produced a completed generation -> Fix 1's trigger made a draft post.
  for (const gen of [genA, genB]) {
    const { data: posts } = await admin.from('posts').select('id').eq('generation_id', gen.id);
    (posts || []).forEach((p) => cleanup.track('posts', 'id', p.id, `draft post for case A generation ${gen.id}`));
  }

  // ── CASE B: refund on post-reservation failure ────────────────────────────
  section('CASE B — refund when generation fails AFTER credit reservation');
  await setBalance(admin, user.id, 5);
  const genC = await insertPlaceholder(admin, user.id, qaSession.id, newRequestId(), 0);
  cleanup.track('generations', 'id', genC.id, 'QA generation (case B)');

  info(
    'Attempting a failure trigger AFTER reservation',
    'Using image_model="recraft" with a deliberately invalid recraft_style value, betting fal.ai\'s ' +
    'Recraft endpoint rejects it server-side (this happens after reserveCredits() in generateImage/index.ts). ' +
    'This is inherently a best-effort trigger, not a guaranteed one — see the verdict below for what to do if it ' +
    'unexpectedly succeeds.',
  );
  const callC = await callGenerateImage(env, accessToken, {
    prompt: QA_PROMPT,
    request_id: genC.request_id,
    request_slot: 0,
    generation_id: genC.id,
    image_model: 'recraft',
    recraft_style: 'QA-VERIFY-not-a-real-style-xyz-999',
  });
  info('Case B call result', JSON.stringify(callC));

  if (callC.status === 200) {
    skip(
      'The chosen failure trigger did NOT fail — fal.ai accepted the bogus recraft_style (or fell back silently)',
      'This is INCONCLUSIVE, not a pass or a fail — the refund path was never exercised. ' +
      'See RUNBOOK.md Part A / Case B manual fallback: temporarily set an invalid FAL_API_KEY secret, ' +
      're-run just this case, then restore the real key.',
    );
    const { data: posts } = await admin.from('posts').select('id').eq('generation_id', genC.id);
    (posts || []).forEach((p) => cleanup.track('posts', 'id', p.id, 'draft post for case B (unexpectedly succeeded)'));
  } else {
    const balanceAfterB = await getCreditRow(admin, user.id);
    if (balanceAfterB.balance === 5) {
      pass('Balance is back to 5 after the failure — the reservation was refunded.');
    } else {
      fail(`Balance after the failed call is ${balanceAfterB.balance}, expected it restored to 5 (credit leak: reserved but never refunded).`);
    }

    const { data: refundRows, error: refundError } = await admin
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user.id)
      .eq('transaction_type', 'refund')
      .order('created_at', { ascending: false })
      .limit(1);
    if (refundError) {
      fail('Could not query credit_transactions for a refund row', refundError.message);
    } else if (refundRows.length === 1 && refundRows[0].amount === 1) {
      pass('A matching refund row exists in credit_transactions (amount +1).', JSON.stringify(refundRows[0]));
    } else {
      fail(
        'No matching refund row found in credit_transactions (or amount was wrong)',
        `Latest refund rows: ${JSON.stringify(refundRows)}`,
      );
    }
  }

  // ── CASE C: idempotent replay ──────────────────────────────────────────────
  section('CASE C — calling generateImage twice with the SAME request_id/request_slot');
  await setBalance(admin, user.id, 10);
  const genD = await insertPlaceholder(admin, user.id, qaSession.id, newRequestId(), 0);
  cleanup.track('generations', 'id', genD.id, 'QA generation (case C)');

  const call1 = await callGenerateImage(env, accessToken, {
    prompt: QA_PROMPT, request_id: genD.request_id, request_slot: 0, generation_id: genD.id,
  });
  if (call1.status !== 200) {
    fail('First call in Case C did not succeed — cannot test replay behavior.', JSON.stringify(call1));
  } else {
    const balanceAfterCall1 = await getCreditRow(admin, user.id);
    info('After first call', `status: ${call1.status}, storage_path: ${call1.body?.storage_path || call1.body?.storagePath}, balance: ${balanceAfterCall1.balance}`);

    const call2 = await callGenerateImage(env, accessToken, {
      prompt: QA_PROMPT, request_id: genD.request_id, request_slot: 0, generation_id: genD.id,
    });
    const balanceAfterCall2 = await getCreditRow(admin, user.id);
    info('After second (duplicate) call', `status: ${call2.status}, replayed: ${call2.body?.replayed}, storage_path: ${call2.body?.storage_path || call2.body?.storagePath}, balance: ${balanceAfterCall2.balance}`);

    // Compare `url`/`publicUrl` (always the full public URL in both the
    // fresh-render and replayed-cache response shapes) rather than
    // `storage_path`/`storagePath` — that field is NOT shape-consistent
    // between the two paths by design: a fresh render returns the relative
    // storage filename (generateImage/index.ts's own `fileName`), while a
    // replay returns whatever's persisted in `generations.storage_path`,
    // which the app always stores as the full public URL. Not a bug; just
    // two different fields with different meanings that happen to share a
    // similar name — `url`/`publicUrl` is the field actually meant to be
    // stable across both paths, and is what's checked here.
    const samePath = (call1.body?.url || call1.body?.publicUrl) === (call2.body?.url || call2.body?.publicUrl);
    if (call2.status === 200 && call2.body?.replayed === true && samePath) {
      pass('Second call correctly replayed the cached result (replayed:true, same public URL).');
    } else {
      fail(
        'Second call did NOT behave as a replay',
        `Expected status 200 + replayed:true + identical public URL. Got status ${call2.status}, ` +
        `replayed=${call2.body?.replayed}, samePath=${samePath}.`,
      );
    }

    if (balanceAfterCall1.balance === 9 && balanceAfterCall2.balance === 9) {
      pass('Balance decreased by exactly 1 total across both calls (9 after call 1, still 9 after call 2).');
    } else {
      fail(
        `Balance progression was ${original.balance} -> ${balanceAfterCall1.balance} -> ${balanceAfterCall2.balance}, expected 10 -> 9 -> 9`,
        'If it went to 8 after the second call, the replay path re-billed — idempotency is broken.',
      );
    }

    const { data: posts } = await admin.from('posts').select('id').eq('generation_id', genD.id);
    (posts || []).forEach((p) => cleanup.track('posts', 'id', p.id, 'draft post for case C generation'));
  }

  // ── RESTORE ────────────────────────────────────────────────────────────────
  section('RESTORING ORIGINAL BALANCE');
  const { error: restoreError } = await admin
    .from('user_credits')
    .update({ balance: original.balance, lifetime_consumed: original.lifetime_consumed })
    .eq('user_id', user.id);
  if (restoreError) {
    fail('Could not restore original balance — fix this manually before trusting your credit balance again', restoreError.message);
  } else {
    pass(`Balance restored to original value: ${original.balance} (lifetime_consumed: ${original.lifetime_consumed})`);
  }

  await cleanup.run();
  finish();
}

main().catch((err) => {
  console.error('\nUNEXPECTED SCRIPT ERROR:', err);
  process.exitCode = 1;
});
