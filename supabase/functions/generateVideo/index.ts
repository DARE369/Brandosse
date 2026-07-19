/**
 * generateVideo edge function — SUBMIT-AND-RETURN (Week 3 Fix 3)
 *
 * Previously this function awaited fal.ai's queue internally (submit + poll
 * to completion) before ever responding — a synchronous await dressed up as
 * a background job: refresh/tab-close abandoned the outcome, Cancel was
 * fake, and the "keeps processing in the background" UI copy was untrue.
 *
 * Now: validate, rate-limit, resolve tier, reserve credits atomically
 * (deduct-at-submit; refunded automatically by job-webhook/process-jobs on
 * a terminal failure — see _shared/generationIdempotency.ts refund
 * pattern), create a `generations` row with status 'processing' (fixing the
 * video-only inconsistency where rows were born 'completed'), create a
 * `background_jobs` row, submit to fal.ai's ASYNC queue with a webhook URL,
 * and return the job id immediately. Completion is observed by
 * job-webhook (fal's own webhook, preferred) or process-jobs (a pg_cron
 * poller, fallback for dropped webhooks) — never by this function.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  submitVideoHailuo, submitVideoKling, submitVideoKlingI2V,
  FAL_COST_USD, type FalVideoAspect, type FalVideoDuration,
} from "../_shared/fal.service.ts";
import { callPromptEngine } from "../_shared/llm.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { reserveCredits } from "../_shared/generationIdempotency.ts";
import { readEnv } from "../_shared/env.ts";

const CREDITS_STD_VIDEO = 5;
const CREDITS_PRO_VIDEO = 15;

type GenerateVideoBody = {
  prompt: string;
  quality?: "standard" | "premium";
  image_url?: string;
  duration?: FalVideoDuration;
  aspect_ratio?: FalVideoAspect;
  brandKit?: Record<string, unknown>;
  enhance_prompt?: boolean;
  session_id?: string;
  /** Client-generated attempt id — resubmitting the same attempt (e.g. a
   * network-level double-invoke) returns the existing job instead of
   * submitting a second one to fal.ai / billing twice. */
  request_id?: string;
};

function buildBrandContext(brandKit: Record<string, unknown> | undefined): string {
  if (!brandKit) return "";
  const raw = (typeof brandKit.raw === "object" && brandKit.raw !== null)
    ? brandKit.raw as Record<string, unknown> : brandKit;
  return [
    raw.brand_name ? `Brand: ${raw.brand_name}` : "",
    Array.isArray(raw.visual_style_keywords)
      ? `Visual style: ${(raw.visual_style_keywords as string[]).join(", ")}` : "",
  ].filter(Boolean).join(". ");
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authClient  = createAuthClient(req.headers.get("Authorization"));
    const user        = await requireUser(authClient);
    const adminClient = createAdminClient();
    await enforceRateLimit(adminClient, user.id, "generateVideo");

    const body      = await parseJsonBody<GenerateVideoBody>(req);
    const rawPrompt = (body.prompt ?? "").trim();
    if (!rawPrompt) throw createHttpError("prompt is required", 400);

    const requestId = body.request_id || null;

    // ── Idempotency: a resubmit of the same attempt returns the existing job ──
    if (requestId) {
      const { data: existingJob } = await adminClient
        .from("background_jobs")
        .select("id, status, payload, result")
        .eq("job_type", "video_generation")
        .eq("request_id", requestId)
        .maybeSingle();
      if (existingJob) {
        return jsonResponse({
          job_id: existingJob.id,
          status: existingJob.status,
          generation_id: (existingJob.payload as Record<string, unknown>)?.generation_id ?? null,
          replayed: true,
        });
      }
    }

    const requestedQuality = body.quality === "premium" ? "premium" : "standard";
    const isI2V        = Boolean(body.image_url);

    // Hailuo 2.3 (the "standard" tier engine) is image-to-video only — see
    // original header comment history in FIXLOG Week 3 for the tier-upgrade
    // rationale, unchanged by this rework.
    const tierUpgraded = requestedQuality === "standard" && !isI2V;
    const quality = tierUpgraded ? "premium" : requestedQuality;
    const creditsNeeded = quality === "premium" ? CREDITS_PRO_VIDEO : CREDITS_STD_VIDEO;

    // ── Reserve credits BEFORE submitting to fal.ai (deduct-at-submit).
    // Chosen over deduct-at-completion because deduct-at-submit prevents a
    // user from queueing unlimited jobs beyond their balance while jobs are
    // in flight; refunded automatically on any terminal failure (see
    // job-webhook / process-jobs). ────────────────────────────────────────
    await reserveCredits(
      adminClient, user.id, creditsNeeded,
      "video", `Video generation (${quality})${tierUpgraded ? " [tier-upgraded from standard]" : ""}`,
    );
    let creditsReserved = true;
    const refund = async (reason: string) => {
      if (!creditsReserved) return;
      creditsReserved = false;
      try {
        await adminClient.rpc("refund_credits", {
          p_user_id: user.id, p_amount: creditsNeeded, p_category: "video",
          p_description: `Refund: ${reason}`,
        });
      } catch (refundErr) {
        console.error("[generateVideo] refund failed:", refundErr);
      }
    };

    // ── Prompt enhancement — Claude Haiku ─────────────────────────────────────
    let finalPrompt = rawPrompt;
    if (body.enhance_prompt !== false) {
      try {
        const brandCtx = buildBrandContext(body.brandKit);
        finalPrompt = await callPromptEngine({
          systemPrompt: `You are an expert AI video generation prompt engineer.
Rewrite the prompt for ${quality === "premium" ? "Kling 2.5 Pro (cinematic quality)" : "Hailuo 2.3 (fluid 1080p)"}.
Rules:
- Describe motion, camera movement, and scene progression clearly
- Keep brand aesthetic consistent${isI2V ? "\n- The video starts from a reference image — describe how the scene should evolve" : ""}
- Add cinematography language: shot type, camera movement, lighting, pacing
- Max 150 words
- Return ONLY the enhanced prompt`,
          userPrompt: `Prompt: "${rawPrompt}"${brandCtx ? `\nBrand: ${brandCtx}` : ""}`,
          maxTokens: 200,
        });
      } catch (_) {
        finalPrompt = rawPrompt;
      }
    }

    const duration     = body.duration     ?? "5";
    const aspect_ratio = body.aspect_ratio ?? "16:9";
    const costUsd = quality === "premium"
      ? FAL_COST_USD.videoKlingPerSec * Number(duration)
      : FAL_COST_USD.videoHailouPerClip;

    // ── generations row: born 'processing' now (was 'completed' — the
    // video-only inconsistency this rework fixes), so Fix 1's
    // ensure_draft_post_for_generation trigger correctly waits for the real
    // completion (job-webhook/process-jobs UPDATE it to 'completed') before
    // creating a draft post, exactly like every other media type. ──────────
    const { data: generation, error: genInsertError } = await adminClient
      .from("generations")
      .insert({
        user_id:      user.id,
        session_id:   body.session_id ?? null,
        request_id:   requestId,
        request_slot: 0,
        prompt:       rawPrompt,
        enhanced_prompt: finalPrompt !== rawPrompt ? finalPrompt : null,
        media_type:   "video",
        status:       "processing",
        provider:     "fal-ai",
        metadata: {
          quality, requested_quality: requestedQuality, tier_upgraded: tierUpgraded,
          duration, is_image_to_video: isI2V, cost_usd: costUsd,
        },
      })
      .select("id")
      .single();
    if (genInsertError) {
      await refund("failed to record generation");
      throw new Error(`Failed to record generation: ${genInsertError.message}`);
    }

    // ── background_jobs row (queued) — created before the fal submit call
    // so a webhook that somehow arrives before this function returns still
    // has a row to find. ───────────────────────────────────────────────────
    const { data: job, error: jobInsertError } = await adminClient
      .from("background_jobs")
      .insert({
        user_id:   user.id,
        job_type:  "video_generation",
        status:    "queued",
        request_id: requestId,
        payload: {
          generation_id: generation.id,
          quality, is_image_to_video: isI2V, duration, aspect_ratio,
          credits_reserved: creditsNeeded, category: "video",
        },
      })
      .select("id")
      .single();
    if (jobInsertError) {
      await refund("failed to create job record");
      await adminClient.from("generations").update({ status: "failed" }).eq("id", generation.id);
      throw new Error(`Failed to create background job: ${jobInsertError.message}`);
    }

    // ── Submit to fal.ai's async queue with a webhook ─────────────────────────
    const webhookToken = crypto.randomUUID();
    const supabaseUrl  = readEnv("SUPABASE_URL");
    const webhookUrl   = `${supabaseUrl}/functions/v1/job-webhook?job_id=${job.id}&token=${webhookToken}`;

    try {
      const submitFn = quality === "premium"
        ? (isI2V ? submitVideoKlingI2V : submitVideoKling)
        : submitVideoHailuo;

      const { falRequestId, modelId, statusUrl, responseUrl, cancelUrl } = await submitFn(
        { prompt: finalPrompt, image_url: body.image_url, duration, aspect_ratio } as never,
        webhookUrl,
      );

      // Best-effort — fal has already accepted the job at this point (the
      // webhook will fire and process-jobs' fallback sweep matches on
      // request_id/job id regardless of whether this specific write lands),
      // so a failure here must not turn a successful submission into an
      // error response to the client.
      try {
        await adminClient
          .from("background_jobs")
          .update({
            status: "running",
            started_at: new Date().toISOString(),
            payload: {
              generation_id: generation.id,
              quality, is_image_to_video: isI2V, duration, aspect_ratio,
              credits_reserved: creditsNeeded, category: "video",
              // fal_model_id kept for display/debugging only — fal.ai's
              // status/response/cancel endpoints are NOT reliably
              // reconstructable from it (confirmed live 2026-07-12: models
              // with a version/tier suffix, e.g. kling-video/v2.5/pro, use a
              // different base path for these endpoints than for submit).
              // status_url/response_url/cancel_url are fal.ai's own,
              // authoritative URLs from the submit response — always use
              // those instead.
              fal_request_id: falRequestId, fal_model_id: modelId,
              fal_status_url: statusUrl, fal_response_url: responseUrl, fal_cancel_url: cancelUrl,
              webhook_token: webhookToken,
            },
          })
          .eq("id", job.id);
      } catch (writeErr) {
        console.error("[generateVideo] non-fatal: failed to write 'running' status:", writeErr);
      }
    } catch (submitErr) {
      await refund("fal.ai rejected the submission");
      await adminClient.from("background_jobs").update({
        status: "failed", error: submitErr instanceof Error ? submitErr.message : String(submitErr),
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);
      await adminClient.from("generations").update({ status: "failed" }).eq("id", generation.id);
      throw submitErr;
    }

    return jsonResponse({
      job_id: job.id,
      generation_id: generation.id,
      status: "running",
      quality,
      requested_quality: requestedQuality,
      tier_upgraded: tierUpgraded,
      tier_upgrade_reason: tierUpgraded
        ? "Standard tier requires a source image for image-to-video; this request had none, so it renders (and is billed) at premium quality instead."
        : null,
      credits_used: creditsNeeded,
    });

  } catch (error) {
    console.error("[generateVideo] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
