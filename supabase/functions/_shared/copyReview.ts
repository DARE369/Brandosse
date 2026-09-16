// supabase/functions/_shared/copyReview.ts
//
// Server half of the copy review report. The client half is
// src/calendar/copyReview.js; read its header for the lifecycle.
//
// canonicalCopyInputs and fingerprintCopyInputs MUST produce byte-identical
// output to the client versions. If they drift, every snapshot the composer
// attaches looks stale to the worker, and the worker pays to re-score every
// published post while reporting nothing wrong. scripts/test/
// copy-review.test.mjs imports BOTH files and fails on any divergence.
//
// No Deno globals at module scope, deliberately: Node's type stripping loads
// this file directly in that test, which is what makes the equivalence check
// real rather than a comparison of two copies someone pasted.

export const COPY_REVIEW_VERSION = 1;

/**
 * How many times the worker tries to score one published post before freezing
 * it as unavailable. Each try is a paid model call; an unbounded retry against
 * a post the model cannot score is a cost leak with no ceiling.
 */
export const MAX_FINAL_ATTEMPTS = 3;

/**
 * How far back the worker looks for published posts still owed a report.
 * MUST equal FINALIZE_LOOKBACK_DAYS in src/calendar/copyReview.js, which uses
 * it to stop promising a report the worker will never take. Asserted by
 * copy-review.test.mjs.
 */
export const LOOKBACK_DAYS = 7;

export type CopyInputs = {
  platform?: string | null;
  caption?: string | null;
  title?: string | null;
  hashtags?: unknown;
};

export function canonicalCopyInputs({ platform, caption, title, hashtags }: CopyInputs = {}): string {
  const tags = (Array.isArray(hashtags) ? hashtags : [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean);
  return JSON.stringify([
    `v${COPY_REVIEW_VERSION}`,
    String(platform ?? "").trim().toLowerCase(),
    String(caption ?? "").replace(/\r\n?/g, "\n").trim(),
    String(title ?? "").replace(/\r\n?/g, "\n").trim(),
    [...new Set(tags)].sort(),
  ]);
}

export async function fingerprintCopyInputs(inputs: CopyInputs): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalCopyInputs(inputs));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The persisted result shape, built from _shared/seo.ts scoreContent output. */
export function storedResultFromPayload(payload: {
  overall: number;
  category: string;
  breakdown: Record<string, number>;
  measured: string[];
  suggestions: string[];
  benchmarkReport: string[];
  provider: string | null;
  model: string | null;
}) {
  // No measured metric means no reading at all, however the overall was
  // derived — freezing a "0" for text the model said nothing about would be a
  // permanent fabricated score. The caller treats null as a failed attempt.
  if (!Array.isArray(payload?.measured) || payload.measured.length === 0) return null;
  return {
    overall: payload.overall,
    category: payload.category || null,
    breakdown: payload.breakdown || {},
    measured: payload.measured,
    suggestions: Array.isArray(payload.suggestions) ? payload.suggestions.filter(Boolean) : [],
    benchmark_report: Array.isArray(payload.benchmarkReport) ? payload.benchmarkReport : [],
    provider: payload.provider || null,
    model: payload.model || null,
  };
}

type CopyReviewBlock = {
  snapshot?: { fingerprint?: string; scored_at?: string; result?: { overall?: unknown } } | null;
  final?: unknown;
  final_attempts?: unknown;
};

export type FinaliseDecision =
  | { action: "skip"; why: string }
  | { action: "promote" }
  | { action: "score"; attempt: number }
  | { action: "give_up"; attempts: number };

/**
 * What the worker should do with one post. Pure, so every branch is testable
 * without a database or a model.
 *
 * The rule that matters: a report that exists is NEVER replaced. "At the point
 * of publishing, these were the scores" is only true if nothing edits it later.
 */
export function decideFinalisation(
  post: { status?: string | null; workflow_state?: unknown },
  currentFingerprint: string,
): FinaliseDecision {
  if (String(post?.status || "").toLowerCase() !== "published") {
    return { action: "skip", why: "not published" };
  }

  const w = (post?.workflow_state && typeof post.workflow_state === "object")
    ? post.workflow_state as Record<string, unknown>
    : {};
  const block = (w.copy_review && typeof w.copy_review === "object")
    ? w.copy_review as CopyReviewBlock
    : {};

  if (block.final) return { action: "skip", why: "already frozen" };

  const snap = block.snapshot;
  const snapOverall = snap?.result?.overall;
  const snapHasScore = snapOverall !== null && snapOverall !== undefined
    && Number.isFinite(Number(snapOverall));
  if (snap && snapHasScore && snap.fingerprint === currentFingerprint) {
    return { action: "promote" };
  }

  const attempts = Number(block.final_attempts || 0) || 0;
  if (attempts >= MAX_FINAL_ATTEMPTS) return { action: "give_up", attempts };
  return { action: "score", attempt: attempts + 1 };
}
