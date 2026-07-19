import type { DatabaseClient } from "./supabase.ts";
import { createHttpError } from "./org.ts";

export type CachedGeneration = Record<string, unknown> & { id: string };

/**
 * Looks up a previously-completed generation for this exact
 * (user, request_id, request_slot) triple. Callers should invoke this
 * first, before doing any provider work or billing — a match means the
 * caller already rendered and billed this unit of work (this exact attempt,
 * possibly re-invoked by a network retry or a double-fired client request),
 * so the response should be replayed as-is rather than rendering/billing a
 * second time. `request_id` is optional on the request body for backward
 * compatibility with any caller that hasn't adopted it yet; when absent,
 * idempotency is skipped entirely (matches pre-Week-3 behavior).
 */
export async function findCachedGeneration(
  adminClient: DatabaseClient,
  userId: string,
  requestId: string | null | undefined,
  requestSlot = 0,
): Promise<CachedGeneration | null> {
  if (!requestId) return null;

  const { data, error } = await adminClient
    .from("generations")
    .select("*")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .eq("request_slot", requestSlot)
    .eq("status", "completed")
    .maybeSingle();

  if (error) {
    // A lookup failure must never block a genuine first attempt from
    // rendering — fail open (log and proceed as if no cache hit).
    console.error("[generationIdempotency] cache lookup failed:", error);
    return null;
  }

  return (data as CachedGeneration | null) ?? null;
}

/**
 * Marks the CLIENT-OWNED placeholder generation row (inserted by
 * generationPipeline.js with status PROCESSING before this edge function was
 * ever invoked) as completed, writing the real output — BEFORE this function
 * returns to the caller. This is what makes idempotency actually hold for
 * the "response lost after the provider/billing work already succeeded"
 * case: if the completion write only happened client-side (after receiving
 * this function's response), a lost response would leave the row at
 * PROCESSING forever and a retry would never find a cache hit, re-rendering
 * and re-billing. Writing completion here closes that gap. Ownership split:
 * the CLIENT creates the row and marks FAILED (the only place that can
 * observe a request that never reached this function at all); this function
 * is the sole writer of the COMPLETED transition. `generationId` is optional
 * for backward compatibility with any caller that hasn't threaded it yet —
 * when absent, this is a no-op (matching the pre-Week-3 behavior where this
 * function never wrote to `generations` at all).
 */
export async function completeGeneration(
  adminClient: DatabaseClient,
  generationId: string | null | undefined,
  userId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  if (!generationId) return null;

  const { data: existing } = await adminClient
    .from("generations")
    .select("metadata")
    .eq("id", generationId)
    .eq("user_id", userId)
    .maybeSingle();

  const existingMetadata = (existing?.metadata && typeof existing.metadata === "object")
    ? existing.metadata as Record<string, unknown>
    : {};
  const patchMetadata = (patch.metadata && typeof patch.metadata === "object")
    ? patch.metadata as Record<string, unknown>
    : {};

  const { data, error } = await adminClient
    .from("generations")
    .update({ ...patch, metadata: { ...existingMetadata, ...patchMetadata }, status: "completed" })
    .eq("id", generationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[generationIdempotency] completeGeneration failed:", error);
    return null;
  }

  return data?.id ?? null;
}

/**
 * Atomically reserves credits BEFORE any expensive provider work happens
 * (reserve-then-generate), instead of the old check-then-generate-then-
 * deduct-and-ignore-the-result pattern. deduct_credits() itself is already
 * a correct atomic compare-and-set (see audit-brief/07-structural-findings.md
 * 0.2), but every caller previously discarded its `ok` field — meaning a
 * genuine race at low balance could render/upload/insert a generation row
 * for a request that was never actually billed. Throws a typed 402 if the
 * reservation fails; callers must call this BEFORE starting generation work,
 * not after.
 */
export async function reserveCredits(
  adminClient: DatabaseClient,
  userId: string,
  amount: number,
  category: string,
  description: string,
): Promise<number> {
  const { data, error } = await adminClient.rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_category: category,
    p_description: description,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    throw createHttpError("Insufficient credits", 402);
  }

  return Number(row.new_balance ?? 0);
}
