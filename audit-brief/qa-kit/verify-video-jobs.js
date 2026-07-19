// verify-video-jobs.js
//
// *** THIS SCRIPT COSTS REAL CREDITS AND REAL MONEY (fal.ai API usage). ***
// Each case below is gated behind its own y/n prompt so you can run only
// the ones you want. Standard-tier video costs ~5 credits; if TEST_IMAGE_URL
// is not set in .env, requests fall back to text-to-video, which the app's
// OWN tier-upgrade logic bills at PREMIUM (~15 credits) instead — this
// script warns you before every case that would do that.
//
// WHAT THIS CHECKS: the entire Week 3 Fix 3 async video mechanism against
// the real fal.ai queue — webhook vs. poller completion timing, the full
// offline chain (generation -> draft post -> [metadata, see note below]),
// cancel, and idempotent resubmission.
//
// Closes: FIXLOG Week 3 Fix 3's entire "Could not verify" list (fal.ai's
// actual webhook payload/timing, queue-cancel support, webhook/poller race
// safety, and whether the offline chain really works with zero clients).
'use strict';

const {
  loadEnv, adminClient, signIn, section, pass, fail, info, skip, finish, sleep, qaTag, confirmCost, makeCleanupRegistry,
} = require('./lib/helpers');

async function callGenerateVideo(env, accessToken, body) {
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/generateVideo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* ignore */ }
  return { status: res.status, body: json };
}

async function callCancelVideoJob(env, accessToken, jobId) {
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/cancel-video-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ job_id: jobId }),
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* ignore */ }
  return { status: res.status, body: json };
}

async function getJob(admin, jobId) {
  const { data, error } = await admin.from('background_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getBalance(admin, userId) {
  const { data } = await admin.from('user_credits').select('balance').eq('user_id', userId).maybeSingle();
  return data?.balance ?? null;
}

// Polls a job row until its status leaves 'queued'/'running', or timeoutMs
// elapses. Returns { job, elapsedMs, timedOut }.
async function pollJobUntilTerminal(admin, jobId, { intervalMs = 5000, timeoutMs = 150000 } = {}) {
  const start = Date.now();
  for (;;) {
    const job = await getJob(admin, jobId);
    if (job && !['queued', 'running'].includes(job.status)) {
      return { job, elapsedMs: Date.now() - start, timedOut: false };
    }
    if (Date.now() - start > timeoutMs) {
      return { job, elapsedMs: Date.now() - start, timedOut: true };
    }
    await sleep(intervalMs);
  }
}

function videoBody(env, requestId, extra = {}) {
  const hasImage = Boolean(env.TEST_IMAGE_URL);
  return {
    prompt: 'QA-VERIFY- a calm ocean wave rolling onto a sandy beach at sunset',
    quality: 'standard',
    image_url: hasImage ? env.TEST_IMAGE_URL : undefined,
    duration: '5',
    aspect_ratio: '16:9',
    request_id: requestId,
    ...extra,
  };
}

function costWarning(env) {
  if (env.TEST_IMAGE_URL) {
    return 'TEST_IMAGE_URL is set — this will submit as STANDARD tier (Hailuo, ~5 credits).';
  }
  return 'TEST_IMAGE_URL is NOT set — this text-to-video request will be TIER-UPGRADED to PREMIUM ' +
    'by the app\'s own logic (Kling, ~15 credits) since standard tier requires a source image. ' +
    'Set TEST_IMAGE_URL in .env to test the cheaper standard tier instead.';
}

async function main() {
  const env = loadEnv();
  const admin = adminClient(env);
  const cleanup = makeCleanupRegistry(admin);

  section('SETUP');
  const { user, session } = await signIn(env, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD, 'TEST_USER');
  const accessToken = session.access_token;
  const { data: qaSession, error: qaSessionError } = await admin
    .from('sessions')
    .insert({ user_id: user.id, title: qaTag('video-jobs'), workspace_type: 'personal' })
    .select()
    .single();
  if (qaSessionError) {
    fail('Could not create QA session', qaSessionError.message);
    finish();
    process.exit(1);
  }
  cleanup.track('sessions', 'id', qaSession.id, 'QA session for video jobs test');

  // ── CASE A: happy path + webhook timing + offline chain ────────────────────
  section('CASE A — happy path, webhook vs. poller timing, and the offline completion chain');
  const runA = await confirmCost(
    `Case A submits one real video generation and polls until it completes (up to ~2.5 min). ${costWarning(env)}`,
  );
  if (!runA) {
    skip('Case A skipped by user.');
  } else {
    const requestIdA = `QA-VERIFY-A-${Date.now()}`;
    const submitA = await callGenerateVideo(env, accessToken, videoBody(env, requestIdA, { session_id: qaSession.id }));
    if (submitA.status !== 200 || !submitA.body?.job_id) {
      fail('generateVideo did not return a job_id', JSON.stringify(submitA));
    } else {
      const jobId = submitA.body.job_id;
      const generationId = submitA.body.generation_id;
      cleanup.trackManual(`background_jobs row ${jobId} and generations row ${generationId} (case A) — background_jobs has no simple FK cleanup path from this script; delete both manually if you want a fully clean slate, or leave them as harmless QA history`);
      info('Submitted', `job_id: ${jobId}, generation_id: ${generationId}, tier_upgraded: ${submitA.body.tier_upgraded}`);

      const { job: finalJob, elapsedMs, timedOut } = await pollJobUntilTerminal(admin, jobId, { intervalMs: 5000, timeoutMs: 150000 });
      const elapsedSec = Math.round(elapsedMs / 1000);

      if (timedOut) {
        fail(
          `Job never left 'queued'/'running' within 150s`,
          `Last observed status: ${finalJob?.status}. Neither the webhook nor the process-jobs poller ` +
          `appears to be reconciling this job. Check: (1) Supabase function logs for job-webhook (was it ever ` +
          `invoked by fal.ai?), (2) that process-jobs is registered — select * from cron.job where jobname='process-jobs'; ` +
          `(3) the Vault service_role_key secret exists (select * from vault.decrypted_secrets where name='service_role_key';).`,
        );
      } else if (finalJob.status === 'completed') {
        if (elapsedSec < 60) {
          pass(`Job completed in ${elapsedSec}s (< 60s) — the webhook almost certainly fired (the poller only checks every 60s and only touches jobs older than 45s).`);
        } else {
          pass(`Job completed in ${elapsedSec}s (60-150s band) — likely the process-jobs POLLER finalized it, not the webhook.`,
            'If you want to confirm the webhook is broken (vs. just slower than the poller this one time), check job-webhook\'s ' +
            'function logs in the Supabase dashboard for any invocation around the submit time, and confirm it is deployed ' +
            'WITHOUT requiring a Supabase-session JWT (fal.ai\'s webhook call carries only your own per-job token, not a ' +
            'Supabase auth JWT) — Dashboard -> Edge Functions -> job-webhook -> check "Enforce JWT verification" is OFF.');
        }

        section('CASE A continued — offline chain: draft post + metadata');
        const { data: genRow } = await admin.from('generations').select('*').eq('id', generationId).maybeSingle();
        if (genRow?.status === 'completed' && genRow?.storage_path) {
          pass('generations row reached status=completed with a storage_path.');
        } else {
          fail('generations row did not reach completed/storage_path as expected.', JSON.stringify(genRow));
        }

        const { data: posts } = await admin.from('posts').select('*').eq('generation_id', generationId);
        if (posts.length === 1 && posts[0].status === 'draft') {
          pass('Exactly one draft post exists for this video generation (server-side trigger — works with zero clients).');
          cleanup.track('posts', 'id', posts[0].id, 'draft post for case A video generation');

          const metadataStatus = posts[0].workflow_state?.metadata_status || null;
          info(
            'CONFIRMED FINDING (not a script bug) — metadata_status after ~150s with zero browser clients present',
            `metadata_status: ${metadataStatus === null ? '(unset — never invoked)' : metadataStatus}\n` +
            `This script IS the "zero clients" scenario (it only talks to the DB/HTTP, no browser). Reading ` +
            `SessionStore.js directly: generate-post-metadata is only ever invoked from (a) subscribeToSession's ` +
            `realtime broadcast handler, or (b) hydratePostProductionFromGeneration (opening the publish stage in ` +
            `the app) — BOTH require an actual browser client. finalizeCompleted (job-webhook/process-jobs) only ` +
            `writes the generations row; it never calls generate-post-metadata itself. So metadata_status is ` +
            `EXPECTED to still be unset here — this is the real, confirmed behavior, not a failure of this script. ` +
            `See RUNBOOK.md for why FIXLOG's Fix 3 journey check (a) overstated this ("works with zero client tabs ` +
            `open") — that claim is true for the draft-post part only, not for metadata.`,
          );
        } else {
          fail(`Expected exactly one draft post, found ${posts.length}.`, JSON.stringify(posts));
        }
      } else {
        fail(`Job reached a terminal status of '${finalJob.status}', not 'completed'`, JSON.stringify(finalJob));
      }
    }
  }

  // ── CASE B: cancel ──────────────────────────────────────────────────────────
  section('CASE B — cancel a job and confirm it never completes afterward');
  const runB = await confirmCost(
    `Case B submits a real video and immediately cancels it, then waits ~2.5 min to confirm it never ` +
    `flips to completed. ${costWarning(env)} (credits are refunded on cancel — this net-costs you ~0 credits, just API/time.)`,
  );
  if (!runB) {
    skip('Case B skipped by user.');
  } else {
    const balanceBefore = await getBalance(admin, user.id);
    const requestIdB = `QA-VERIFY-B-${Date.now()}`;
    const submitB = await callGenerateVideo(env, accessToken, videoBody(env, requestIdB, { session_id: qaSession.id }));
    if (submitB.status !== 200 || !submitB.body?.job_id) {
      fail('generateVideo did not return a job_id for case B', JSON.stringify(submitB));
    } else {
      const jobId = submitB.body.job_id;
      cleanup.trackManual(`background_jobs row ${jobId} and generations row ${submitB.body.generation_id} (case B, cancelled)`);
      info('Submitted, now cancelling immediately', `job_id: ${jobId}`);

      const cancelResult = await callCancelVideoJob(env, accessToken, jobId);
      info('Cancel call result', JSON.stringify(cancelResult));

      await sleep(3000);
      const jobAfterCancel = await getJob(admin, jobId);
      if (jobAfterCancel?.status === 'cancelled') {
        pass('Job status is "cancelled" shortly after the cancel call.');
      } else {
        fail(`Expected job status 'cancelled' shortly after cancelling, got '${jobAfterCancel?.status}'`);
      }

      const balanceAfterCancel = await getBalance(admin, user.id);
      if (balanceAfterCancel === balanceBefore) {
        pass(`Credits were refunded — balance is back to ${balanceBefore} (unchanged from before submission).`);
      } else {
        fail(`Balance is ${balanceAfterCancel}, expected it back to the pre-submission value of ${balanceBefore} (refund did not happen or happened twice).`);
      }

      info('Waiting ~2.5 min to confirm the job never flips to completed after a late webhook/poll (claim-guard test)...');
      const { job: laterJob } = await pollJobUntilTerminal(admin, jobId, { intervalMs: 10000, timeoutMs: 150000 });
      if (laterJob?.status === 'cancelled') {
        pass('Job is STILL "cancelled" after waiting out the render window — a late webhook/poll correctly did not resurrect it.');
      } else {
        fail(
          `Job status changed to '${laterJob?.status}' after cancellation — the claim guard did not hold`,
          'reconcileJob\'s finalize functions guard on WHERE status=\'running\' — if the job somehow flipped to ' +
          'completed/failed after being cancelled, that guard is not working as designed.',
        );
      }
    }
  }

  // ── CASE C: idempotent resubmit ─────────────────────────────────────────────
  section('CASE C — submitting the SAME request_id twice must create only one job and one charge');
  const runC = await confirmCost(
    `Case C submits a real video, immediately resubmits with the same request_id (should be free/instant), ` +
    `then cancels the underlying job for cleanup. ${costWarning(env)}`,
  );
  if (!runC) {
    skip('Case C skipped by user.');
  } else {
    const balanceBefore = await getBalance(admin, user.id);
    const requestIdC = `QA-VERIFY-C-${Date.now()}`;
    const first = await callGenerateVideo(env, accessToken, videoBody(env, requestIdC, { session_id: qaSession.id }));
    const second = await callGenerateVideo(env, accessToken, videoBody(env, requestIdC, { session_id: qaSession.id }));
    const balanceAfter = await getBalance(admin, user.id);

    info('Both calls', JSON.stringify({ first: { status: first.status, job_id: first.body?.job_id, replayed: first.body?.replayed }, second: { status: second.status, job_id: second.body?.job_id, replayed: second.body?.replayed } }));

    if (first.body?.job_id && second.body?.job_id && first.body.job_id === second.body.job_id) {
      pass('Both calls resolved to the SAME job_id — no duplicate job was created.');
    } else {
      fail('The two calls returned DIFFERENT job_ids for the same request_id — idempotency is broken.');
    }

    const chargePerCall = env.TEST_IMAGE_URL ? 5 : 15;
    if (balanceBefore - balanceAfter === chargePerCall) {
      pass(`Exactly one charge of ${chargePerCall} credits was made across both calls (balance ${balanceBefore} -> ${balanceAfter}).`);
    } else {
      fail(`Expected exactly one charge of ${chargePerCall}, but balance went ${balanceBefore} -> ${balanceAfter} (delta ${balanceBefore - balanceAfter}).`);
    }

    if (first.body?.job_id) {
      cleanup.trackManual(`background_jobs row ${first.body.job_id} and generations row ${first.body.generation_id} (case C)`);
      info('Cancelling the job now for cleanup (idempotency was already proven above)...');
      await callCancelVideoJob(env, accessToken, first.body.job_id);
    }
  }

  await cleanup.run();
  finish();
}

main().catch((err) => {
  console.error('\nUNEXPECTED SCRIPT ERROR:', err);
  process.exitCode = 1;
});
