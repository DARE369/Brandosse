#!/usr/bin/env node
/**
 * restore-deleted-youtube-posts.mjs — one-off repair for the 2026-09-16 incident.
 *
 * WHAT HAPPENED
 * -------------
 * Disconnecting a YouTube account deleted the posts published through it,
 * because posts <- connected_accounts was ON DELETE CASCADE live while the
 * migration claimed SET NULL (repaired by 20260917120000). Two published posts
 * went with it. The VIDEOS still exist on YouTube — only our records of them
 * were lost.
 *
 * WHY IT STILL MATTERS AFTER THE FIX
 * ----------------------------------
 * ingest-social-analytics reads the video ids to poll from
 * posts.external_post_id. With those rows gone it polls nothing, writes nothing,
 * and reports "succeeded" over an empty set — which is exactly what the live
 * ledger shows: three runs since reconnect, rows_written 0 every time. Restoring
 * the posts is what gives analytics anything to read.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * Invent data. Every field is read from YouTube's own API: the title becomes the
 * caption, publishedAt becomes published_at. If a video does not exist, or is
 * not on the connected channel, it is skipped and said so — a post claiming to
 * be a published video that is not there would be worse than the missing row.
 *
 * It also cannot restore the media link: the generation that produced each video
 * may still exist, but nothing recorded which one, and guessing would attach the
 * wrong file to a published post.
 *
 *   Usage:
 *     node scripts/restore-deleted-youtube-posts.mjs                  # dry run
 *     node scripts/restore-deleted-youtube-posts.mjs --apply          # writes
 *     node scripts/restore-deleted-youtube-posts.mjs --video ID --video ID2
 *
 *   Exit 0 = done (or nothing to do). 1 = a video could not be verified.
 *   2 = cannot run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APPLY = process.argv.includes('--apply');

// The two videos published before the deletion. Overridable so this script is
// usable if it ever happens again.
const DEFAULT_VIDEO_IDS = ['vjuIoPzSVcc', '1tqiWxULjdg'];
const videoIds = [];
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--video' && process.argv[i + 1]) videoIds.push(process.argv[i + 1]);
}
const VIDEO_IDS = videoIds.length ? videoIds : DEFAULT_VIDEO_IDS;

// ── Environment ────────────────────────────────────────────────────────────

const ROOT = process.cwd();

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(ROOT, '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const key = line.slice(0, i).trim();
      if (!env[key]) env[key] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TOKEN_ENCRYPTION_KEY',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
  if (!env[key]) {
    console.error(`FATAL: ${key} is required in .env.local.`);
    process.exit(2);
  }
}
// tokenCrypto reads process.env directly.
Object.assign(process.env, env);

const base = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
const db = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };

const { decryptToken } = await import(
  pathToFileURL(path.join(ROOT, 'app', 'api', '_lib', 'tokenCrypto.js')).href
);

async function rest(pathname, init = {}) {
  const res = await fetch(`${base}/rest/v1/${pathname}`, { ...init, headers: { ...db, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}: ${String(text).slice(0, 300)}`);
  return body;
}

// ── 1. The connected account these videos belong to ────────────────────────

const accounts = await rest(
  'connected_accounts?select=id,user_id,platform,account_name,account_id,connection_status,platform_metadata'
  + '&platform=eq.youtube&connection_status=eq.active&order=created_at.desc',
);

if (!accounts.length) {
  console.error('FATAL: no active YouTube account is connected, so there is nothing to attach');
  console.error('       restored posts to. Reconnect YouTube first.');
  process.exit(2);
}
if (accounts.length > 1) {
  console.error(`FATAL: ${accounts.length} active YouTube accounts found. Attaching a published`);
  console.error('       video to the wrong one would be a new wrong record, not a repair.');
  process.exit(2);
}

const account = accounts[0];
const channelId = account.account_id
  || account.platform_metadata?.channel_id
  || account.platform_metadata?.channelId
  || null;

console.log('Account:', account.account_name, `(${account.id})`);
console.log('Channel:', channelId || '(unknown — channel ownership cannot be checked)');
console.log('');

// ── 2. A usable access token ───────────────────────────────────────────────

const secrets = await rest(
  'connected_account_secrets?select=access_token_ciphertext,refresh_token_ciphertext,expires_at'
  + `&connected_account_id=eq.${account.id}`,
);
if (!secrets.length) {
  console.error('FATAL: no stored credential for this account.');
  process.exit(2);
}

let accessToken = null;
const secret = secrets[0];
const expiresAt = secret.expires_at ? new Date(secret.expires_at).getTime() : 0;

if (secret.access_token_ciphertext && expiresAt > Date.now() + 60_000) {
  accessToken = await decryptToken(secret.access_token_ciphertext);
} else if (secret.refresh_token_ciphertext) {
  // Refresh rather than fail: a one-hour access token is almost always stale by
  // the time anyone runs a repair script.
  const refresh = await decryptToken(secret.refresh_token_ciphertext);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    console.error(`FATAL: could not refresh the access token (HTTP ${res.status}).`);
    console.error(`       ${JSON.stringify(json).slice(0, 300)}`);
    process.exit(2);
  }
  accessToken = json.access_token;
  console.log('Refreshed the access token for this read.\n');
} else {
  console.error('FATAL: no usable access or refresh token.');
  process.exit(2);
}

// ── 3. Ask YouTube what these videos actually are ──────────────────────────

const ytRes = await fetch(
  'https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=' + VIDEO_IDS.join(','),
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const yt = await ytRes.json().catch(() => ({}));
if (!ytRes.ok) {
  console.error(`FATAL: YouTube returned HTTP ${ytRes.status}: ${JSON.stringify(yt).slice(0, 300)}`);
  process.exit(2);
}

const found = new Map((yt.items || []).map((v) => [v.id, v]));
let problems = 0;

// ── 4. Restore ─────────────────────────────────────────────────────────────

const existing = await rest(
  `posts?select=id,external_post_id&platform=eq.youtube&external_post_id=in.(${VIDEO_IDS.join(',')})`,
);
const already = new Set(existing.map((p) => p.external_post_id));

for (const id of VIDEO_IDS) {
  const video = found.get(id);

  if (!video) {
    console.log(`  SKIP   ${id} — YouTube does not return this video for this account.`);
    console.log('         Either the id is wrong or the video was removed. Not restoring a post');
    console.log('         that claims a video exists when it does not.');
    problems += 1;
    continue;
  }

  const onChannel = !channelId || video.snippet?.channelId === channelId;
  if (!onChannel) {
    console.log(`  SKIP   ${id} — belongs to channel ${video.snippet?.channelId}, not ${channelId}.`);
    problems += 1;
    continue;
  }

  if (already.has(id)) {
    console.log(`  ok     ${id} — a post already records this video; nothing to restore.`);
    continue;
  }

  const row = {
    user_id: account.user_id,
    account_id: account.id,
    platform: 'youtube',
    caption: video.snippet?.title || '',
    status: 'published',
    external_post_id: id,
    published_at: video.snippet?.publishedAt || null,
    workflow_state: {
      restored_from: 'youtube_data_api',
      restored_at: new Date().toISOString(),
      // Recorded because it determines whether analytics will ever return
      // anything: a private video reports no views, to anyone, ever.
      privacy_status_at_restore: video.status?.privacyStatus || null,
      note: 'Recreated after the 2026-09-16 cascade deletion. Media link not '
          + 'restored: nothing recorded which generation produced this video.',
    },
  };

  console.log(`  ${APPLY ? 'RESTORE' : 'WOULD RESTORE'}  ${id}`);
  console.log(`         title:     ${row.caption}`);
  console.log(`         published: ${row.published_at}`);
  console.log(`         privacy:   ${video.status?.privacyStatus}`);

  if (APPLY) {
    const inserted = await rest('posts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    console.log(`         inserted as ${inserted[0]?.id}`);
  }
}

console.log('');

// ── 5. Say what this changes ───────────────────────────────────────────────

if (!APPLY) {
  console.log('Dry run. Nothing was written. Re-run with --apply to restore.');
} else {
  const after = await rest(
    'posts?select=id,external_post_id,status,published_at&platform=eq.youtube&status=eq.published',
  );
  console.log(`Published YouTube posts now on record: ${after.length}`);
  for (const p of after) console.log(`  ${p.external_post_id}  ${p.published_at}`);
  console.log('');
  console.log('ingest-social-analytics reads these ids on its next run (every 6 hours, or');
  console.log('invoke it directly). A video whose privacy is "private" will still return no');
  console.log('metrics — YouTube reports nothing for a video nobody can watch.');
}

const anyPrivate = [...found.values()].some((v) => v.status?.privacyStatus === 'private');
if (anyPrivate) {
  console.log('');
  console.log('NOTE: at least one video is PRIVATE. Analytics will keep returning zero rows');
  console.log('      until it is public. Uploads are forced private until the YouTube API');
  console.log('      Services audit passes, but you can change it yourself in YouTube Studio.');
}

process.exit(problems > 0 ? 1 : 0);
