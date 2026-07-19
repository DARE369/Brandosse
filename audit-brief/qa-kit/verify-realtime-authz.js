// verify-realtime-authz.js
//
// WHAT THIS CHECKS: the RLS policies on realtime.messages that are supposed
// to stop a user from subscribing to another user's/session's private
// broadcast topic — session_broadcast_subscribe_access (Week 2 Fix 1) and
// background_jobs_broadcast_subscribe_access (Week 3 Fix 3). This is the
// single most important security property from Weeks 2-3: a client cannot
// subscribe to someone else's topic no matter what code runs in the
// browser, because the Realtime server itself enforces it.
//
// Closes: FIXLOG Week 2 Fix 1 "second user / org non-member attempting to
// subscribe to someone else's session's topic ... Could not execute this
// against a live project."
'use strict';

const {
  loadEnv, adminClient, signIn, section, pass, fail, info, finish, qaTag, makeCleanupRegistry,
} = require('./lib/helpers');

// Attempts to subscribe to `topic` as `client`. Resolves with the exact
// terminal status string Supabase Realtime reports (SUBSCRIBED,
// CHANNEL_ERROR, TIMED_OUT, CLOSED), or 'LOCAL_TIMEOUT' if nothing terminal
// arrived within the wait window.
function attemptSubscribe(client, topic, waitMs = 12000) {
  return new Promise((resolve) => {
    const channel = client.channel(topic, { config: { private: true } });
    let settled = false;
    const settle = (status) => {
      if (settled) return;
      settled = true;
      resolve({ status, channel });
    };
    channel.subscribe((status) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        settle(status);
      }
    });
    setTimeout(() => settle('LOCAL_TIMEOUT'), waitMs);
  });
}

async function main() {
  const env = loadEnv();
  if (!env.TEST_USER_2_EMAIL || !env.TEST_USER_2_PASSWORD) {
    fail(
      'TEST_USER_2_EMAIL / TEST_USER_2_PASSWORD not set in .env',
      'This script specifically tests cross-user rejection and cannot run without a second real account. ' +
      'See RUNBOOK.md Part A for how to create it (any free account works — it never needs credits).',
    );
    finish();
    process.exit(1);
  }

  const admin = adminClient(env);
  const cleanup = makeCleanupRegistry(admin);

  section('SETUP');
  const { client: user1Client, user: user1 } = await signIn(env, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD, 'TEST_USER');
  const { client: user2Client, user: user2 } = await signIn(env, env.TEST_USER_2_EMAIL, env.TEST_USER_2_PASSWORD, 'TEST_USER_2');
  info('Signed in as both accounts', `TEST_USER: ${user1.id}\n   TEST_USER_2: ${user2.id}`);

  const { data: session, error: sessionError } = await admin
    .from('sessions')
    .insert({ user_id: user1.id, title: qaTag('realtime-authz'), workspace_type: 'personal' })
    .select()
    .single();
  if (sessionError) {
    fail('Could not create a QA session row for TEST_USER', sessionError.message);
    finish();
    process.exit(1);
  }
  cleanup.track('sessions', 'id', session.id, 'QA session for realtime authz test');
  info('Created QA session owned by TEST_USER', `id: ${session.id}`);

  const sessionTopic = `session-${session.id}`;
  const jobsTopicOwn = `background-jobs-${user1.id}`;

  section('CHECK 1 — control: TEST_USER subscribing to their OWN session topic must succeed');
  const controlSession = await attemptSubscribe(user1Client, sessionTopic);
  if (controlSession.status === 'SUBSCRIBED') {
    pass('TEST_USER subscribed to their own session topic', `topic: ${sessionTopic}`);
  } else {
    fail(
      'TEST_USER could NOT subscribe to their own session topic',
      `Status: ${controlSession.status}. This is the CONTROL case — if this fails, the authorization ` +
      `check below is meaningless (we can't tell "correctly rejected" from "realtime is just broken"). ` +
      `Fix this first before trusting any other result in this script.`,
    );
  }
  await user1Client.removeChannel(controlSession.channel);

  section("CHECK 2 — attack: TEST_USER_2 subscribing to TEST_USER's session topic must FAIL");
  const attackSession = await attemptSubscribe(user2Client, sessionTopic);
  if (attackSession.status === 'SUBSCRIBED') {
    fail(
      "TEST_USER_2 SUCCESSFULLY subscribed to TEST_USER's session topic — this is a real cross-user data exposure",
      `Status: SUBSCRIBED (expected CHANNEL_ERROR/TIMED_OUT/CLOSED). Check that migration ` +
      `20260711000000_realtime_session_broadcast.sql actually applied and that the RLS policy ` +
      `session_broadcast_subscribe_access exists on realtime.messages (SQL editor: ` +
      `select policyname from pg_policies where tablename='messages' and schemaname='realtime';).`,
    );
  } else {
    pass(
      "TEST_USER_2 was correctly rejected from TEST_USER's session topic",
      `Status observed: ${attackSession.status}`,
    );
  }
  await user2Client.removeChannel(attackSession.channel);

  section("CHECK 3 — control: TEST_USER subscribing to their OWN background-jobs topic must succeed");
  const controlJobs = await attemptSubscribe(user1Client, jobsTopicOwn);
  if (controlJobs.status === 'SUBSCRIBED') {
    pass('TEST_USER subscribed to their own background-jobs topic', `topic: ${jobsTopicOwn}`);
  } else {
    fail(
      'TEST_USER could NOT subscribe to their own background-jobs topic',
      `Status: ${controlJobs.status}. Control case failed — check migration ` +
      `20260712110000_week3_background_jobs.sql applied (policy background_jobs_broadcast_subscribe_access ` +
      `on realtime.messages).`,
    );
  }
  await user1Client.removeChannel(controlJobs.channel);

  section("CHECK 4 — attack: TEST_USER_2 subscribing to TEST_USER's background-jobs topic must FAIL");
  const attackJobs = await attemptSubscribe(user2Client, jobsTopicOwn);
  if (attackJobs.status === 'SUBSCRIBED') {
    fail(
      "TEST_USER_2 SUCCESSFULLY subscribed to TEST_USER's background-jobs topic — real cross-user exposure",
      `Status: SUBSCRIBED (expected rejection). Same check as above but for ` +
      `background_jobs_broadcast_subscribe_access.`,
    );
  } else {
    pass(
      "TEST_USER_2 was correctly rejected from TEST_USER's background-jobs topic",
      `Status observed: ${attackJobs.status}`,
    );
  }
  await user2Client.removeChannel(attackJobs.channel);

  await cleanup.run();
  finish();
}

main().catch((err) => {
  console.error('\nUNEXPECTED SCRIPT ERROR:', err);
  process.exitCode = 1;
});
