// personal-asset-duplicate — clones a personal_assets row + its underlying
// storage object. Modeled on personal-asset-upload/index.ts's trusted-insert
// pattern (row write happens server-side, never from the client). The
// duplicate is byte-identical to the source, so ai_tags/ai_tagging_status
// are copied rather than re-run — there's nothing new for the tagger to see.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";

const PERSONAL_ASSET_BUCKET = "personal-assets";

function buildDuplicateStoragePath(userId: string, sourcePath: string): string {
  const fileName = sourcePath.split("/").pop() || `asset-${crypto.randomUUID()}.bin`;
  return `${userId}/uploads/${Date.now()}-${crypto.randomUUID()}-${fileName}`;
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
    const adminClient = createAdminClient();

    const body = await req.json().catch(() => ({}));
    const assetId = String(body?.asset_id || "").trim();
    if (!assetId) throw createHttpError("Missing asset_id.", 400);

    const { data: source, error: sourceError } = await adminClient
      .from("personal_assets")
      .select("*")
      .eq("id", assetId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sourceError) throw sourceError;
    if (!source) throw createHttpError("Asset not found.", 404);

    const newStoragePath = buildDuplicateStoragePath(user.id, source.storage_path);

    const { error: copyError } = await adminClient.storage
      .from(source.storage_bucket || PERSONAL_ASSET_BUCKET)
      .copy(source.storage_path, newStoragePath);

    if (copyError) {
      throw createHttpError(`Storage copy failed: ${copyError.message}`, 500);
    }

    const { data: publicUrlData } = adminClient.storage
      .from(source.storage_bucket || PERSONAL_ASSET_BUCKET)
      .getPublicUrl(newStoragePath);

    const { data: inserted, error: insertError } = await adminClient
      .from("personal_assets")
      .insert({
        user_id: user.id,
        organization_id: source.organization_id,
        source: source.source,
        generation_id: source.generation_id,
        post_id: null,
        title: source.title ? `${source.title} (copy)` : "Untitled (copy)",
        description: source.description,
        alt_text: source.alt_text,
        tags: source.tags || [],
        ai_tags: source.ai_tags || [],
        ai_tagging_status: source.ai_tagging_status,
        media_type: source.media_type,
        mime_type: source.mime_type,
        file_size_bytes: source.file_size_bytes,
        storage_bucket: source.storage_bucket || PERSONAL_ASSET_BUCKET,
        storage_path: newStoragePath,
        file_url: publicUrlData.publicUrl,
        thumbnail_url: source.media_type === "image" ? publicUrlData.publicUrl : source.thumbnail_url,
        checksum: source.checksum,
        perceptual_hash: source.perceptual_hash,
        status: "active",
        used_in_post_ids: [],
        metadata: { ...(source.metadata || {}), duplicated_from: source.id },
      })
      .select("*")
      .single();

    if (insertError) throw insertError;

    return jsonResponse({ asset: inserted });
  } catch (error) {
    console.error("[personal-asset-duplicate] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
