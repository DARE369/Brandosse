// finalize-copy-reviews — freezes the copy review report onto a post once it
// has actually published.
//
// ── What it is for ──────────────────────────────────────────────────────────
// "Upon the point of publishing, these were the scores" — a record that stays
// the same forever and lives on the post (the details panel reads it). The
// composer's score is advisory and can be stale; this is the one that counts.
//
// ── Why a separate worker and not part of publish-post ──────────────────────
// publish-post is the dispatcher every post goes through, proven in production.
// Scoring is a paid model call that can take two minutes (60s timeout, one
// retry in _shared/seo.ts) and fails for reasons that have nothing to do with
// publishing. Putting it in the dispatcher would put the one path that must
// work behind the one call most likely not to. Here, a scoring outage costs a
// delayed report and nothing else.
//
// ── What one run does ───────────────────────────────────────────────────────
// Published in the last 7 days, no frozen report yet. For each:
//   promote — the composer's snapshot still matches the published text: freeze
//             it as-is. No model call.
//   score   — the text changed after scoring, or was never scored: score it now.
//             At most SCORE_BUDGET_PER_RUN of these, because each can take up
//             to two minutes and the function has a wall-clock limit.
//   give_up — MAX_FINAL_ATTEMPTS failed scores: freeze "unavailable" with the
//             last reason. Also permanent, and also shown to the user.
//
// ── What it must never do ───────────────────────────────────────────────────
// Replace an existing report. Every write is conditional on `final` still
// being absent, so two overlapping runs cannot both freeze a post, and nothing
// can rewrite what the user was shown.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { requireInvokeSecret } from "../_shared/connectionHelpers.ts";
import { scoreContent } from "../_shared/seo.ts";
import {
  COPY_REVIEW_VERSION,
  decideFinalisation,
  LOOKBACK_DAYS,
  fingerprintCopyInputs,
  MAX_FINAL_ATTEMPTS,
  storedResultFromPayload,
} from "../_shared/copyReview.ts";

// LOOKBACK_DAYS comes from _shared/copyReview.ts so the UI and the worker agree
// on when a report stops being coming.
const CANDIDATE_LIMIT = 25;
const SCORE_BUDGET_PER_RUN = 2;
// Stop starting new scores past this point. A score can take ~120s; the
// function is killed near 150s, and a kill mid-write loses the attempt count.
const START_DEADLINE_MS = 25_000;

type PostRow = {
  id: string;
  status: string | null;
  platform: string | null;
  caption: string | null;
  title: string | null;
  hashtags: unknown;
  published_at: string | null;
  workflow_state: Record<string, unknown> | null;
  generations: { media_type?: string | null; prompt?: string | null } | null;
};

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    requireInvokeSecret(req);
  } catch (err) {
    // A misconfigured deployment is ours and must not read as a rejected caller.
    return (err as Error).message === "function_invoke_secret_not_configured"
      ? jsonResponse({ error: "Server misconfigured" }, 500)
      : jsonResponse({ error: "Unauthorized" }, 401);
  }

  const startedAt = Date.now();
  const admin = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data, error } = await admin
    .from("posts")
    .select("id, status, platform, caption, title, hashtags, published_at, workflow_state, generations ( media_type, prompt )")
    .eq("status", "published")
    .gte("published_at", since)
    .is("workflow_state->copy_review->final", null)
    .order("published_at", { ascending: true })
    .limit(CANDIDATE_LIMIT);

  if (error) {
    // Surfaced, never swallowed: pg_cron records the HTTP call as a success
    // regardless, so the status code is the only signal this run failed.
    console.error("[finalize-copy-reviews] candidate query failed:", error.message);
    return jsonResponse({ error: "candidate query failed", detail: error.message }, 500);
  }

  const counts = { candidates: (data || []).length, promoted: 0, scored: 0, failed: 0, gave_up: 0, skipped: 0, conflicts: 0 };
  let scoreBudget = SCORE_BUDGET_PER_RUN;

  for (const post of (data || []) as PostRow[]) {
    const inputs = { platform: post.platform, caption: post.caption, title: post.title, hashtags: post.hashtags };
    const fingerprint = await fingerprintCopyInputs(inputs);
    const decision = decideFinalisation(post, fingerprint);

    const w = (post.workflow_state && typeof post.workflow_state === "object") ? post.workflow_state : {};
    const block = (w.copy_review && typeof w.copy_review === "object") ? w.copy_review as Record<string, unknown> : {};
    const frozenAt = new Date().toISOString();

    let nextBlock: Record<string, unknown> | null = null;
    // Counted only once the write lands, so the run summary never reports a
    // report as frozen when a conflict or a write error meant it was not.
    let outcome: "promoted" | "scored" | "gave_up" | "failed" = "failed";

    if (decision.action === "skip") {
      counts.skipped += 1;
      continue;
    }

    if (decision.action === "promote") {
      const snap = block.snapshot as Record<string, unknown>;
      nextBlock = {
        ...block,
        final: {
          version: COPY_REVIEW_VERSION,
          state: "scored",
          fingerprint,
          frozen_at: frozenAt,
          published_at: post.published_at,
          source: "composer",
          scored_at: snap.scored_at ?? null,
          result: snap.result,
          reason: null,
        },
      };
      outcome = "promoted";
    } else if (decision.action === "give_up") {
      nextBlock = {
        ...block,
        final: {
          version: COPY_REVIEW_VERSION,
          state: "unavailable",
          fingerprint,
          frozen_at: frozenAt,
          published_at: post.published_at,
          source: "publish",
          scored_at: null,
          result: null,
          reason: String(block.last_error || `Could not be scored after ${MAX_FINAL_ATTEMPTS} attempts.`),
        },
      };
      outcome = "gave_up";
    } else {
      // score
      if (scoreBudget <= 0 || Date.now() - startedAt > START_DEADLINE_MS) {
        counts.skipped += 1;
        continue; // next run picks it up; nothing is recorded as an attempt
      }
      scoreBudget -= 1;

      try {
        const payload = await scoreContent({
          title: post.title ?? "",
          caption: post.caption ?? "",
          hashtags: Array.isArray(post.hashtags) ? post.hashtags as string[] : [],
          platform: post.platform ?? "",
          mediaType: post.generations?.media_type ?? null,
          visualPrompt: post.generations?.prompt ?? null,
        });
        const stored = storedResultFromPayload(payload);
        if (!stored) throw new Error("The scorer returned no metrics for this text.");

        nextBlock = {
          ...block,
          final: {
            version: COPY_REVIEW_VERSION,
            state: "scored",
            fingerprint,
            frozen_at: frozenAt,
            published_at: post.published_at,
            source: "publish",
            scored_at: frozenAt,
            result: stored,
            reason: null,
          },
        };
        outcome = "scored";
      } catch (err) {
        const message = (err as Error)?.message || "Scoring failed.";
        console.error(`[finalize-copy-reviews] post ${post.id} attempt ${decision.attempt} failed:`, message);
        nextBlock = { ...block, final_attempts: decision.attempt, last_error: message.slice(0, 500) };
        outcome = "failed";
      }
    }

    // Conditional on `final` still being absent: a concurrent run, or anything
    // else, that froze this post first wins, and this write changes nothing.
    // Read-modify-write on the WHOLE workflow_state because approval routing and
    // publish accounting share the column (handoff 2026-09-09 §4.2).
    const { data: written, error: writeError } = await admin
      .from("posts")
      .update({ workflow_state: { ...w, copy_review: nextBlock } })
      .eq("id", post.id)
      .is("workflow_state->copy_review->final", null)
      .select("id");

    if (writeError) {
      console.error(`[finalize-copy-reviews] write failed for post ${post.id}:`, writeError.message);
      counts.failed += 1;
    } else if (!written || written.length === 0) {
      counts.conflicts += 1;
    } else {
      counts[outcome] += 1;
    }
  }

  console.log("[finalize-copy-reviews]", JSON.stringify(counts));
  return jsonResponse({ ok: true, ...counts });
});
