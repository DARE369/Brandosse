/**
 * _shared/costLedger.ts — LOCK L5.14.
 *
 * One row per provider call. Every paid call to fal.ai, Anthropic, Groq or
 * ElevenLabs records what it bought, what we predicted it would cost, and what
 * it actually cost.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `FAL_COST_USD` in fal.service.ts is labelled "Cost estimates (informational)"
 * and nothing recorded actual spend anywhere. That made eight separate cost
 * controls unenforceable — the retry multiplier, the per-user ceiling, real
 * COGS per delivered video, provider price drift, invoice reconciliation, and
 * the estimate-versus-charge promise the customer actually judges us on.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A provider call that is not recorded here did not happen, as far as every
 * cost control in the system is concerned. `scripts/check-cost-ledger.cjs`
 * asserts that any edge function calling a paid provider also records.
 *
 * ── Failure posture: record-and-continue ────────────────────────────────────
 * recordCost() never throws. A ledger write failing must not fail a generation
 * the user has already been charged for — that would turn an accounting
 * problem into a product outage and a refund. It logs loudly instead, and the
 * gap shows up in the invoice reconciliation, which is exactly what that
 * reconciliation is for.
 */

import type { DatabaseClient } from "./supabase.ts";

/** Whether this call was the plan, or a repeat of one that failed QC. */
export type CallClass = "planned" | "retry";

export type CostEntry = {
  userId: string;
  provider: "fal" | "anthropic" | "groq" | "elevenlabs" | string;
  modelId: string;
  /** 'planned' unless this is a re-attempt. The retry multiplier R — the
   *  variable the unit economics turn on — is derived from this field and
   *  cannot be reconstructed from anything else later. */
  callClass?: CallClass;
  modelVersion?: string;
  jobId?: string | null;
  generationId?: string | null;
  shotId?: string | null;
  /** How much was bought, in `unitType`. Keep them together: $/second and
   *  $/megapixel are not comparable and a bare number silently mixes them. */
  units?: number | null;
  unitType?: "seconds" | "megapixels" | "characters" | "images" | "calls" | string | null;
  /** What we predicted before the call. */
  estimatedCostUsd?: number | null;
  /** What it actually cost. When a provider does not report per-call cost,
   *  leave null rather than copying the estimate across — a copied estimate
   *  makes drift invisible, which defeats the point of storing both. */
  actualCostUsd?: number | null;
  providerJobId?: string | null;
  status?: "recorded" | "failed" | "refunded";
  errorMessage?: string | null;
};

export async function recordCost(
  adminClient: DatabaseClient,
  entry: CostEntry,
): Promise<void> {
  if (!entry?.userId || !entry?.provider || !entry?.modelId) {
    console.error("cost_ledger_incomplete_entry", {
      hasUser: Boolean(entry?.userId),
      provider: entry?.provider,
      modelId: entry?.modelId,
    });
    return;
  }

  try {
    const { error } = await adminClient.from("video_cost_ledger").insert({
      user_id: entry.userId,
      job_id: entry.jobId ?? null,
      generation_id: entry.generationId ?? null,
      shot_id: entry.shotId ?? null,
      provider: entry.provider,
      model_id: entry.modelId,
      model_version: entry.modelVersion ?? null,
      call_class: entry.callClass ?? "planned",
      units: entry.units ?? null,
      unit_type: entry.unitType ?? null,
      estimated_cost_usd: entry.estimatedCostUsd ?? null,
      actual_cost_usd: entry.actualCostUsd ?? null,
      provider_job_id: entry.providerJobId ?? null,
      status: entry.status ?? "recorded",
      error_message: entry.errorMessage ?? null,
    });
    if (error) {
      // Loud, and with enough detail to reconstruct the missing row by hand.
      console.error("cost_ledger_write_failed", {
        message: error.message,
        provider: entry.provider,
        modelId: entry.modelId,
        userId: entry.userId,
      });
    }
  } catch (e) {
    console.error("cost_ledger_write_threw", {
      error: e instanceof Error ? e.message : String(e),
      provider: entry.provider,
      modelId: entry.modelId,
    });
  }
}

/**
 * Total USD a user has spent in a trailing window.
 *
 * Sums `actual_cost_usd` where present and falls back to the estimate where it
 * is not, because a ceiling that ignored unpriced calls would be trivially
 * exceeded by whichever provider happens not to report per-call cost.
 */
export async function userSpendSince(
  adminClient: DatabaseClient,
  userId: string,
  sinceIso: string,
): Promise<number> {
  const { data, error } = await adminClient
    .from("video_cost_ledger")
    .select("estimated_cost_usd, actual_cost_usd")
    .eq("user_id", userId)
    .eq("status", "recorded")
    .gte("created_at", sinceIso);

  if (error || !Array.isArray(data)) return 0;

  return data.reduce((sum, row) => {
    const r = row as Record<string, unknown>;
    const actual = typeof r.actual_cost_usd === "number" ? r.actual_cost_usd : null;
    const estimated = typeof r.estimated_cost_usd === "number" ? r.estimated_cost_usd : 0;
    return sum + (actual ?? estimated);
  }, 0);
}

/**
 * The measured retry multiplier for a window: total calls / planned calls.
 *
 * 1.0 means nothing was retried. The unit-economics model assumes 1.5 and the
 * Growth tier stops clearing 60% margin somewhere above 4.1 — but only if this
 * is actually watched, which is the entire reason call_class is stored.
 *
 * Returns null rather than 1 when there is nothing to measure, so "no data"
 * cannot be mistaken for "no retries".
 */
export async function retryMultiplier(
  adminClient: DatabaseClient,
  sinceIso: string,
): Promise<number | null> {
  const { data, error } = await adminClient
    .from("video_cost_ledger")
    .select("call_class")
    .eq("status", "recorded")
    .gte("created_at", sinceIso);

  if (error || !Array.isArray(data) || data.length === 0) return null;

  const planned = data.filter((r) => (r as Record<string, unknown>).call_class === "planned").length;
  if (planned === 0) return null;
  return data.length / planned;
}
