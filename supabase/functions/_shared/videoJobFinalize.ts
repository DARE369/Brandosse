import type { DatabaseClient } from "./supabase.ts";
import { getQueueStatus, getQueueResult, type FalVideoResult } from "./fal.service.ts";

const GENERATED_BUCKET = "generated_assets";

export type BackgroundJobRow = {
  id: string;
  user_id: string;
  status: string;
  payload: Record<string, unknown>;
  request_id: string | null;
  attempts: number;
};

/**
 * Shared by job-webhook (fal's webhook, preferred) and process-jobs (pg_cron
 * fallback poller) — both need to observe fal.ai completion and finalize a
 * background_jobs/generations pair identically. Living in one module means
 * there is exactly one "how do we know a video job is done and record it"
 * implementation, not two that could drift.
 *
 * finalizeCompleted/finalizeFailed each perform the terminal status write as
 * a SINGLE conditional UPDATE guarded by WHERE status='running' (mirroring
 * process_scheduled_posts()'s claim pattern — see
 * audit-brief/07-structural-findings.md 0.3) and return whether THIS caller
 * won that race. Only the winner performs the generation-row update and (for
 * failures) the credit refund — the loser's earlier fal-result fetch/storage
 * upload is wasted work on a race but never double-writes application state.
 */
export async function finalizeCompleted(adminClient: DatabaseClient, job: BackgroundJobRow, falResult: FalVideoResult): Promise<boolean> {
  const generationId = job.payload.generation_id as string | undefined;
  const videoUrl = falResult?.video?.url;
  if (!videoUrl) throw new Error("fal.ai result had no video URL");

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error("Failed to fetch generated video from fal.ai");
  const videoBlob = await videoRes.blob();

  const fileName = `${job.user_id}/${Date.now()}_${String(job.payload.fal_model_id || "video").replace(/\//g, "-")}.mp4`;
  const { error: uploadError } = await adminClient.storage
    .from(GENERATED_BUCKET)
    .upload(fileName, videoBlob, { contentType: "video/mp4", upsert: true });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: { publicUrl } } = adminClient.storage.from(GENERATED_BUCKET).getPublicUrl(fileName);

  const { data: won } = await adminClient
    .from("background_jobs")
    .update({
      status: "completed",
      result: { video_url: publicUrl, storage_path: fileName },
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "running")
    .select("id")
    .maybeSingle();

  if (!won) return false;

  if (generationId) {
    await adminClient
      .from("generations")
      .update({ status: "completed", output_url: publicUrl, storage_path: publicUrl })
      .eq("id", generationId);
  }
  return true;
}

export async function finalizeFailed(adminClient: DatabaseClient, job: BackgroundJobRow, errorMessage: string): Promise<boolean> {
  const { data: won } = await adminClient
    .from("background_jobs")
    .update({ status: "failed", error: errorMessage, finished_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "running")
    .select("id")
    .maybeSingle();

  if (!won) return false;

  const generationId = job.payload.generation_id as string | undefined;
  const creditsReserved = Number(job.payload.credits_reserved || 0);

  if (generationId) {
    await adminClient.from("generations").update({ status: "failed" }).eq("id", generationId);
  }

  if (creditsReserved > 0) {
    try {
      await adminClient.rpc("refund_credits", {
        p_user_id: job.user_id, p_amount: creditsReserved, p_category: "video",
        p_description: `Refund: video job failed — ${errorMessage}`.slice(0, 250),
      });
    } catch (refundErr) {
      console.error("[videoJobFinalize] refund failed:", refundErr);
    }
  }
  return true;
}

/**
 * fal.ai's actual webhook POST body (confirmed against fal.ai's own docs,
 * 2026-07-12 — see FIXLOG): { request_id, status: "OK"|"ERROR", payload,
 * payload_error? }. `payload` IS the model's real output already (e.g.
 * `{ video: { url, ... } }` for video models) — no separate fetch needed.
 *
 * This is the PREFERRED completion path, not just a fallback: live testing
 * found fal.ai's GET-based "fetch result" endpoint
 * (queue.fal.run/{app}/requests/{id}, no suffix) genuinely broken for at
 * least one real model in this app (fal-ai/kling-video/v2.5/pro) — it
 * 404s with "Path /v2.5/pro not found" regardless of whether the base app
 * id or the full model id is used, seemingly a fal.ai-side routing quirk
 * for multi-segment endpoint ids. The webhook body sidesteps this
 * entirely since fal.ai pushes the payload directly, no GET required.
 * reconcileJob (GET-based) remains as the fallback for process-jobs (which
 * has no webhook body to work from) and for any webhook delivery whose
 * body doesn't match this expected shape.
 */
export async function finalizeFromWebhookPayload(
  adminClient: DatabaseClient,
  job: BackgroundJobRow,
  webhookBody: { status?: string; payload?: unknown; payload_error?: string } | null,
): Promise<{ status: string; won?: boolean } | null> {
  if (!webhookBody || typeof webhookBody.status !== "string") return null;

  if (webhookBody.status === "OK" && webhookBody.payload && typeof webhookBody.payload === "object") {
    const won = await finalizeCompleted(adminClient, job, webhookBody.payload as FalVideoResult);
    return { status: "completed", won };
  }

  if (webhookBody.status === "ERROR") {
    const won = await finalizeFailed(adminClient, job, webhookBody.payload_error || "fal.ai reported ERROR via webhook");
    return { status: "failed", won };
  }

  return null; // Unexpected shape — let the caller fall back to reconcileJob.
}

/** One reconciliation step against fal.ai's authoritative status for a
 * single running job — used by both job-webhook (triggered by fal) and
 * process-jobs (triggered by pg_cron sweeping stale 'running' rows). */
export async function reconcileJob(adminClient: DatabaseClient, job: BackgroundJobRow): Promise<{ status: string; won?: boolean }> {
  // fal_status_url/fal_response_url are fal.ai's OWN URLs from the submit
  // response (see _shared/fal.service.ts submitVideoJob) — required, not
  // reconstructed from fal_model_id (confirmed live 2026-07-12 that
  // reconstruction is unreliable for models with a version/tier suffix).
  const statusUrl   = job.payload.fal_status_url as string | undefined;
  const responseUrl = job.payload.fal_response_url as string | undefined;
  if (!statusUrl || !responseUrl) return { status: "missing_fal_urls" };

  const status = await getQueueStatus(statusUrl);

  if (status.status === "COMPLETED") {
    const result = await getQueueResult<FalVideoResult>(responseUrl);
    const won = await finalizeCompleted(adminClient, job, result);
    return { status: "completed", won };
  }
  if (status.status === "FAILED") {
    const won = await finalizeFailed(adminClient, job, status.error || "fal.ai reported FAILED");
    return { status: "failed", won };
  }
  return { status: status.status };
}
