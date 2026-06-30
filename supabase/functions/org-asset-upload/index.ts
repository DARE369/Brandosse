import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";
import {
  createHttpError,
  ensureBrandProjectAccess,
  requireActiveOrgMember,
  resolveMemberPermissions,
} from "../_shared/org.ts";
import { ensureBucketExists } from "../_shared/storage.ts";

const ORG_ASSET_BUCKET = "org-assets";

function normalizeBoolean(value: FormDataEntryValue | null) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(normalized);
}

function normalizeTags(value: FormDataEntryValue | null) {
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

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sanitizeFolderPath(value: FormDataEntryValue | null) {
  const raw = String(value || "/").trim() || "/";
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  const compact = normalized.replace(/\/{2,}/g, "/");
  if (compact.length > 1 && compact.endsWith("/")) {
    return compact.slice(0, -1);
  }
  return compact;
}

function safeFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferFileType(file: File) {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("template")) return "template";
  if (mime.includes("json") || mime.includes("text/plain")) return "prompt_template";
  return "document";
}

function buildStoragePath(options: {
  organizationId: string;
  brandProjectId?: string | null;
  fileName: string;
}) {
  const safeName = safeFileName(options.fileName || "asset.bin") || `asset-${crypto.randomUUID()}`;
  const brandSegment = options.brandProjectId || "shared";
  return `${options.organizationId}/${brandSegment}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
}

async function resolveFolderAssignment(options: {
  adminClient: ReturnType<typeof createAdminClient>;
  organizationId: string;
  brandProjectId: string | null;
  folderId: string | null;
  folderPath: string;
  userId: string;
  roleKey: string | null;
}) {
  const {
    adminClient,
    organizationId,
    brandProjectId,
    folderId,
    folderPath,
    userId,
    roleKey,
  } = options;

  const canBypassPrivateFolderOwnerCheck = ["org_owner", "org_admin"].includes(String(roleKey || ""));

  if (folderId) {
    const { data: folder, error: folderError } = await adminClient
      .from("org_asset_folders")
      .select("id, organization_id, brand_project_id, folder_path, visibility, created_by")
      .eq("id", folderId)
      .maybeSingle();

    if (folderError && !String(folderError.message || "").toLowerCase().includes("does not exist")) {
      throw folderError;
    }

    if (!folder) {
      throw createHttpError("Selected folder not found.", 400);
    }

    if (folder.organization_id !== organizationId) {
      throw createHttpError("Selected folder does not belong to this organization.", 400);
    }

    if (folder.brand_project_id && folder.brand_project_id !== brandProjectId) {
      throw createHttpError("Selected folder does not match the active brand project.", 400);
    }

    if (
      folder.visibility === "private"
      && folder.created_by !== userId
      && !canBypassPrivateFolderOwnerCheck
    ) {
      throw createHttpError("You do not have access to that private folder.", 403);
    }

    return {
      folderId: folder.id,
      folderPath: sanitizeFolderPath(folder.folder_path),
    };
  }

  if (!folderPath || folderPath === "/") {
    return {
      folderId: null,
      folderPath: "/",
    };
  }

  let query = adminClient
    .from("org_asset_folders")
    .select("id, brand_project_id, folder_path, visibility, created_by")
    .eq("organization_id", organizationId)
    .eq("folder_path", folderPath);

  if (brandProjectId) {
    query = query.or(`brand_project_id.is.null,brand_project_id.eq.${brandProjectId}`);
  } else {
    query = query.is("brand_project_id", null);
  }

  const { data: folderMatches, error: folderLookupError } = await query;

  if (folderLookupError && !String(folderLookupError.message || "").toLowerCase().includes("does not exist")) {
    throw folderLookupError;
  }

  const visibleMatches = (folderMatches || []).filter((folder) => (
    folder.visibility === "team"
    || folder.created_by === userId
    || canBypassPrivateFolderOwnerCheck
  ));

  if (visibleMatches.length === 0) {
    return {
      folderId: null,
      folderPath,
    };
  }

  const exactBrandMatch = visibleMatches.find((folder) => folder.brand_project_id === brandProjectId);
  const resolved = exactBrandMatch || visibleMatches.find((folder) => folder.brand_project_id === null) || visibleMatches[0];

  return {
    folderId: resolved.id,
    folderPath: sanitizeFolderPath(resolved.folder_path),
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
    const adminClient = createAdminClient();
    const formData = await req.formData();

    const organizationId = String(formData.get("organization_id") || "").trim();
    const brandProjectId = String(formData.get("brand_project_id") || "").trim() || null;
    const description = String(formData.get("description") || "").trim() || null;
    const folderId = String(formData.get("folder_id") || "").trim() || null;
    const folderPath = sanitizeFolderPath(formData.get("folder_path"));
    const assetLevel = String(formData.get("asset_level") || "project").trim().toLowerCase();
    const isBrandAsset = normalizeBoolean(formData.get("is_brand_asset"));
    const file = formData.get("file");

    if (!organizationId) {
      throw createHttpError("Missing organization_id.", 400);
    }

    if (!(file instanceof File)) {
      throw createHttpError("Missing file upload.", 400);
    }

    const member = await requireActiveOrgMember(adminClient, organizationId, user.id);
    if (!ensureBrandProjectAccess(member, brandProjectId)) {
      throw createHttpError("You do not have access to that brand project.", 403);
    }
    const roleKey = member.org_role_key || member.role || null;

    const permissions = await resolveMemberPermissions(adminClient, organizationId, member);
    const canManageLibrary = Boolean(permissions.can_manage_library);
    const canApproveUploads = Boolean(permissions.can_approve_library_uploads) || canManageLibrary;

    if (!canManageLibrary) {
      throw createHttpError("You do not have permission to upload assets.", 403);
    }

    const resolvedFolder = await resolveFolderAssignment({
      adminClient,
      organizationId,
      brandProjectId,
      folderId,
      folderPath,
      userId: user.id,
      roleKey,
    });

    await ensureBucketExists(adminClient, ORG_ASSET_BUCKET, true);

    const storagePath = buildStoragePath({
      organizationId,
      brandProjectId,
      fileName: file.name,
    });

    const fileBytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await adminClient.storage
      .from(ORG_ASSET_BUCKET)
      .upload(storagePath, fileBytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
        cacheControl: "3600",
      });

    if (uploadError) {
      throw createHttpError(`Storage upload failed: ${uploadError.message}`, 500);
    }

    const { data: publicUrlData } = adminClient.storage.from(ORG_ASSET_BUCKET).getPublicUrl(storagePath);
    const approvalStatus = canApproveUploads ? "approved" : "pending";
    const timestamp = new Date().toISOString();

    const { data: inserted, error: insertError } = await adminClient
      .from("org_asset_library")
      .insert({
        organization_id: organizationId,
        brand_project_id: brandProjectId,
        asset_level: ["agency", "brand", "project"].includes(assetLevel) ? assetLevel : "project",
        uploaded_by: user.id,
        name: String(formData.get("name") || file.name || "Uploaded asset").trim(),
        description,
        file_url: publicUrlData.publicUrl,
        thumbnail_url: publicUrlData.publicUrl,
        file_type: inferFileType(file),
        mime_type: file.type || null,
        file_size_bytes: Number(file.size || 0),
        tags: normalizeTags(formData.get("tags")),
        folder_id: resolvedFolder.folderId,
        folder_path: resolvedFolder.folderPath,
        approval_status: approvalStatus,
        approved_by: canApproveUploads ? user.id : null,
        approved_at: canApproveUploads ? timestamp : null,
        is_brand_asset: isBrandAsset && canManageLibrary,
        metadata: {
          storage_bucket: ORG_ASSET_BUCKET,
          storage_path: storagePath,
          original_file_name: file.name,
          folder_id: resolvedFolder.folderId,
        },
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    return jsonResponse({
      asset: inserted,
      auto_approved: canApproveUploads,
      approval_status: approvalStatus,
    });
  } catch (error) {
    console.error("[org-asset-upload] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
