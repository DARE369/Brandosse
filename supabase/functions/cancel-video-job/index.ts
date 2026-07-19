/**
 * cancel-video-job — Week 3 Fix 3 honest cancel for video jobs.
 *
 * Marks a queued/running background_jobs row 'cancelled' (status-guarded,
 * same claim pattern as videoJobFinalize.ts) and refunds the reserved
 * credits. Best-effort attempts fal.ai's queue cancel endpoint (not all
 * models support it — see _shared/fal.service.ts cancelQueueJob, which
 * swallows its own errors); whether or not fal actually stops rendering,
 * this job's result is discarded from the UI's perspective the moment
 * status flips to 'cancelled' — job-webhook/process-jobs both check
 * `status='running'` before finalizing, so a job cancelled here can no
 * longer be completed by a late webhook/poll even if fal renders it anyway.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { cancelQueueJob } from "../_shared/fal.service.ts";

type CancelBody = { job_id: string };

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const adminClient = createAdminClient();

    const body = await parseJsonBody<CancelBody>(req);
    const jobId = String(body.job_id || "").trim();
    if (!jobId) throw createHttpError("job_id is required", 400);

    const { data: job, error: fetchError } = await adminClient
      .from("background_jobs")
      .select("id, user_id, status, payload")
      .eq("id", jobId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!job) throw createHttpError("Job not found", 404);
    if (job.user_id !== user.id) throw createHttpError("Forbidden", 403);

    if (job.status !== "queued" && job.status !== "running") {
      return jsonResponse({ ok: true, status: job.status, reason: "already terminal" });
    }

    const payload = (job.payload || {}) as Record<string, unknown>;
    const falCancelUrl = payload.fal_cancel_url as string | undefined;
    if (falCancelUrl) {
      await cancelQueueJob(falCancelUrl); // best-effort, errors swallowed internally
    }

    const { data: won } = await adminClient
      .from("background_jobs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", jobId)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();

    if (!won) {
      return jsonResponse({ ok: true, reason: "job finalized by webhook/poller before cancel could apply" });
    }

    const generationId = payload.generation_id as string | undefined;
    if (generationId) {
      await adminClient.from("generations").update({ status: "failed" }).eq("id", generationId);
    }

    const creditsReserved = Number(payload.credits_reserved || 0);
    if (creditsReserved > 0) {
      await adminClient.rpc("refund_credits", {
        p_user_id: user.id, p_amount: creditsReserved, p_category: "video",
        p_description: "Refund: video job cancelled by user",
      });
    }

    return jsonResponse({ ok: true, status: "cancelled" });
  } catch (error) {
    console.error("[cancel-video-job] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
