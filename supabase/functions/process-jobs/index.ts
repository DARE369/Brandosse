/**
 * process-jobs — fallback reconciliation sweep (Week 3 Fix 3)
 *
 * Invoked on a schedule via pg_cron + pg_net (both already installed/in use
 * by this project — see 20260710120000_vault_based_cron_secrets.sql and
 * audit-brief/07-structural-findings.md 0.3), the same infrastructure
 * pattern process_scheduled_posts already uses. Purpose: webhooks get
 * dropped (fal-side outage, network blip, this function briefly down) —
 * this sweep catches 'running' video jobs that have been running "too
 * long" and reconciles them directly against fal.ai's queue status, using
 * the exact same reconcileJob() the webhook uses (see
 * _shared/videoJobFinalize.ts), so a dropped webhook self-heals within one
 * sweep interval instead of leaving a job stuck forever.
 *
 * Scheduled-post promotion is deliberately NOT handled here — Phase 0.3
 * confirmed process_scheduled_posts()/dispatch_scheduled_post() already do
 * that job, idempotently, via the exact same pg_cron+pg_net mechanism.
 * Duplicating it into this function would be a second writer for the same
 * invariant (see FIXLOG "0.3 — Scheduler/cron verdict").
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { requireServiceRole } from "../_shared/connectionHelpers.ts";
import { reconcileJob, finalizeFailed, type BackgroundJobRow } from "../_shared/videoJobFinalize.ts";

const STALE_RUNNING_THRESHOLD_MS = 45_000; // fal webhooks are usually near-instant; 45s is generous slack before the poller double-checks
const MAX_JOBS_PER_SWEEP = 25;
// After this many reconcile attempts with no terminal fal status, give up
// and fail the job (refund) rather than poll forever. Was 5 (~5-6 minutes
// total headroom at this cron's 1/minute cadence) — confirmed live
// 2026-07-12 this was too tight: a real Kling premium render legitimately
// took ~5 minutes and was given up on (correctly refunded, no financial
// harm, but the completed video was discarded) moments before it would
// have been reconciled successfully. 20 gives ~20 minutes of headroom,
// comfortably above any of this app's video tiers' expected render time,
// while still eventually giving up on a genuinely stuck job.
const MAX_ATTEMPTS = 20;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    requireServiceRole(req);
    const adminClient = createAdminClient();

    const staleBefore = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS).toISOString();
    const { data: staleJobs, error: fetchError } = await adminClient
      .from("background_jobs")
      .select("id, user_id, status, payload, request_id, attempts")
      .eq("job_type", "video_generation")
      .eq("status", "running")
      .lt("started_at", staleBefore)
      .order("started_at", { ascending: true })
      .limit(MAX_JOBS_PER_SWEEP);

    if (fetchError) throw fetchError;

    const results: Array<{ id: string; outcome: string }> = [];

    for (const job of (staleJobs || []) as BackgroundJobRow[]) {
      try {
        if ((job.attempts ?? 0) >= MAX_ATTEMPTS) {
          await finalizeFailed(adminClient, job, `Gave up after ${MAX_ATTEMPTS} reconciliation attempts with no terminal fal.ai status`);
          results.push({ id: job.id, outcome: "gave_up" });
          continue;
        }

        await adminClient
          .from("background_jobs")
          .update({ attempts: (job.attempts ?? 0) + 1 })
          .eq("id", job.id)
          .eq("status", "running");

        const outcome = await reconcileJob(adminClient, job);
        results.push({ id: job.id, outcome: outcome.status });
      } catch (jobErr) {
        console.error(`[process-jobs] reconcile failed for job ${job.id}:`, jobErr);
        results.push({ id: job.id, outcome: "reconcile_error" });
      }
    }

    return jsonResponse({ swept: results.length, results });
  } catch (error) {
    console.error("[process-jobs] error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
