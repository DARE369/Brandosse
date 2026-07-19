// verify-scheduled-publish.js
//
// WHAT THIS CHECKS: the end-to-end scheduled-publish pipeline
// (process_scheduled_posts -> dispatch_scheduled_post -> publish-post ->
// runMockPublish) that Week 1 Fix 1 fixed and Week 3 Fix 3 deliberately did
// NOT duplicate into the new background_jobs mechanism (see
// audit-brief/07-structural-findings.md 0.3). This is the highest-value
// check for that decision: if this pipeline is actually broken today, Fix
// 3's "we don't need to build a second one" reasoning was wrong.
//
// Closes: FIXLOG Week 1 Fix 1 "Could not verify: whether
// vault.create_secret('service_role_key', ...) has actually been run in
// the live Supabase project ... if it hasn't, dispatch_scheduled_post()
// logs a warning and no-ops."
'use strict';

const {
  loadEnv, adminClient, signIn, section, pass, fail, info, finish, sleep, qaTag, makeCleanupRegistry,
} = require('./lib/helpers');

const POLL_INTERVAL_MS = 10000;
const MAX_WAIT_MS = 4 * 60 * 1000;

async function main() {
  const env = loadEnv();
  const admin = adminClient(env);
  const cleanup = makeCleanupRegistry(admin);

  section('SETUP');
  const { user } = await signIn(env, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD, 'TEST_USER');

  let { data: mockAccount } = await admin
    .from('connected_accounts')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_mock', true)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  let createdMockAccount = false;
  if (!mockAccount) {
    info('No existing mock connected account found for TEST_USER — creating a temporary QA one.');
    const { data: created, error: createError } = await admin
      .from('connected_accounts')
      .insert({
        user_id: user.id,
        platform: 'instagram',
        account_name: qaTag('mock-account'),
        username: qaTag('mock-account'),
        connection_status: 'active',
        is_mock: true,
      })
      .select()
      .single();
    if (createError) {
      fail('Could not create a QA mock connected account', createError.message);
      finish();
      process.exit(1);
    }
    mockAccount = created;
    createdMockAccount = true;
    cleanup.track('connected_accounts', 'id', mockAccount.id, 'QA mock connected account');
  } else {
    info('Using existing mock connected account', `id: ${mockAccount.id}, platform: ${mockAccount.platform}`);
  }

  const scheduledAt = new Date(Date.now() + 90 * 1000).toISOString();
  const { data: post, error: postError } = await admin
    .from('posts')
    .insert({
      user_id: user.id,
      account_id: mockAccount.id,
      platform: mockAccount.platform,
      caption: qaTag('scheduled-publish'),
      status: 'scheduled',
      scheduled_at: scheduledAt,
    })
    .select()
    .single();
  if (postError) {
    fail('Could not create QA scheduled post', postError.message);
    finish();
    process.exit(1);
  }
  cleanup.track('posts', 'id', post.id, 'QA scheduled post');
  info('Created QA scheduled post', `id: ${post.id}, scheduled_at: ${scheduledAt} (90s from now)`);

  section(`POLLING for up to ${MAX_WAIT_MS / 60000} minutes — expecting scheduled -> publishing -> published`);
  const seenStatuses = [];
  let finalPost = post;
  const start = Date.now();
  for (;;) {
    const { data: current, error: readError } = await admin.from('posts').select('*').eq('id', post.id).single();
    if (readError) { fail('Lost the ability to read the QA post mid-poll', readError.message); break; }
    finalPost = current;
    if (seenStatuses[seenStatuses.length - 1] !== current.status) {
      seenStatuses.push(current.status);
      info(`Status changed to: ${current.status}`, `(t+${Math.round((Date.now() - start) / 1000)}s)`);
    }
    if (current.status === 'published' || current.status === 'failed') break;
    if (Date.now() - start > MAX_WAIT_MS) break;
    await sleep(POLL_INTERVAL_MS);
  }

  section('VERDICT');
  info('Status transitions observed, in order', seenStatuses.join(' -> ') || '(none — never re-read)');

  if (finalPost.status === 'published') {
    const sawPublishing = seenStatuses.includes('publishing');
    if (sawPublishing) {
      pass('Post walked scheduled -> publishing -> published as expected.');
    } else {
      pass(
        'Post reached published, but this poll (every 10s) never happened to observe the "publishing" ' +
        'intermediate status — likely just missed the narrow window, not a real problem.',
      );
    }
    if (finalPost.published_at) {
      pass('published_at is set.', finalPost.published_at);
    } else {
      fail('Post is published but published_at is NULL — runMockPublish should always set this.');
    }

    const { data: logRows, error: logError } = await admin
      .from('mock_publish_logs')
      .select('*')
      .eq('post_id', post.id)
      .order('published_at', { ascending: false })
      .limit(1);
    if (logError) {
      fail('Could not query mock_publish_logs', logError.message);
    } else if (logRows.length === 1 && logRows[0].status === 'success') {
      pass('A matching mock_publish_logs row exists with status=success.', JSON.stringify(logRows[0]));
    } else {
      fail('No matching successful mock_publish_logs row found for this post.', JSON.stringify(logRows));
    }
  } else if (finalPost.status === 'failed') {
    fail(
      'Post reached status=failed instead of published',
      `error_message: ${finalPost.error_message || '(none)'}. This means the pipeline IS running (the cron fired, ` +
      `dispatch_scheduled_post called publish-post), but runMockPublish's simulated outcome was a failure this time ` +
      `(pickFailureReason can simulate failures even for healthy mock accounts at a low rate) — this is a legitimate ` +
      `mock-publish OUTCOME, not necessarily a broken pipeline. Re-run this script once; if it fails every time, ` +
      `that IS a real problem worth investigating in connectionHelpers.ts's pickFailureReason.`,
    );
  } else {
    fail(
      `Post never left status='${finalPost.status}' after ${MAX_WAIT_MS / 60000} minutes`,
      'Ranked likely causes:\n' +
      '  1. Vault secret missing — dispatch_scheduled_post() logs a WARNING and no-ops if ' +
      "vault.decrypted_secrets has no 'service_role_key' row. Check Supabase function logs for a warning " +
      "starting with \"dispatch_scheduled_post: service_role_key not found in Vault\" (this shows in Postgres " +
      "logs, not edge function logs, since dispatch_scheduled_post is a plpgsql function - check Database -> " +
      "Logs -> Postgres Logs in the dashboard).\n" +
      "  2. Cron job not registered/not running — see the automated check below.",
    );

    section('Attempting to inspect cron.job and vault.decrypted_secrets directly (may not be exposed to the API)');
    try {
      const { data: cronJobs, error: cronError } = await admin.schema('cron').from('job').select('jobname, schedule, active');
      if (cronError) throw cronError;
      info('cron.job contents', JSON.stringify(cronJobs));
      const relevant = cronJobs.filter((j) => ['process-scheduled-posts', 'process-jobs'].includes(j.jobname));
      if (relevant.length === 2 && relevant.every((j) => j.active)) {
        pass('Both process-scheduled-posts and process-jobs are registered and active in cron.job.');
      } else {
        fail(
          'process-scheduled-posts and/or process-jobs is missing or inactive in cron.job',
          `Found: ${JSON.stringify(relevant)}. Re-apply 20260710120000_vault_based_cron_secrets.sql and/or ` +
          '20260712120000_week3_process_jobs_cron.sql.',
        );
      }
    } catch (schemaErr) {
      info(
        'cron schema is not exposed to the REST API from this script (expected on most projects) — run this manually instead',
        "SQL Editor: select jobname, schedule, active from cron.job where jobname in ('process-scheduled-posts','process-jobs');",
      );
    }

    try {
      const { data: secrets, error: secretError } = await admin.schema('vault').from('decrypted_secrets').select('name').eq('name', 'service_role_key');
      if (secretError) throw secretError;
      if (secrets.length === 1) {
        pass("vault.decrypted_secrets has a 'service_role_key' row — the Vault secret IS set.");
      } else {
        fail(
          "No 'service_role_key' row in vault.decrypted_secrets — this is the #1 suspect",
          "Run once in the SQL Editor: select vault.create_secret('<your-real-service-role-key>', 'service_role_key', 'Used by dispatch_scheduled_post() and cron jobs.');",
        );
      }
    } catch (schemaErr) {
      info(
        'vault schema is not exposed to the REST API from this script (expected on most projects) — run this manually instead',
        "SQL Editor: select name from vault.decrypted_secrets where name = 'service_role_key';",
      );
    }
  }

  if (createdMockAccount) {
    info('The mock connected account created for this test will be deleted during cleanup below.');
  } else {
    info('The mock connected account used for this test was pre-existing and will NOT be deleted.');
  }

  await cleanup.run();
  finish();
}

main().catch((err) => {
  console.error('\nUNEXPECTED SCRIPT ERROR:', err);
  process.exitCode = 1;
});
