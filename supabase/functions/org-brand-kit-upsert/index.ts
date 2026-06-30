import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  createHttpError,
  ensureBrandProjectAccess,
  fetchBrandProject,
  normalizeOrgRole,
  requireActiveOrgMember,
} from "../_shared/org.ts";

type OrgBrandKitFields = Record<string, unknown>;

type UpsertRequest = {
  organization_id: string;
  brand_project_id: string;
  fields: OrgBrandKitFields;
};

const ARRAY_FIELDS = [
  "tone_descriptors",
  "content_pillars",
  "banned_phrases",
] as const;

const JSON_ARRAY_FIELDS = [
  "approved_hashtag_sets",
  "color_palette",
] as const;

const TEXT_FIELDS = [
  "brand_name",
  "tagline",
  "voice_description",
  "target_audience",
  "prompt_prefix",
  "prompt_guidelines",
  "typography_notes",
  "visual_style_notes",
  "primary_logo_asset_id",
  "secondary_logo_asset_id",
  "is_active",
] as const;

function sanitizeString(value: unknown) {
  return String(value ?? "").trim();
}

function sanitizeNullableString(value: unknown) {
  const normalized = sanitizeString(value);
  return normalized || null;
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function sanitizeApprovedHashtagSets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      name: sanitizeString((entry as Record<string, unknown>)?.name),
      platform: sanitizeString((entry as Record<string, unknown>)?.platform),
      hashtags: sanitizeStringArray((entry as Record<string, unknown>)?.hashtags),
    }))
    .filter((entry) => entry.name || entry.platform || entry.hashtags.length > 0);
}

function sanitizeColorPalette(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      name: sanitizeString((entry as Record<string, unknown>)?.name),
      hex: sanitizeString((entry as Record<string, unknown>)?.hex),
      role: sanitizeString((entry as Record<string, unknown>)?.role),
    }))
    .filter((entry) => entry.name || entry.hex || entry.role);
}

function sanitizeFields(fields: OrgBrandKitFields = {}) {
  const payload: Record<string, unknown> = {};

  TEXT_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) return;

    if (field === "is_active") {
      payload[field] = Boolean(fields[field]);
      return;
    }

    if (field === "primary_logo_asset_id" || field === "secondary_logo_asset_id") {
      payload[field] = sanitizeNullableString(fields[field]);
      return;
    }

    if (field === "brand_name") {
      payload[field] = sanitizeString(fields[field]);
      return;
    }

    payload[field] = sanitizeNullableString(fields[field]);
  });

  ARRAY_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(fields, field)) {
      payload[field] = sanitizeStringArray(fields[field]);
    }
  });

  if (Object.prototype.hasOwnProperty.call(fields, "approved_hashtag_sets")) {
    payload.approved_hashtag_sets = sanitizeApprovedHashtagSets(fields.approved_hashtag_sets);
  }

  if (Object.prototype.hasOwnProperty.call(fields, "color_palette")) {
    payload.color_palette = sanitizeColorPalette(fields.color_palette);
  }

  return payload;
}

function buildBrandSettingsMirror(existingSettings: Record<string, unknown>, fields: Record<string, unknown>) {
  const nextSettings = {
    ...(existingSettings && typeof existingSettings === "object" ? existingSettings : {}),
  } as Record<string, unknown>;

  [
    "brand_name",
    "voice_description",
    "tone_descriptors",
    "content_pillars",
    "target_audience",
    "prompt_prefix",
    "prompt_guidelines",
    "banned_phrases",
    "approved_hashtag_sets",
    "color_palette",
    "typography_notes",
    "visual_style_notes",
    "primary_logo_asset_id",
    "secondary_logo_asset_id",
    "tagline",
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      nextSettings[key] = fields[key];
    }
  });

  return nextSettings;
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
    const body = await parseJsonBody<UpsertRequest>(req);

    if (!body.organization_id || !body.brand_project_id || !body.fields || typeof body.fields !== "object") {
      throw createHttpError("Missing brand kit save details.", 400);
    }

    const member = await requireActiveOrgMember(adminClient, body.organization_id, user.id);
    if (!ensureBrandProjectAccess(member, body.brand_project_id)) {
      throw createHttpError("You do not have access to this brand project.", 403);
    }

    const role = normalizeOrgRole(member);
    const isAdmin = ["org_owner", "org_admin"].includes(role);
    const brandProject = await fetchBrandProject(adminClient, body.brand_project_id);
    if (brandProject.organization_id !== body.organization_id) {
      throw createHttpError("Brand project does not belong to this organization.", 400);
    }

    const { data: existingKit, error: existingError } = await adminClient
      .from("org_brand_kits")
      .select("id, organization_id, brand_project_id, brand_name")
      .eq("brand_project_id", body.brand_project_id)
      .maybeSingle();

    if (existingError) throw existingError;

    if (!isAdmin) {
      if (!existingKit?.id) {
        throw createHttpError("Only organization admins can create the first brand kit record.", 403);
      }

      const { data: editorRow, error: editorError } = await adminClient
        .from("org_brand_kit_editors")
        .select("id")
        .eq("brand_kit_id", existingKit.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (editorError) throw editorError;
      if (!editorRow?.id) {
        throw createHttpError("You do not have permission to edit this brand kit.", 403);
      }
    }

    const sanitizedFields = sanitizeFields(body.fields);
    const brandName = String(sanitizedFields.brand_name || existingKit?.brand_name || brandProject.name || "").trim();
    if (!brandName) {
      throw createHttpError("Brand name is required.", 400);
    }

    const payload = {
      organization_id: body.organization_id,
      brand_project_id: body.brand_project_id,
      brand_name: brandName,
      ...sanitizedFields,
      last_edited_by: user.id,
    };

    const { data: savedKit, error: saveError } = await adminClient
      .from("org_brand_kits")
      .upsert(payload, {
        onConflict: "brand_project_id",
      })
      .select("*")
      .single();

    if (saveError) throw saveError;

    const nextBrandSettings = buildBrandSettingsMirror(
      (brandProject.brand_settings ?? {}) as Record<string, unknown>,
      {
        ...sanitizedFields,
        brand_name: savedKit.brand_name,
        ai_system_prompt: savedKit.ai_system_prompt,
        completeness_score: savedKit.completeness_score,
      },
    );

    const { error: brandProjectUpdateError } = await adminClient
      .from("brand_projects")
      .update({
        brand_settings: nextBrandSettings,
      })
      .eq("id", body.brand_project_id);

    if (brandProjectUpdateError) throw brandProjectUpdateError;

    return jsonResponse({
      brand_kit: savedKit,
      completeness_score: savedKit.completeness_score,
    });
  } catch (error) {
    console.error("[org-brand-kit-upsert] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
