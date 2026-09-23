// supabase/functions/ingest-social-analytics/ledger.ts
//
// social_ingestion_runs helpers shared by every platform's ingester, so each
// one records its runs identically. The ledger is what makes a silently
// stopped ingester detectable; two hand-written copies of "close a run" is two
// chances for one of them to leave runs open or mislabel a partial as success.

import { createAdminClient } from "../_shared/supabase.ts";

export type Admin = ReturnType<typeof createAdminClient>;

/** Close a run. A run left `running` is reaped an hour later as abandoned. */
export async function closeRun(admin: Admin, runId: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from("social_ingestion_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", runId);

  if (error) {
    // Loud: an unclosed run makes the freshness view report work in progress
    // that is not in progress, and blocks the next run's mode decision.
    console.error(`[ingest-social-analytics] could not close run ${runId}: ${error.message}`);
  }
}

/**
 * Record a run that was decided without doing any work (skipped_*, or failed
 * before a run could open).
 *
 * error_code is what the analytics page turns into words. A skip with no code
 * rendered as "the last collection did not succeed" — true, and useless: the
 * user cannot tell "reconnect to grant a scope" from "wait for tomorrow's
 * budget".
 */
export async function recordSkippedRun(
  admin: Admin,
  row: {
    connected_account_id: string;
    platform: string;
    source: string;
    quota_key: string;
    status: string;
    error_code: string;
    error_detail?: string;
  },
) {
  const { error } = await admin.from("social_ingestion_runs").insert({
    ...row,
    mode: "incremental",
    finished_at: new Date().toISOString(),
  });
  if (error) console.error(`[ingest-social-analytics] could not record ${row.status}: ${error.message}`);
}

/**
 * `partial` is a real outcome, not a rounding of success: rows landed AND
 * something failed. Reporting it as succeeded would let the next run treat an
 * incomplete observation as covered.
 */
export function finalStatus(firstError: unknown, rowsWritten: number): "succeeded" | "partial" | "failed" {
  if (!firstError) return "succeeded";
  return rowsWritten > 0 ? "partial" : "failed";
}
