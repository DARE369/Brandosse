/**
 * healthCheck — reports whether the cron-driven background jobs this
 * product depends on are actually registered and running.
 *
 * Added for Phase 7 self-audit finding #1: process-scheduled-posts and
 * process-risk-alerts cron registration could previously fail silently
 * (RAISE NOTICE only) with nothing checking afterward whether either job
 * was actually live. This function calls public.get_cron_job_status()
 * (see 20260710110000_cron_reliability_and_credit_reset.sql) and reports,
 * per expected job:
 *   - missing:   never registered (or was unscheduled) — most severe
 *   - inactive:  registered but cron.job.active = false
 *   - failing:   registered + active, but its most recent run did not succeed
 *   - ok:        registered, active, most recent run succeeded (or has never run yet)
 *
 * Call with GET or POST, no auth required for the summary (no sensitive
 * data returned — job names/schedules/status only). Returns 200 if every
 * expected job is "ok" or has never run yet, 503 if any job is missing,
 * inactive, or failing, so this can be wired into external uptime
 * monitoring later.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";

const EXPECTED_JOBS = ["process-scheduled-posts", "process-risk-alerts", "credit-monthly-reset"] as const;

type CronJobStatusRow = {
  job_name: string;
  schedule: string;
  is_active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
};

function evaluateJob(row: CronJobStatusRow | undefined) {
  if (!row) return "missing";
  if (!row.is_active) return "inactive";
  if (row.last_status && row.last_status.toLowerCase() !== "succeeded") return "failing";
  return "ok";
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient.rpc("get_cron_job_status");
    if (error) throw error;

    const rows = (data || []) as CronJobStatusRow[];
    const byName = new Map(rows.map((row) => [row.job_name, row]));

    const jobs = EXPECTED_JOBS.map((jobName) => {
      const row = byName.get(jobName);
      const state = evaluateJob(row);
      return {
        job: jobName,
        state,
        schedule: row?.schedule ?? null,
        is_active: row?.is_active ?? false,
        last_run_at: row?.last_run_at ?? null,
        last_status: row?.last_status ?? null,
        last_message: row?.last_message ?? null,
      };
    });

    const unhealthyJobs = jobs.filter((job) => job.state !== "ok");
    const healthy = unhealthyJobs.length === 0;

    return jsonResponse(
      {
        healthy,
        checked_at: new Date().toISOString(),
        jobs,
        ...(healthy ? {} : { unhealthy_jobs: unhealthyJobs.map((job) => job.job) }),
      },
      healthy ? 200 : 503,
    );
  } catch (error) {
    console.error("[healthCheck] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
