// verify-trigger-ownership.js
//
// WHAT THIS CHECKS: Week 3 Fix 1's central claim — the DB triggers
// (ensure_draft_post_for_generation, create_library_item_from_post) are the
// SOLE, race-safe owner of "a completed generation gets exactly one draft
// post and exactly one library item," even for a completion no client ever
// witnessed (simulating the video-job-finalizer / admin-backfill case), and
// even under concurrency (the ON CONFLICT DO NOTHING hardening from
// migration 20260712090000_week3_trigger_ownership_hardening.sql).
//
// Closes: FIXLOG Week 3 Fix 1 "Could not verify: live-database confirmation
// that the ON CONFLICT target expression exactly matches the partial
// index's stored expression ... never run against a live Postgres instance."
'use strict';

const {
  loadEnv, adminClient, signIn, section, pass, fail, info, finish, sleep, qaTag, makeCleanupRegistry,
} = require('./lib/helpers');

async function countRows(admin, table, filters) {
  let query = admin.from(table).select('*', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(filters)) query = query.eq(col, val);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function assertExactlyOneDraftAndLibraryItem(admin, generationId, label) {
  const { data: posts, error: postsError } = await admin
    .from('posts')
    .select('id, status')
    .eq('generation_id', generationId);
  if (postsError) throw postsError;

  const draftPosts = posts.filter((p) => p.status === 'draft');
  if (posts.length === 1 && draftPosts.length === 1) {
    pass(`${label}: exactly one draft post exists`, `post id: ${posts[0].id}`);
  } else {
    fail(
      `${label}: expected exactly 1 draft post, found ${posts.length} post row(s) (${draftPosts.length} of them 'draft')`,
      `Post rows: ${JSON.stringify(posts)}`,
    );
    return { ok: false, postId: posts[0]?.id || null };
  }

  const postId = posts[0].id;
  const libCount = await countRows(admin, 'content_library_items', { post_id: postId });
  if (libCount === 1) {
    pass(`${label}: exactly one content_library_items row exists for that post`);
  } else {
    fail(`${label}: expected exactly 1 library item, found ${libCount}`);
  }

  return { ok: posts.length === 1 && draftPosts.length === 1 && libCount === 1, postId };
}

async function main() {
  const env = loadEnv();
  const admin = adminClient(env);
  const cleanup = makeCleanupRegistry(admin);

  section('SETUP');
  const { user } = await signIn(env, env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD, 'TEST_USER');
  const { data: session, error: sessionError } = await admin
    .from('sessions')
    .insert({ user_id: user.id, title: qaTag('trigger-ownership'), workspace_type: 'personal' })
    .select()
    .single();
  if (sessionError) {
    fail('Could not create QA session', sessionError.message);
    finish();
    process.exit(1);
  }
  cleanup.track('sessions', 'id', session.id, 'QA session for trigger ownership test');
  info('Created QA session', `id: ${session.id}`);

  section('CHECK 1 — a completed generation no client ever witnessed gets exactly one draft + one library item');
  const { data: gen1, error: gen1Error } = await admin
    .from('generations')
    .insert({
      user_id: user.id,
      session_id: session.id,
      prompt: qaTag('offline-completion'),
      media_type: 'image',
      status: 'completed', // born completed on INSERT — simulates video path / no client present
      storage_path: 'https://example.com/qa-verify-offline.jpg',
    })
    .select()
    .single();
  if (gen1Error) {
    fail('Could not insert QA generation row (born completed)', gen1Error.message);
    finish();
    process.exit(1);
  }
  cleanup.track('generations', 'id', gen1.id, 'QA generation (born completed)');
  await sleep(1500); // triggers fire synchronously in-transaction, but leave slack for read-after-write

  const result1 = await assertExactlyOneDraftAndLibraryItem(admin, gen1.id, 'Check 1');
  if (result1.postId) cleanup.track('posts', 'id', result1.postId, 'draft post created by trigger for gen1');

  section('CHECK 2 — race A: two SEPARATE completed generations inserted in parallel for the same session');
  const promptA = qaTag('race-a-1');
  const promptB = qaTag('race-a-2');
  let raceAError = null;
  const [raceA1, raceA2] = await Promise.all([
    admin.from('generations').insert({
      user_id: user.id, session_id: session.id, prompt: promptA, media_type: 'image',
      status: 'completed', storage_path: 'https://example.com/qa-verify-race-a1.jpg',
    }).select().single(),
    admin.from('generations').insert({
      user_id: user.id, session_id: session.id, prompt: promptB, media_type: 'image',
      status: 'completed', storage_path: 'https://example.com/qa-verify-race-a2.jpg',
    }).select().single(),
  ]).catch((err) => { raceAError = err; return [null, null]; });

  if (raceAError || raceA1?.error || raceA2?.error) {
    fail('Parallel insert of two completed generations raised an error', String(raceAError || raceA1?.error?.message || raceA2?.error?.message));
  } else {
    pass('Parallel insert of two completed generations succeeded with no error surfaced');
    cleanup.track('generations', 'id', raceA1.data.id, 'QA generation (race A, slot 1)');
    cleanup.track('generations', 'id', raceA2.data.id, 'QA generation (race A, slot 2)');
    await sleep(1500);
    const rA1 = await assertExactlyOneDraftAndLibraryItem(admin, raceA1.data.id, 'Check 2 (race A, generation 1)');
    const rA2 = await assertExactlyOneDraftAndLibraryItem(admin, raceA2.data.id, 'Check 2 (race A, generation 2)');
    if (rA1.postId) cleanup.track('posts', 'id', rA1.postId, 'draft post for race A gen 1');
    if (rA2.postId) cleanup.track('posts', 'id', rA2.postId, 'draft post for race A gen 2');
  }

  section("CHECK 3 — race B: the SAME generation's status flipped to 'completed' twice, concurrently (the actual ON CONFLICT collision)");
  const { data: gen3, error: gen3Error } = await admin
    .from('generations')
    .insert({
      user_id: user.id, session_id: session.id, prompt: qaTag('race-b'), media_type: 'image', status: 'processing',
    })
    .select()
    .single();
  if (gen3Error) {
    fail('Could not insert QA generation row for race B', gen3Error.message);
  } else {
    cleanup.track('generations', 'id', gen3.id, 'QA generation (race B)');
    let raceBError = null;
    await Promise.all([
      admin.from('generations').update({ status: 'completed', storage_path: 'https://example.com/qa-verify-race-b.jpg' }).eq('id', gen3.id),
      admin.from('generations').update({ status: 'completed', storage_path: 'https://example.com/qa-verify-race-b.jpg' }).eq('id', gen3.id),
    ]).catch((err) => { raceBError = err; });

    if (raceBError) {
      fail(
        'Concurrent double-UPDATE to completed raised an error — the ON CONFLICT hardening may not match the live partial index',
        `Error: ${raceBError.message}\n` +
        `If this is a 23505 (unique_violation), the ON CONFLICT target in migration ` +
        `20260712090000_week3_trigger_ownership_hardening.sql does NOT match ` +
        `idx_posts_unique_draft_per_generation_account exactly — this is the character-for-character ` +
        `concern FIXLOG flagged as unverified. Compare both index/conflict-target expressions in the SQL editor.`,
      );
    } else {
      pass('Concurrent double-UPDATE to completed on the same generation raised no error');
      await sleep(1500);
      const rB = await assertExactlyOneDraftAndLibraryItem(admin, gen3.id, 'Check 3 (race B)');
      if (rB.postId) cleanup.track('posts', 'id', rB.postId, 'draft post for race B generation');
    }
  }

  await cleanup.run();
  finish();
}

main().catch((err) => {
  console.error('\nUNEXPECTED SCRIPT ERROR:', err);
  process.exitCode = 1;
});
