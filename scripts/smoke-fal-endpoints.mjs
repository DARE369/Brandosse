#!/usr/bin/env node
/**
 * smoke-fal-endpoints.mjs — one-run live check of the 3 fal.ai paths wired
 * during the graphics build that were NEVER tested against a real account:
 *
 *   1. fal-ai/flux-2-pro/edit   — Stage 4 reference-image conditioning
 *   2. fal-ai/clarity-upscaler  — Stage 5.3 upscale / finish pass
 *   3. 4:5 aspect (explicit dims) — Stage 0.1 aspect fix (via base FLUX.2 Pro)
 *
 * These are the model ids / params I wrote from fal's public docs. This script
 * confirms each actually accepts our payload and returns an image, and — for
 * the 4:5 case — that the returned pixels are genuinely portrait, not square.
 *
 * It does NOT touch your app, DB, or credits. It calls fal.ai directly with
 * your FAL_API_KEY and only reads the resulting image dimensions.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   FAL_API_KEY=xxxxx  node scripts/smoke-fal-endpoints.mjs
 *   node scripts/smoke-fal-endpoints.mjs --key xxxxx
 *
 * Get the key value with:
 *   npx supabase secrets list        # shows names; values are hidden
 *   (or copy it from wherever you set it — it never gets written to disk here)
 *
 * Optional flags:
 *   --only flux-edit|upscale|aspect   run just one check
 *   --keep                            print the result image URLs (fal-hosted,
 *                                     expire on their own) so you can eyeball them
 */

const FAL_RUN = "https://fal.run";
const FAL_QUEUE = "https://queue.fal.run";

// A small, known-good public test image fal uses in its own docs — used as the
// source for the edit + upscale checks so we don't depend on your storage.
const SAMPLE_IMAGE = "https://storage.googleapis.com/falserverless/example_inputs/flux2_pro_edit_input.png";

const MODELS = {
  fluxEdit: "fal-ai/flux-2-pro/edit",
  upscale: "fal-ai/clarity-upscaler",
  fluxBase: "fal-ai/flux-2-pro",
};

// ── arg parsing ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined;
}
const KEY = process.env.FAL_API_KEY || flag("key");
const ONLY = flag("only");
const KEEP = Boolean(flag("keep"));

if (!KEY || KEY === true) {
  console.error("\n✗ No FAL_API_KEY.\n  Run:  FAL_API_KEY=xxxxx node scripts/smoke-fal-endpoints.mjs");
  console.error("  or:   node scripts/smoke-fal-endpoints.mjs --key xxxxx\n");
  process.exit(2);
}

const HEADERS = { Authorization: `Key ${KEY}`, "Content-Type": "application/json" };

// ── helpers ───────────────────────────────────────────────────────────────
function log(sym, msg) { console.log(`${sym} ${msg}`); }

/** Sync run first (fast); fall back to the queue if the sync endpoint is busy. */
async function runModel(modelId, input, { timeoutMs = 120000 } = {}) {
  // Try sync
  const syncRes = await fetch(`${FAL_RUN}/${modelId}`, {
    method: "POST", headers: HEADERS, body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => ({ ok: false, _err: e }));

  if (syncRes.ok) return syncRes.json();

  // If sync failed with a real HTTP error (bad model id / params), surface it —
  // don't mask it behind a queue retry.
  if (syncRes.status && syncRes.status !== 503) {
    const body = await syncRes.text().catch(() => syncRes.statusText);
    throw new Error(`HTTP ${syncRes.status}: ${body.slice(0, 500)}`);
  }

  // 503 / network → queue fallback
  const submit = await fetch(`${FAL_QUEUE}/${modelId}`, {
    method: "POST", headers: HEADERS, body: JSON.stringify({ input }),
  });
  if (!submit.ok) throw new Error(`queue submit HTTP ${submit.status}: ${(await submit.text()).slice(0, 400)}`);
  const { request_id, status_url, response_url } = await submit.json();
  const statusUrl = status_url || `${FAL_QUEUE}/${modelId}/requests/${request_id}/status`;
  const responseUrl = response_url || `${FAL_QUEUE}/${modelId}/requests/${request_id}`;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await (await fetch(statusUrl, { headers: HEADERS })).json();
    if (s.status === "COMPLETED") return (await fetch(responseUrl, { headers: HEADERS })).json();
    if (s.status === "FAILED") throw new Error(`queue FAILED: ${s.error || "unknown"}`);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s`);
}

/** Pull the first image {url,width,height} out of fal's various result shapes. */
function firstImage(result) {
  const img = result?.images?.[0] || result?.image || null;
  if (!img?.url) return null;
  return { url: img.url, width: img.width ?? null, height: img.height ?? null };
}

/** Fetch just enough of an image to read its real pixel dimensions (PNG/JPEG). */
async function realDimensions(url) {
  try {
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    // PNG: width/height are big-endian uint32 at bytes 16..24
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      const dv = new DataView(buf.buffer);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    // JPEG: scan SOF markers
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const dv = new DataView(buf.buffer);
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
    }
  } catch { /* fall through */ }
  return null;
}

// ── the three checks ──────────────────────────────────────────────────────
const CHECKS = {
  "flux-edit": {
    title: "Stage 4 — reference-image conditioning (fal-ai/flux-2-pro/edit)",
    async run() {
      const result = await runModel(MODELS.fluxEdit, {
        prompt: "the same subject, in a bright minimalist studio, soft daylight",
        image_urls: [SAMPLE_IMAGE],
        image_size: "square_hd",
        output_format: "jpeg",
      });
      const img = firstImage(result);
      if (!img) throw new Error("no image in response");
      return { detail: `returned ${img.width || "?"}×${img.height || "?"}`, url: img.url };
    },
  },
  upscale: {
    title: "Stage 5.3 — upscale / finish (fal-ai/clarity-upscaler)",
    async run() {
      const result = await runModel(MODELS.upscale, { image_url: SAMPLE_IMAGE, scale: 2 });
      const img = firstImage(result);
      if (!img) throw new Error("no image in response");
      return { detail: `returned ${img.width || "?"}×${img.height || "?"}`, url: img.url };
    },
  },
  aspect: {
    title: "Stage 0.1 — 4:5 aspect via explicit dims (fal-ai/flux-2-pro)",
    async run() {
      // Matches aspectToFalImageSize("4:5") → { width: 896, height: 1120 }
      const result = await runModel(MODELS.fluxBase, {
        prompt: "a tall potted plant on a windowsill, natural light, photorealistic",
        image_size: { width: 896, height: 1120 },
        output_format: "png",
      });
      const img = firstImage(result);
      if (!img) throw new Error("no image in response");
      const real = (await realDimensions(img.url)) || { width: img.width, height: img.height };
      const isPortrait = real.width && real.height && real.height > real.width;
      if (!isPortrait) {
        throw new Error(`got ${real.width}×${real.height} — NOT portrait. 4:5 mapping is wrong (likely rendered square).`);
      }
      const ratio = (real.width / real.height).toFixed(3);
      return { detail: `returned ${real.width}×${real.height} (portrait ✓, ratio ${ratio}, target 0.800)`, url: img.url };
    },
  },
};

// ── run ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("\nfal.ai endpoint smoke test — the 3 untested graphics paths\n");
  const toRun = ONLY && ONLY !== true ? [ONLY] : Object.keys(CHECKS);
  const results = [];

  for (const key of toRun) {
    const check = CHECKS[key];
    if (!check) { log("?", `unknown check "${key}" (use flux-edit|upscale|aspect)`); continue; }
    process.stdout.write(`… ${check.title}\n`);
    const t0 = Date.now();
    try {
      const { detail, url } = await check.run();
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      log("\x1b[32m✓\x1b[0m", `${check.title}\n   ${detail}  (${secs}s)${KEEP && url ? `\n   ${url}` : ""}`);
      results.push({ key, ok: true });
    } catch (e) {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      log("\x1b[31m✗\x1b[0m", `${check.title}\n   FAILED: ${e.message}  (${secs}s)`);
      results.push({ key, ok: false });
    }
    console.log("");
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`──\n${passed}/${results.length} passed.`);
  if (passed < results.length) {
    console.log("A failure usually means the model id or a param is wrong for your account —");
    console.log("fix the id in supabase/functions/_shared/fal.service.ts (FAL_MODELS) and redeploy.\n");
  } else {
    console.log("All three paths work against your account. Safe to rely on Stages 0.1 / 4 / 5.3.\n");
  }
  process.exit(passed === results.length ? 0 : 1);
})();
