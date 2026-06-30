import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createImageEditTask,
  extractFirstGeneratedUrl,
  getImageEditTaskStatus,
  mergeBrandKitIntoPrompt,
  normalizeTaskStatus,
  PROVIDER_NAME,
  waitForTaskCompletion,
} from "../_shared/magnific.service.ts";
import { buildGeneratedAssetPath, ensureBucketExists, uploadFromRemoteUrl } from "../_shared/storage.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

const GENERATED_BUCKET = "generated_assets";

type EditImageBody = {
  prompt?: string;
  brandKit?: Record<string, unknown>;
  sourceImageUrl?: string;
  aspectRatio?: string;
  providerOptions?: Record<string, unknown>;
};

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);

    const body = await parseJsonBody<EditImageBody>(req);
    const prompt = (body.prompt || "").trim();
    const sourceImageUrl = (body.sourceImageUrl || "").trim();

    if (!prompt) {
      return jsonResponse({ error: "Missing prompt" }, 400);
    }

    if (!sourceImageUrl) {
      return jsonResponse({ error: "Missing sourceImageUrl for edit mode" }, 400);
    }

    const mergedPrompt = mergeBrandKitIntoPrompt(prompt, body.brandKit);
    const startedAt = Date.now();
    const createdTask = await createImageEditTask({
      prompt: mergedPrompt,
      sourceImageUrl,
      aspectRatio: body.aspectRatio,
      providerOptions: body.providerOptions,
    });

    const taskId = createdTask.task_id;
    if (!taskId) {
      throw new Error("Media provider did not return a task id for image edit");
    }

    const finalTask = await waitForTaskCompletion({
      taskId,
      poll: getImageEditTaskStatus,
      timeoutMs: 300_000,
      intervalMs: 3_000,
    });

    const finalStatus = normalizeTaskStatus(finalTask.status);
    if (finalStatus !== "completed") {
      const reason = finalTask.error || finalTask.message || `Image edit ended with status "${finalTask.status}"`;
      throw new Error(reason);
    }

    const providerUrl = extractFirstGeneratedUrl(finalTask);
    if (!providerUrl) {
      throw new Error("Media provider returned no edited image URL");
    }

    const supabaseAdmin = createAdminClient();
    await ensureBucketExists(supabaseAdmin, GENERATED_BUCKET, true);

    const storagePath = buildGeneratedAssetPath(user.id, "images", providerUrl, "image/jpeg");
    const uploaded = await uploadFromRemoteUrl({
      supabaseAdmin,
      bucket: GENERATED_BUCKET,
      objectPath: storagePath,
      sourceUrl: providerUrl,
      fallbackContentType: "image/jpeg",
    });

    return jsonResponse({
      publicUrl: uploaded.publicUrl,
      storagePath: uploaded.storagePath,
      taskId,
      status: "completed",
      provider: PROVIDER_NAME,
      providerTaskId: taskId,
      providerModel: "seedream-v4-5-edit",
      providerEndpoint: "/v1/ai/text-to-image/seedream-v4-5-edit",
      generationTimeMs: Date.now() - startedAt,
      prompt: mergedPrompt,
    });
  } catch (error) {
    console.error("[editImage] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
