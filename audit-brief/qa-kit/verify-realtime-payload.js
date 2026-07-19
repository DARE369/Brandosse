// verify-realtime-payload.js
//
// WHAT THIS CHECKS: SessionStore.js's subscribeToSession() assumes
// realtime.broadcast_changes()'s payload puts the row under
// `payload.record` (falling back to `new_record`/`new` defensively, since
// this was never checked against a live project — see FIXLOG "REALTIME
// EXPOSURE VERDICT" / Week 2 Fix 1 and 07-structural-findings.md). This
// script proves which key the row actually lands under, and whether an
// INSERT and an UPDATE arrive as distinguishable events.
//
// Closes: FIXLOG Week 2 Fix 1 "Could not verify — the exact field names
// realtime.broadcast_changes() puts inside that payload."
'use strict';

const {
  loadEnv, adminClient, signIn, section, pass, fail, info, finish, sleep, qaTag, makeCleanupRegistry,
} = require('./lib/helpers');

async function main() {
  const env = loadEnv();
  const admin = adminClient(env);
  const cleanup = makeCleanupRegistry(admin);

  section('SETUP');
  const { client: userClient, user } = await signIn(env, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD, 'TEST_USER');
  info('Signed in as TEST_USER', `user_id: ${user.id}`);

  const sessionTitle = qaTag('realtime-payload');
  const { data: session, error: sessionError } = await admin
    .from('sessions')
    .insert({ user_id: user.id, title: sessionTitle, workspace_type: 'personal' })
    .select()
    .single();
  if (sessionError) {
    fail('Could not create a QA session row', sessionError.message);
    finish();
    process.exit(1);
  }
  cleanup.track('sessions', 'id', session.id, 'QA session for realtime payload test');
  info('Created QA session', `id: ${session.id}, title: ${sessionTitle}`);

  const received = [];
  const topic = `session-${session.id}`;

  section('SUBSCRIBE (as SessionStore.js does: private channel, broadcast event *)');
  const channel = userClient.channel(topic, { config: { private: true } });
  channel.on('broadcast', { event: '*' }, (message) => {
    received.push({ at: Date.now(), message });
  });

  const subscribeStatus = await new Promise((resolve) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        resolve({ status, err });
      }
    });
    setTimeout(() => resolve({ status: 'TIMEOUT_WAITING_LOCAL' }), 15000);
  });

  if (subscribeStatus.status !== 'SUBSCRIBED') {
    fail(
      'Could not subscribe to the session topic at all',
      `Status observed: ${subscribeStatus.status}${subscribeStatus.err ? ` (${subscribeStatus.err.message || subscribeStatus.err})` : ''}\n` +
      `This blocks every other check in this script — nothing to receive if we never subscribed.\n` +
      `Check: is Realtime enabled for this project? Is migration 20260711000000_realtime_session_broadcast.sql applied ` +
      `(RLS policy session_broadcast_subscribe_access on realtime.messages)?`,
    );
    await userClient.removeChannel(channel);
    await cleanup.run();
    finish();
    process.exit(1);
  }
  pass('Subscribed to own session topic', `topic: ${topic}`);

  section('TRIGGER AN INSERT (service-role, bypassing the app on purpose — testing the trigger+broadcast path itself)');
  const insertPrompt = qaTag('gen-insert');
  const { data: genRow, error: insertError } = await admin
    .from('generations')
    .insert({
      user_id: user.id,
      session_id: session.id,
      prompt: insertPrompt,
      media_type: 'image',
      status: 'processing',
    })
    .select()
    .single();
  if (insertError) {
    fail('Could not insert a QA generations row', insertError.message);
    await userClient.removeChannel(channel);
    await cleanup.run();
    finish();
    process.exit(1);
  }
  // Track for cleanup. Note: if status ever becomes 'completed' during this
  // script (it does, below), Fix 1's trigger will create exactly one draft
  // post + library item for it — track those too so cleanup is complete.
  cleanup.track('generations', 'id', genRow.id, 'QA generation row');
  info('Inserted QA generation row', `id: ${genRow.id}, status: processing`);

  await sleep(3000);
  const afterInsert = received.length;
  info(`Broadcast messages received so far: ${afterInsert}`);

  section('TRIGGER AN UPDATE (same row, status -> completed)');
  const { error: updateError } = await admin
    .from('generations')
    .update({ status: 'completed', storage_path: 'https://example.com/qa-verify-fake-image.jpg' })
    .eq('id', genRow.id);
  if (updateError) {
    fail('Could not update the QA generations row', updateError.message);
  }
  await sleep(3000);

  cleanup.track('posts', 'generation_id', genRow.id, 'draft post the trigger may have created for this QA generation');
  // content_library_items has no direct generation_id column — it hangs
  // off the post via post_id, cleaned up as CASCADE when the post above is
  // deleted (content_library_items_post_id_fkey ON DELETE CASCADE, see
  // 20260227090000_calendar_library_alignment.sql) — no separate tracking
  // needed here.

  section('RESULTS — raw broadcast messages received');
  if (received.length === 0) {
    fail(
      'Zero broadcast messages received for either the INSERT or the UPDATE',
      `Subscription reported SUBSCRIBED, but no messages arrived within ~6s of two writes.\n` +
      `Possible causes: the broadcast_generation_change trigger isn't installed/firing, or the ` +
      `RLS policy is silently dropping messages meant for you. Check Supabase function logs / ` +
      `run: select * from pg_trigger where tgname = 'broadcast_generation_change'; in the SQL editor.`,
    );
  } else {
    received.forEach((entry, i) => {
      console.log(`\n--- message #${i + 1} (received ${entry.at - received[0].at}ms after the first) ---`);
      console.log(JSON.stringify(entry.message, null, 2));
    });
  }

  section('VERDICT — payload shape');
  let recordKeyFound = null;
  let recordKeyUsed = null;
  for (const entry of received) {
    const payload = entry.message?.payload || {};
    for (const key of ['record', 'new_record', 'new']) {
      if (payload[key] && typeof payload[key] === 'object') {
        recordKeyFound = key;
        recordKeyUsed = payload[key];
        break;
      }
    }
    if (recordKeyFound) break;
  }

  if (recordKeyFound === 'record') {
    pass(
      'payload.record exists and carries the row fields — SessionStore.js\'s primary extraction path is correct',
      `Example fields present: id=${recordKeyUsed.id}, status=${recordKeyUsed.status}, prompt=${recordKeyUsed.prompt}`,
    );
  } else if (recordKeyFound) {
    fail(
      `The row is NOT under payload.record — it's under payload.${recordKeyFound} instead`,
      `SessionStore.js's subscribeToSession extraction (\`payload.record || payload.new_record || payload.new\`) ` +
      `still works today because ${recordKeyFound} is one of its fallbacks, but the PRIMARY documented key ` +
      `(record) is not what this project's Realtime server actually sends. ` +
      `Fix: reorder that extraction so \`payload.${recordKeyFound}\` is checked FIRST, or at minimum leave a ` +
      `comment recording that this project's real key is "${recordKeyFound}", not "record".`,
    );
  } else {
    fail(
      'None of payload.record / payload.new_record / payload.new held an object',
      `Print the raw messages above and inspect payload's actual keys by hand — the extraction code needs ` +
      `a new fallback key added. This is a one-line fix once you know the real key name.`,
    );
  }

  section('VERDICT — INSERT vs UPDATE distinguishability');
  const operations = received.map((entry) => {
    const payload = entry.message?.payload || {};
    return String(payload.operation || payload.type || entry.message?.event || '').toUpperCase();
  });
  info('Operations observed, in order received', operations.join(', ') || '(none)');
  const sawInsert = operations.some((op) => op.includes('INSERT'));
  const sawUpdate = operations.some((op) => op.includes('UPDATE'));
  if (sawInsert && sawUpdate) {
    pass('Both an INSERT-flavored and an UPDATE-flavored event arrived, and they are distinguishable by operation name.');
  } else if (received.length >= 2) {
    fail(
      'Two messages arrived but they are NOT distinguishable as INSERT vs UPDATE by name',
      `Operations seen: ${operations.join(', ')}. SessionStore.js's \`operation\` extraction ` +
      `(payload.operation || payload.type || message.event) is not producing the expected ` +
      `'INSERT'/'UPDATE' strings — check the raw payloads above for what field actually carries this.`,
    );
  } else {
    fail('Fewer than 2 messages arrived — cannot assess INSERT vs UPDATE distinguishability at all.');
  }

  await userClient.removeChannel(channel);
  await cleanup.run();
  finish();
}

main().catch((err) => {
  console.error('\nUNEXPECTED SCRIPT ERROR:', err);
  process.exitCode = 1;
});
