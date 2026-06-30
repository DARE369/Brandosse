// personal-asset-upload — server-side-validated upload for the Personal
// Content Library (LIBRARY_SPEC.md §5/§10). Modeled directly on
// supabase/functions/org-asset-upload/index.ts's shape (FormData in,
// server-side MIME/size inference, admin-client storage write, then the
// row insert happens inside this trusted function) — per RESEARCH.md §1.3's
// explicit recommendation, and per
// docs/calendar-library-rebuild/packet-2-personal-library/DECISIONS_LOG.md.
//
// Deliberately thinner than org-asset-upload: no folder resolution, no
// approval-substate logic (LIBRARY_SPEC.md §3 — personal has neither), no
// org membership/permission check (personal upload is "always allowed" per
// spec §9). Writes to public.personal_assets (source='upload'), never to
// content_library_items/media_assets/org_asset_library.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { ensureBucketExists } from "../_shared/storage.ts";

const PERSONAL_ASSET_BUCKET = "personal-assets";

// Mime allowlist — server-side, not just an <input accept> hint (the gap
// AS_IS_AUDIT.md/RESEARCH.md flagged in today's uploadMediaAsset()).
const ALLOWED_MIME_PREFIXES = ["image/", "video/"];
const ALLOWED_EXACT_MIME = new Set([
  "application/pdf",
]);
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB — matches the dropzone hint in the approved mockup.

function normalizeTags(value: FormDataEntryValue | null): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
    }
  } catch (_error) {
    // Fall through to CSV parsing.
  }
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function safeFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isMimeAllowed(mime: string): boolean {
  const normalized = mime.toLowerCase();
  if (ALLOWED_EXACT_MIME.has(normalized)) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function inferMediaType(mime: string): "image" | "video" | "document" {
  const normalized = mime.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  return "document";
}

function buildStoragePath(userId: string, fileName: string): string {
  const safeName = safeFileName(fileName || "asset.bin") || `asset-${crypto.randomUUID()}`;
  return `${userId}/uploads/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
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
    const formData = await req.formData();

    const file = formData.get("file");
    const title = String(formData.get("title") || "").trim() || null;
    const description = String(formData.get("description") || "").trim() || null;
    const altText = String(formData.get("alt_text") || "").trim() || null;
    const tags = normalizeTags(formData.get("tags"));
    const checksum = String(formData.get("checksum") || "").trim() || null;
    const perceptualHash = String(formData.get("perceptual_hash") || "").trim() || null;

    if (!(file instanceof File)) {
      throw createHttpError("Missing file upload.", 400);
    }

    const mime = String(file.type || "").toLowerCase();
    if (!mime || !isMimeAllowed(mime)) {
      throw createHttpError(
        `File type "${mime || "unknown"}" isn't supported yet — try an image, video, or PDF instead.`,
        400,
      );
    }

    if (Number(file.size || 0) > MAX_FILE_SIZE_BYTES) {
      throw createHttpError("File is larger than the 50MB limit for a single asset.", 400);
    }

    // Non-blocking duplicate check (LIBRARY_SPEC.md §5 step 2 — surfaced to
    // the client as a warning, never blocks the upload itself). Exact-match
    // first (cheap, indexed), then a perceptual-hash Hamming-distance scan
    // for image files only, per RESEARCH.md §2.4's two-tier recommendation.
    let duplicateOf: { id: string; title: string | null } | null = null;

    // Phase 4 QA fix (DECISIONS_LOG.md — version-link flakiness, QA item 5):
    // both queries below now add `.is("superseded_by_asset_id", null)` and
    // `.order("created_at", { ascending: false })`. Without these, an
    // unordered `.limit(1).maybeSingle()` (exact-match) or an unordered
    // `.limit(200)` scan (perceptual-hash) could return ANY row sharing the
    // checksum/hash — including a row that had already been superseded by
    // an earlier "mark as new version" action — as `duplicateOf`. Live-
    // reproduced: re-uploading the same file 3 times in a row, each time
    // confirming "this is a new version," produced a real PATCH each time
    // (not a silently-failed write, the original suspicion) but the
    // SECOND and THIRD PATCHes both targeted the SAME already-superseded
    // ancestor row instead of the row created by the previous upload —
    // confirmed via direct network trace showing the literal duplicate-of
    // id repeat across attempts. The actual most-recent upload in each
    // case was left orphaned (never superseded by anything, never marked
    // current), which is exactly the "superseded rows still visible
    // alongside their replacement" / "version chain doesn't behave as
    // promised" symptom QA observed from the UI side. Ordering by most
    // recent and excluding already-superseded rows makes duplicate
    // detection always point at the current head of a version chain.
    if (checksum) {
      const { data: exactMatch } = await adminClient
        .from("personal_assets")
        .select("id, title")
        .eq("user_id", user.id)
        .eq("checksum", checksum)
        .eq("status", "active")
        .is("superseded_by_asset_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (exactMatch) duplicateOf = exactMatch;
    }

    if (!duplicateOf && perceptualHash && inferMediaType(mime) === "image") {
      const { data: candidates } = await adminClient
        .from("personal_assets")
        .select("id, title, perceptual_hash")
        .eq("user_id", user.id)
        .eq("status", "active")
        .is("superseded_by_asset_id", null)
        .not("perceptual_hash", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);

      const HAMMING_WARN_THRESHOLD = 5; // RESEARCH.md §2.2 — implementation detail, deferred there explicitly.
      for (const candidate of candidates || []) {
        if (!candidate.perceptual_hash || candidate.perceptual_hash.length !== perceptualHash.length) continue;
        let distance = 0;
        for (let i = 0; i < perceptualHash.length; i += 1) {
          if (candidate.perceptual_hash[i] !== perceptualHash[i]) distance += 1;
        }
        if (distance <= HAMMING_WARN_THRESHOLD) {
          duplicateOf = { id: candidate.id, title: candidate.title };
          break;
        }
      }
    }

    await ensureBucketExists(adminClient, PERSONAL_ASSET_BUCKET, true);

    const storagePath = buildStoragePath(user.id, file.name);
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await adminClient.storage
      .from(PERSONAL_ASSET_BUCKET)
      .upload(storagePath, fileBytes, {
        contentType: mime,
        upsert: false,
        cacheControl: "3600",
      });

    if (uploadError) {
      throw createHttpError(`Storage upload failed: ${uploadError.message}`, 500);
    }

    const { data: publicUrlData } = adminClient.storage.from(PERSONAL_ASSET_BUCKET).getPublicUrl(storagePath);
    const mediaType = inferMediaType(mime);

    const { data: inserted, error: insertError } = await adminClient
      .from("personal_assets")
      .insert({
        user_id: user.id,
        organization_id: null,
        source: "upload",
        generation_id: null,
        post_id: null,
        title: title || file.name,
        description,
        alt_text: altText,
        tags,
        ai_tags: [],
        ai_tagging_status: mediaType === "document" ? "not_applicable" : "pending",
        media_type: mediaType,
        mime_type: mime,
        file_size_bytes: Number(file.size || 0),
        storage_bucket: PERSONAL_ASSET_BUCKET,
        storage_path: storagePath,
        file_url: publicUrlData.publicUrl,
        thumbnail_url: mediaType === "image" ? publicUrlData.publicUrl : null,
        checksum,
        perceptual_hash: perceptualHash,
        status: "active",
        used_in_post_ids: [],
        metadata: {
          original_file_name: file.name,
        },
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    return jsonResponse({
      asset: inserted,
      duplicate_of: duplicateOf,
      ai_tagging_status: inserted.ai_tagging_status,
    });
  } catch (error) {
    console.error("[personal-asset-upload] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
