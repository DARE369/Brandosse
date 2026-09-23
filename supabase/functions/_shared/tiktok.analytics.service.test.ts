// supabase/functions/_shared/tiktok.analytics.service.test.ts
//
// Unit tests for the TikTok analytics adapter. Every defect these guard
// against is silent — the numbers still look like numbers:
//
//   * a 19-digit video id parsed as a JS number becomes a DIFFERENT id, so a
//     post's analytics attach to nothing (or to someone else's video);
//   * a missing counter coerced to 0 turns "TikTok did not report it" into
//     "nobody watched" — the fabrication Law 3 forbids;
//   * HTTP 200 with error.code != "ok" treated as success stores a scope
//     refusal as "this creator has no videos";
//   * a mapping to a field TikTok does not have (collect_count, removed in
//     20260922120000) is a metric that can never arrive;
//   * a cursor that never advances pages until the budget is gone.
//
//   Run:  deno test --no-check supabase/functions/_shared/tiktok.analytics.service.test.ts

import {
  ACCOUNT_METRICS,
  classifyTikTokError,
  extractPublicPostIds,
  fetchAccount,
  fetchPublishedVideoId,
  fetchVideos,
  hasScope,
  mapAccountFacts,
  mapProfile,
  mapVideoFacts,
  orderByLastAttempt,
  pickReconcileCandidates,
  stopsAccount,
  VIDEO_METRICS,
} from "./tiktok.analytics.service.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, context: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${context}: expected ${e}, got ${a}`);
}

/** Replace fetch for one test; returns the recorded calls. */
function stubFetch(responses: Array<{ status?: number; body: string }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return Promise.resolve(new Response(r.body, { status: r.status ?? 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const OK = { code: "ok", message: "" };

// ── 19-digit ids ────────────────────────────────────────────────────────────

Deno.test("extractPublicPostIds keeps every digit of a 19-digit id", () => {
  const raw = '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok"}}';
  assertEquals(extractPublicPostIds(raw), ["7300000000000000001"], "raw extraction");
  // The failure this exists to prevent: JSON.parse rounds it to another id.
  const parsed = JSON.parse(raw).data.publicaly_available_post_id[0];
  assert(String(parsed) !== "7300000000000000001", "JSON.parse must be shown to corrupt the id, or this test proves nothing");
});

Deno.test("extractPublicPostIds returns [] when TikTok has not assigned an id yet", () => {
  assertEquals(extractPublicPostIds('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[]}}'), [], "empty list");
  assertEquals(extractPublicPostIds('{"data":{"status":"PROCESSING_UPLOAD"}}'), [], "field absent");
  assertEquals(extractPublicPostIds(""), [], "empty body");
});

// ── Null is not zero ────────────────────────────────────────────────────────

Deno.test("mapVideoFacts writes a row only for counters TikTok returned", () => {
  const facts = mapVideoFacts([
    { id: "111", view_count: 120, like_count: 0, comment_count: null },  // share_count absent
    { view_count: 999 },                                                 // no id: unattributable
  ]);
  assertEquals(facts, [
    { platformPostId: "111", metricKey: "views", value: 120 },
    { platformPostId: "111", metricKey: "likes", value: 0 },   // a REPORTED zero is kept
  ], "facts");
});

Deno.test("mapAccountFacts maps user.info.stats and skips what is missing", () => {
  const facts = mapAccountFacts({ follower_count: 12, following_count: 3, likes_count: 45 });
  assertEquals(facts, [
    { platformPostId: null, metricKey: "followers_total", value: 12 },
    { platformPostId: null, metricKey: "following_total", value: 3 },
    { platformPostId: null, metricKey: "likes_received_total", value: 45 },
  ], "account facts");
  assertEquals(mapAccountFacts(null), [], "no user");
  assertEquals(mapAccountFacts({ follower_count: -1, video_count: "abc" }), [], "invalid counts dropped, not zeroed");
});

Deno.test("no mapping names a field TikTok does not document", () => {
  const documented = new Set([
    "view_count", "like_count", "comment_count", "share_count",
    "follower_count", "following_count", "likes_count", "video_count",
  ]);
  for (const field of [...Object.keys(VIDEO_METRICS), ...Object.keys(ACCOUNT_METRICS)]) {
    assert(documented.has(field), `${field} is not a documented TikTok field`);
  }
  assert(!("collect_count" in VIDEO_METRICS), "collect_count does not exist on TikTok's Video object");
});

Deno.test("mapProfile keeps is_verified=false distinct from unknown", () => {
  assertEquals(mapProfile({ is_verified: false }).isVerified, false, "false");
  assertEquals(mapProfile({}).isVerified, null, "absent");
  assertEquals(mapProfile({ username: "  " }).username, null, "blank username");
});

// ── Errors ──────────────────────────────────────────────────────────────────

Deno.test("classifyTikTokError separates conditions with different remedies", () => {
  assertEquals(classifyTikTokError(200, { error: { code: "scope_not_authorized" } }).code, "scope_not_granted", "scope");
  assertEquals(classifyTikTokError(401, {}).code, "token_rejected", "401");
  assertEquals(classifyTikTokError(200, { error: { code: "access_token_invalid" } }).code, "token_rejected", "token");
  assertEquals(classifyTikTokError(429, {}).retriable, true, "rate limit retriable");
  assertEquals(classifyTikTokError(503, null).retriable, true, "5xx retriable");
  assertEquals(classifyTikTokError(200, { error: { code: "scope_not_authorized" } }).retriable, false, "scope not retriable");
});

Deno.test("hasScope reads comma-separated and array grants", () => {
  assert(hasScope("user.info.basic,video.list", "video.list"), "comma string");
  assert(hasScope(["user.info.stats"], "user.info.stats"), "array");
  assert(!hasScope("user.info.basic", "video.list"), "absent");
  assert(!hasScope(null, "video.list"), "null");
});

// ── Requests ────────────────────────────────────────────────────────────────

Deno.test("fetchAccount treats HTTP 200 with a non-ok error code as a failure", async () => {
  const s = stubFetch([{ body: JSON.stringify({ data: {}, error: { code: "scope_not_authorized" } }) }]);
  try {
    const r = await fetchAccount("t", "user.info.basic,user.info.stats");
    assertEquals(r.error?.code, "scope_not_granted", "error code");
    assertEquals(r.facts, [], "no facts from a refusal");
  } finally { s.restore(); }
});

Deno.test("fetchAccount only asks for fields whose scope was granted", async () => {
  const s = stubFetch([{ body: JSON.stringify({ data: { user: { open_id: "o", follower_count: 5 } }, error: OK }) }]);
  try {
    await fetchAccount("t", "user.info.basic,user.info.stats");
    const url = s.calls[0].url;
    assert(url.includes("follower_count"), "stats fields requested");
    assert(!url.includes("bio_description"), "profile fields NOT requested without user.info.profile");
  } finally { s.restore(); }
});

Deno.test("fetchVideos paginates on cursor and stops when has_more is false", async () => {
  const s = stubFetch([
    { body: JSON.stringify({ data: { videos: [{ id: "1", view_count: 10 }], cursor: 100, has_more: true }, error: OK }) },
    { body: JSON.stringify({ data: { videos: [{ id: "2", view_count: 20 }], cursor: 200, has_more: false }, error: OK }) },
  ]);
  try {
    const r = await fetchVideos("t");
    assertEquals(r.httpRequests, 2, "two pages");
    assertEquals(r.videos.map((v) => v.id), ["1", "2"], "both pages collected");
    assertEquals(s.calls[1].body, { max_count: 20, cursor: 100 }, "second page sends the cursor");
    assertEquals(r.truncated, false, "not truncated");
  } finally { s.restore(); }
});

Deno.test("fetchVideos stops on a cursor that does not advance", async () => {
  const s = stubFetch([
    { body: JSON.stringify({ data: { videos: [{ id: "1" }], cursor: 5, has_more: true }, error: OK }) },
  ]);
  try {
    const r = await fetchVideos("t", { maxPages: 10 });
    assertEquals(r.httpRequests, 2, "stops after the repeat, not after 10 pages");
  } finally { s.restore(); }
});

Deno.test("fetchVideos reports truncation at the page budget", async () => {
  let n = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    n += 1;
    return Promise.resolve(new Response(JSON.stringify({ data: { videos: [{ id: String(n) }], cursor: n * 10, has_more: true }, error: OK })));
  }) as typeof fetch;
  try {
    const r = await fetchVideos("t", { maxPages: 3 });
    assertEquals(r.httpRequests, 3, "bounded");
    assertEquals(r.truncated, true, "truncation surfaced");
  } finally { globalThis.fetch = original; }
});

Deno.test("fetchVideos keeps earlier pages when a later page fails", async () => {
  const s = stubFetch([
    { body: JSON.stringify({ data: { videos: [{ id: "1", view_count: 3 }], cursor: 1, has_more: true }, error: OK }) },
    { status: 500, body: "" },
  ]);
  try {
    const r = await fetchVideos("t");
    assertEquals(r.facts.length, 1, "page one kept");
    assertEquals(r.error?.code, "http_500", "failure reported");
  } finally { s.restore(); }
});

Deno.test("fetchVideos takes each video id once across pages", async () => {
  const s = stubFetch([
    { body: JSON.stringify({ data: { videos: [{ id: "1", view_count: 1 }, { id: "2", view_count: 2 }], cursor: 10, has_more: true }, error: OK }) },
    { body: JSON.stringify({ data: { videos: [{ id: "2", view_count: 99 }, { id: "3", view_count: 3 }], cursor: 20, has_more: false }, error: OK }) },
  ]);
  try {
    const r = await fetchVideos("t");
    assertEquals(r.videos.map((v) => v.id), ["1", "2", "3"], "no duplicate ids");
    assertEquals(r.facts.filter((f) => f.platformPostId === "2").map((f) => f.value), [2], "first sighting wins");
  } finally { s.restore(); }
});

Deno.test("pickReconcileCandidates rotates, never-checked first, skipping dead and resolved", () => {
  const post = (id: string, ext: string, tiktok: Record<string, unknown> = {}) =>
    ({ id, external_post_id: ext, workflow_state: { tiktok } });
  const picked = pickReconcileCandidates([
    post("a", "v_pub_a", { reconcile_checked_at: "2026-09-22T10:00:00Z" }),
    post("b", "v_pub_b"),                                                   // never checked
    post("c", "7300000000000000001"),                                       // already a video id
    post("d", "v_pub_d", { reconcile_status: "failed" }),                   // TikTok said FAILED
    post("e", "v_pub_e", { reconcile_checked_at: "2026-09-21T10:00:00Z" }),
  ], 2);
  assertEquals(picked.map((p) => p.id), ["b", "e"], "never-checked, then oldest-checked");
});

Deno.test("orderByLastAttempt puts never-attempted and oldest accounts first", () => {
  const order = orderByLastAttempt(
    [{ id: "x" }, { id: "y" }, { id: "z" }],
    new Map([["x", "2026-09-22T06:00:00Z"], ["z", "2026-09-21T06:00:00Z"]]),
  );
  assertEquals(order.map((a) => a.id), ["y", "z", "x"], "rotation order");
});

Deno.test("stopsAccount only for errors that repeat on every call", () => {
  assert(stopsAccount({ code: "token_rejected", detail: "", retriable: false }), "token");
  assert(stopsAccount({ code: "rate_limited", detail: "", retriable: true }), "rate");
  assert(!stopsAccount({ code: "http_500", detail: "", retriable: true }), "one-off");
  assert(!stopsAccount(null), "no error");
});

Deno.test("fetchPublishedVideoId returns the exact 19-digit id", async () => {
  const s = stubFetch([{ body: '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7412345678901234567]},"error":{"code":"ok","message":""}}' }]);
  try {
    const r = await fetchPublishedVideoId("t", "v_pub_file~abc");
    assertEquals(r.videoId, "7412345678901234567", "id intact");
    assertEquals(r.status, "PUBLISH_COMPLETE", "status");
  } finally { s.restore(); }
});
