// verify-metadata-reconcile.js
//
// WHAT THIS CHECKS (split, because reconciliation itself is CLIENT-side
// read-time logic in hydratePostProductionFromGeneration — a headless
// script cannot exercise that half at all):
//   (a) SCRIPT-VERIFIABLE: the server (generate-post-metadata) does not
//       refuse to (re)run for a post whose workflow_state is already stuck
//       'in_progress' (with or without a metadata_started_at) — it has no
//       "already in progress, skip" guard, so it always proceeds and can
//       recover a stuck row once actually invoked.
//   (b) MANUAL/BROWSER (see RUNBOOK.md): does the UI actually show
//       failed/regenerable for a stuck row (client-side 2-minute staleness
//       check in hydratePostProductionFromGeneration), and does clicking
//       Regenerate work? This script cannot open a browser — RUNBOOK.md's
//       corresponding manual step covers it.
//
// Closes: FIXLOG Week 2 Fix 3 "Could not verify: live timing of the
// 2-minute reconciliation window against a real network-drop scenario."
'use strict';

const {
  loadEnv, adminClient, signIn, section, pass, fail, info, finish, qaTag, makeCleanupRegistry,
} = require('./lib/helpers');

async function callGeneratePostMetadata(env, accessToken, body) {
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/generate-post-metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* ignore */ }
  return { status: res.status, body: json };
}

async function createStuckPost(admin, userId, workflowState, label) {
  const { data, error } = await admin
    .from('posts')
    .insert({
      user_id: userId,
      caption: qaTag(label),
      status: 'draft',
      workflow_state: workflowState,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function main() {
  const env = loadEnv();
  const admin = adminClient(env);
  const cleanup = makeCleanupRegistry(admin);

  section('SETUP');
  const { user, session } = await signIn(env, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD, 'TEST_USER');
  const accessToken = session.access_token;

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const postWithTimestamp = await createStuckPost(
    admin, user.id,
    { metadata_status: 'in_progress', metadata_started_at: tenMinAgo, metadata_updated_at: tenMinAgo },
    'reconcile-with-timestamp',
  );
  cleanup.track('posts', 'id', postWithTimestamp.id, 'QA post: stuck in_progress WITH a 10-minute-old timestamp');
  info('Created post A', `id: ${postWithTimestamp.id}, workflow_state: in_progress, metadata_started_at 10 min ago`);

  const postWithoutTimestamp = await createStuckPost(
    admin, user.id,
    { metadata_status: 'in_progress' }, // deliberately no metadata_started_at — the pre-Week-2-Fix-3-shaped row
    'reconcile-no-timestamp',
  );
  cleanup.track('posts', 'id', postWithoutTimestamp.id, 'QA post: stuck in_progress with NO timestamp at all (pre-fix shape)');
  info('Created post B', `id: ${postWithoutTimestamp.id}, workflow_state: in_progress, no metadata_started_at`);

  section('SCRIPT-VERIFIABLE HALF — does generate-post-metadata refuse a stuck row, or proceed and recover it?');

  for (const [label, post] of [['Post A (with stale timestamp)', postWithTimestamp], ['Post B (no timestamp)', postWithoutTimestamp]]) {
    const result = await callGeneratePostMetadata(env, accessToken, {
      post_id: post.id,
      fields: ['title', 'caption', 'hashtags'],
    });

    if (result.status !== 200) {
      fail(
        `${label}: generate-post-metadata returned ${result.status} instead of succeeding`,
        `Body: ${JSON.stringify(result.body)}\n` +
        `If this is because the function actively refuses an already-'in_progress' row, that would be new, ` +
        `unexpected guard logic not documented in FIXLOG — re-read generate-post-metadata/index.ts to confirm.`,
      );
      continue;
    }

    const { data: refreshed, error: refreshError } = await admin.from('posts').select('workflow_state, title, caption, hashtags').eq('id', post.id).single();
    if (refreshError) {
      fail(`${label}: could not re-read the post after the call`, refreshError.message);
      continue;
    }

    if (refreshed.workflow_state?.metadata_status === 'completed') {
      pass(
        `${label}: the server proceeded despite the stuck 'in_progress' state and completed normally`,
        `title: "${refreshed.title}", hashtags: ${JSON.stringify(refreshed.hashtags)}`,
      );
    } else {
      fail(
        `${label}: expected workflow_state.metadata_status='completed' after the call, got '${refreshed.workflow_state?.metadata_status}'`,
        JSON.stringify(refreshed.workflow_state),
      );
    }
  }

  section('MANUAL / BROWSER HALF — see RUNBOOK.md "Check 8" for the exact steps');
  info(
    'This script cannot verify the client-side reconciliation UI at all',
    'hydratePostProductionFromGeneration (SessionStore.js) is what actually reconciles a stale ' +
    "'in_progress' row to 'failed' for DISPLAY purposes, and it only runs when a browser opens that " +
    "post's publish stage — there is no server-side or headless equivalent to call here. " +
    'RUNBOOK.md has the manual browser steps: create/find a post in this state, open its publish stage, ' +
    'confirm the UI shows "failed"/regenerable (not stuck), then click Regenerate and confirm it works.',
  );

  await cleanup.run();
  finish();
}

main().catch((err) => {
  console.error('\nUNEXPECTED SCRIPT ERROR:', err);
  process.exitCode = 1;
});
