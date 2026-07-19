// WEEK 2 FIX 5 (+ ADDENDUM UPGRADE 3) — per-function rate limiting.
// Call enforceRateLimit(adminClient, userId, functionName) immediately
// after requireUser() in every function listed below. Service-role callers
// (the scheduled-publish worker invoking mock-publish/publish-post) must
// bypass this entirely — pass null/skip the call for those paths.
import type { DatabaseClient } from "./supabase.ts";
import { createHttpError, type HttpError } from "./org.ts";

type RateLimitConfig = { max: number; windowSeconds: number };

// Numbers chosen to be generous against the app's own automatic call
// patterns (see FIXLOG's worst-case-per-minute walkthrough) and tight
// against scripted abuse. All windows are 60s so the numbers read directly
// as "per minute."
//
//   enhance-prompt         10/min — one click per Enhance-prompt press;
//                          10 comfortably covers rapid iterate-and-retry.
//   generate-content-plan  10/min — one call per single/carousel
//                          generation attempt (+1 more only if the quality
//                          gate requests a revision) — a user generating
//                          repeatedly would need 5+ back-to-back attempts
//                          in under a minute to ever approach this.
//   generate-post-metadata 10/min — fires once per generation completion
//                          (auto) plus manual "Regenerate caption & title"
//                          clicks (Fix 3). Carousel completions can fire
//                          several in a burst (one per completed slide) —
//                          10 covers a 6-8 slide carousel plus a manual
//                          retry with room to spare.
//   generate-caption       10/min — legacy/rarely-invoked path (see Week 1
//                          Fix 2 notes); generous ceiling, not expected to
//                          be approached in normal use.
//   seo-score              15/min — auto-run once per publish-stage entry
//                          plus manual "Re-score" (Fix 3) clicks; highest
//                          limit of the LLM-only group since it's the
//                          cheapest/fastest call and the most likely to be
//                          clicked repeatedly while iterating on copy.
//   optimize-seo           6/min  — the most expensive LLM-only call (two
//                          LLM passes per invocation as of Fix 4); auto-run
//                          fires once per publish-stage entry, so even a
//                          user bouncing between 3-4 generations' publish
//                          stages inside a minute stays well under this.
//   generateImage          20/min — credit-metered already, but still
//                          floodable at 1 credit/call; covers a full 4-
//                          image batch generation plus a carousel's worth
//                          of slides in the same window.
//   editImage              12/min — pricier per-call (3 credits) and
//                          typically single-shot per edit attempt.
//   generateVideo           4/min — most expensive call in the whole app
//                          (5-15 credits); video generation is inherently
//                          slow (the UI itself says "usually 2-4 minutes"),
//                          so a real user would rarely approach even this
//                          low ceiling within 60s.
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "enhance-prompt": { max: 10, windowSeconds: 60 },
  "generate-content-plan": { max: 10, windowSeconds: 60 },
  "generate-post-metadata": { max: 10, windowSeconds: 60 },
  "generate-caption": { max: 10, windowSeconds: 60 },
  "seo-score": { max: 15, windowSeconds: 60 },
  "optimize-seo": { max: 6, windowSeconds: 60 },
  generateImage: { max: 20, windowSeconds: 60 },
  editImage: { max: 12, windowSeconds: 60 },
  generateVideo: { max: 4, windowSeconds: 60 },
  // quality-gate fires once per generated image (2.1). It's an uncredited
  // vision call bundled into the image price, so it must have its OWN cap or
  // it's an unmetered cost leak — 24/min comfortably covers a 4-image batch +
  // a full carousel scored back-to-back, while blocking a tight-loop abuser.
  "quality-gate": { max: 24, windowSeconds: 60 },
  // upscale is a credited, single-shot finishing action — modest cap.
  upscaleImage: { max: 10, windowSeconds: 60 },
};

type CheckRateLimitRow = { allowed: boolean; retry_after_seconds: number };

export function createRateLimitError(retryAfterSeconds: number): HttpError {
  const error = createHttpError("Too many requests — please wait a moment.", 429) as HttpError & {
    retryAfterSeconds?: number;
  };
  error.retryAfterSeconds = Math.max(1, Math.round(retryAfterSeconds));
  return error;
}

/**
 * Throws a 429 (with retryAfterSeconds attached, surfaced by toErrorPayload)
 * if the given function's configured limit has been exceeded for this user.
 * No-ops (fails OPEN) if the function has no configured limit, or if the
 * check_rate_limit RPC itself errors — a broken limiter must never be the
 * reason the whole app goes down; that failure is logged loudly instead.
 */
export async function enforceRateLimit(
  adminClient: DatabaseClient,
  userId: string,
  functionName: string,
): Promise<void> {
  const config = RATE_LIMITS[functionName];
  if (!config) return;

  const { data, error } = await adminClient.rpc("check_rate_limit", {
    p_user_id: userId,
    p_function: functionName,
    p_max: config.max,
    p_window_seconds: config.windowSeconds,
  });

  if (error) {
    console.error(`[rateLimit] check_rate_limit RPC failed for ${functionName}:`, error);
    return;
  }

  const row = (Array.isArray(data) ? data[0] : data) as CheckRateLimitRow | undefined;
  if (row && !row.allowed) {
    throw createRateLimitError(row.retry_after_seconds);
  }
}
