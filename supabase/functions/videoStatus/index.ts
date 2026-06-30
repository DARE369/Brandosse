import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  extractFirstGeneratedUrl,
  extractProgress,
  getVideoTaskStatus,
  normalizeTaskStatus,
  PROVIDER_NAME,
  type MagnificTaskData,
} from "../_shared/magnific.service.ts";
import { buildGeneratedAssetPath, ensureBucketExists, uploadFromRemoteUrl } from "../_shared/storage.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

const GENERATED_BUCKET = "generated_assets";

type VideoStatusBody = {
  jobId?: string;
  generationId?: string;
  providerEndpoint?: string;
};

function metadataWithJob(existing: unknown, task: MagnificTaskData, jobId: string, providerEndpoint?: string | null): Record<string, unknown> {
  const base = (typeof existing === "object" && existing !== null)
    ? existing as Record<string, unknown>
    : {};

  return {
    ...base,
    provider: PROVIDER_NAME,
    provider_task_id: jobId,
    provider_endpoint: providerEndpoint || base.provider_endpoint || null,
    provider_status: task.status ?? null,
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const supabaseAdmin = createAdminClient();

    const body = await parseJsonBody<VideoStatusBody>(req);
    const jobId = (body.jobId || "").trim();
    const generationId = (body.generationId || "").trim();

    if (!jobId) {
      return jsonResponse({ error: "Missing jobId" }, 400);
    }

    let generationRow: {
      id: string;
      user_id: string;
      storage_path: string | null;
      metadata: unknown;
    } | null = null;

    if (generationId) {
      const { data: directRow } = await supabaseAdmin
        .from("generations")
        .select("id, user_id, storage_path, metadata")
        .eq("id", generationId)
        .eq("user_id", user.id)
        .maybeSingle();
      generationRow = directRow as typeof generationRow;
    }

    if (!generationRow) {
      const { data: byJobRows } = await supabaseAdmin
        .from("generations")
        .select("id, user_id, storage_path, metadata")
        .eq("user_id", user.id)
        .contains("metadata", { provider_task_id: jobId })
        .limit(1);
      generationRow = byJobRows?.[0] ?? null;
    }

    if (generationRow?.storage_path) {
      return jsonResponse({
        status: "completed",
        progress: 100,
        videoUrl: generationRow.storage_path,
        jobId,
      });
    }

    const metadata = (generationRow?.metadata && typeof generationRow.metadata === "object")
      ? generationRow.metadata as Record<string, unknown>
      : {};
    const providerEndpoint = String(body.providerEndpoint || metadata.provider_endpoint || "").trim() || null;
    const task = await getVideoTaskStatus(jobId, providerEndpoint);
    const normalizedStatus = normalizeTaskStatus(task.status);
    const progress = extractProgress(task) ?? 60;

    if (normalizedStatus === "queued" || normalizedStatus === "processing") {
      if (generationRow?.id) {
        await supabaseAdmin
          .from("generations")
          .update({
            status: "processing",
            progress,
            metadata: metadataWithJob(generationRow.metadata, task, jobId, providerEndpoint),
            updated_at: new Date().toISOString(),
          })
          .eq("id", generationRow.id);
      }

      return jsonResponse({
        status: normalizedStatus,
        progress,
        jobId,
      });
    }

    if (normalizedStatus === "failed") {
      if (generationRow?.id) {
        await supabaseAdmin
          .from("generations")
          .update({
            status: "failed",
            progress: 100,
            metadata: {
              ...metadataWithJob(generationRow.metadata, task, jobId),
              provider_endpoint: providerEndpoint,
              error_message: task.error || task.message || "Video generation failed",
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", generationRow.id);
      }

      return jsonResponse({
        status: "failed",
        progress: 100,
        jobId,
        error: task.error || task.message || "Video generation failed",
      });
    }

    const providerUrl = extractFirstGeneratedUrl(task);
    if (!providerUrl) {
      throw new Error("Video finished but the media provider returned no URL");
    }

    await ensureBucketExists(supabaseAdmin, GENERATED_BUCKET, true);
    const objectPath = buildGeneratedAssetPath(user.id, "videos", providerUrl, "video/mp4");
    const uploaded = await uploadFromRemoteUrl({
      supabaseAdmin,
      bucket: GENERATED_BUCKET,
      objectPath,
      sourceUrl: providerUrl,
      fallbackContentType: "video/mp4",
    });

    if (generationRow?.id) {
      await supabaseAdmin
        .from("generations")
        .update({
          status: "completed",
          progress: 100,
          storage_path: uploaded.publicUrl,
          metadata: {
            ...metadataWithJob(generationRow.metadata, task, jobId, providerEndpoint),
            source_video_url: providerUrl,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", generationRow.id);
    }

    return jsonResponse({
      status: "completed",
      progress: 100,
      videoUrl: uploaded.publicUrl,
      jobId,
    });
  } catch (error) {
    console.error("[videoStatus] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
