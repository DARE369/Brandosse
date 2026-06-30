import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import {
  buildBrandKitSystemPrompt,
  ensureBrandProjectAccess,
  fetchBrandProject,
  fetchDefaultBrandProject,
  fetchOrganization,
  getBrandKitSystemPrompt,
  requireActiveOrgMember,
} from "../_shared/org.ts";
import { callLlm } from "../_shared/llm.ts";
import { readEnv } from "../_shared/env.ts";
import {
  handleCors,
  jsonResponse,
  mapErrorToStatusCode,
  parseJsonBody,
  toErrorPayload,
} from "../_shared/http.ts";

type MetadataRequest = {
  post_id?: string;
  generation_id?: string;
  organization_id?: string;
  brand_project_id?: string | null;
  prompt?: string;
  media_type?: string | null;
  platform?: string | null;
  fields?: string[];
};

type ContentContext = {
  post: Record<string, unknown> | null;
  generation: Record<string, unknown> | null;
  organizationId: string | null;
  brandProjectId: string | null;
  prompt: string;
  mediaType: string;
  sessionId: string | null;
  userId: string | null;
};

function pickJson(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "{}";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function safeObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeHashtags(value: unknown, max = 12) {
  const limit = Number.isFinite(max) && max > 0 ? Math.min(Math.floor(max), 30) : 12;
  return safeArray(value)
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => tag.startsWith("#") ? tag : `#${tag}`)
    .slice(0, limit);
}

function fallbackTitleFromPrompt(prompt: string) {
  const words = String(prompt || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "Untitled session";
  const base = words.slice(0, 7).join(" ");
  return words.length > 7 ? `${base}...` : base;
}

function normalizeFields(fields: string[] | undefined) {
  const allowed = new Set(["title", "caption", "hashtags"]);
  const normalized = safeArray(fields)
    .map((field) => String(field || "").trim().toLowerCase())
    .filter((field) => allowed.has(field));

  return normalized.length > 0
    ? [...new Set(normalized)]
    : ["title", "caption", "hashtags"];
}

async function loadContext(
  adminClient: ReturnType<typeof createAdminClient>,
  request: MetadataRequest,
  userId: string,
): Promise<ContentContext> {
  if (request.post_id) {
    const { data: post, error: postError } = await adminClient
      .from("posts")
      .select(`
        id,
        user_id,
        generation_id,
        organization_id,
        brand_project_id,
        title,
        caption,
        hashtags,
        workflow_state,
        generations (
          id,
          session_id,
          prompt,
          media_type,
          metadata
        )
      `)
      .eq("id", request.post_id)
      .maybeSingle();

    if (postError) throw postError;
    if (!post) throw new Error("Post not found.");

    const organizationId = String(post.organization_id || "").trim() || null;
    if (organizationId) {
      const member = await requireActiveOrgMember(adminClient, organizationId, userId);
      if (!ensureBrandProjectAccess(member, String(post.brand_project_id || "").trim() || null)) {
        throw new Error("You do not have access to this brand project.");
      }
    } else if (post.user_id !== userId) {
      throw new Error("You do not have access to this draft.");
    }

    const generation = Array.isArray(post.generations) ? post.generations[0] || null : post.generations || null;

    return {
      post,
      generation,
      organizationId,
      brandProjectId: String(post.brand_project_id || "").trim() || null,
      prompt: String(generation?.prompt || request.prompt || post.caption || "").trim(),
      mediaType: String(generation?.media_type || request.media_type || "image").trim() || "image",
      sessionId: String(generation?.session_id || "").trim() || null,
      userId: String(post.user_id || "").trim() || null,
    };
  }

  if (request.generation_id) {
    const { data: generation, error: generationError } = await adminClient
      .from("generations")
      .select("id, user_id, session_id, prompt, media_type, organization_id, brand_project_id, metadata")
      .eq("id", request.generation_id)
      .maybeSingle();

    if (generationError) throw generationError;
    if (!generation) throw new Error("Generation not found.");

    const organizationId = String(generation.organization_id || request.organization_id || "").trim() || null;
    if (organizationId) {
      const member = await requireActiveOrgMember(adminClient, organizationId, userId);
      if (!ensureBrandProjectAccess(member, String(generation.brand_project_id || request.brand_project_id || "").trim() || null)) {
        throw new Error("You do not have access to this brand project.");
      }
    } else if (generation.user_id !== userId) {
      throw new Error("You do not have access to this generation.");
    }

    return {
      post: null,
      generation,
      organizationId,
      brandProjectId: String(generation.brand_project_id || request.brand_project_id || "").trim() || null,
      prompt: String(generation.prompt || request.prompt || "").trim(),
      mediaType: String(generation.media_type || request.media_type || "image").trim() || "image",
      sessionId: String(generation.session_id || "").trim() || null,
      userId: String(generation.user_id || "").trim() || null,
    };
  }

  return {
    post: null,
    generation: null,
    organizationId: String(request.organization_id || "").trim() || null,
    brandProjectId: String(request.brand_project_id || "").trim() || null,
    prompt: String(request.prompt || "").trim(),
    mediaType: String(request.media_type || "image").trim() || "image",
    sessionId: null,
    userId,
  };
}

// Build a brand-voice system prompt from a PERSONAL user's brand_kit row so that
// personal (non-org) users get captions in THEIR voice — previously they got none.
async function buildPersonalBrandPrompt(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string | null,
): Promise<{ prompt: string; maxHashtags: number | null } | null> {
  if (!userId) return null;

  const { data: kit, error } = await adminClient
    .from("brand_kit")
    .select(
      "brand_name, industry, tagline, target_audience, brand_voice, tone_descriptors, writing_style_notes, signature_phrases, forbidden_phrases, content_restrictions, legal_disclaimers, emoji_usage, call_to_action_style, max_hashtags",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !kit) return null;

  const arr = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];

  const lines: string[] = [];
  if (kit.brand_name) lines.push(`Brand: ${kit.brand_name}`);
  if (kit.industry) lines.push(`Industry: ${kit.industry}`);
  if (kit.tagline) lines.push(`Tagline: "${kit.tagline}"`);
  if (kit.target_audience) lines.push(`Target audience: ${kit.target_audience}`);
  if (kit.brand_voice) lines.push(`Brand voice: ${kit.brand_voice}`);
  const tone = arr(kit.tone_descriptors);
  if (tone.length) lines.push(`Tone: ${tone.join(", ")}`);
  if (kit.writing_style_notes) lines.push(`Writing style: ${kit.writing_style_notes}`);
  const sig = arr(kit.signature_phrases);
  if (sig.length) lines.push(`Signature phrases to weave in naturally: ${sig.join("; ")}`);
  if (kit.call_to_action_style) lines.push(`Call-to-action style: ${kit.call_to_action_style}`);
  if (kit.emoji_usage) lines.push(`Emoji usage: ${kit.emoji_usage}`);
  const restrictions = arr(kit.content_restrictions);
  if (restrictions.length) lines.push(`Content restrictions: ${restrictions.join(", ")}`);
  if (kit.legal_disclaimers) lines.push(`Required disclaimer (include when relevant): ${kit.legal_disclaimers}`);

  const forbidden = arr(kit.forbidden_phrases);
  const maxHashtags = Number(kit.max_hashtags) > 0 ? Number(kit.max_hashtags) : null;

  if (!lines.length && !forbidden.length && !maxHashtags) return null;

  const hardRules: string[] = [];
  if (forbidden.length) hardRules.push(`NEVER use these words/phrases: ${forbidden.join(", ")}.`);
  if (maxHashtags) hardRules.push(`Use at most ${maxHashtags} hashtags.`);

  const prompt = [
    "You are writing AS this specific brand. Match its voice exactly so the output sounds authentically like THEM — not generic AI copy.",
    lines.join("\n"),
    hardRules.length ? `Hard rules (must follow):\n- ${hardRules.join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");

  return { prompt, maxHashtags };
}

async function buildBrandPrompt(
  adminClient: ReturnType<typeof createAdminClient>,
  organizationId: string | null,
  brandProjectId: string | null,
  userId: string | null,
): Promise<{ prompt: string; maxHashtags: number | null }> {
  if (organizationId) {
    const organization = await fetchOrganization(adminClient, organizationId);
    const defaultBrandProject = brandProjectId
      ? await fetchBrandProject(adminClient, brandProjectId)
      : await fetchDefaultBrandProject(adminClient, organizationId);

    const fallbackBrandPrompt = buildBrandKitSystemPrompt({
      brandName: String(defaultBrandProject?.name || organization.name || "Brand"),
      promptPrefix: "",
      voiceDescription: String((defaultBrandProject?.brand_settings as Record<string, unknown> | undefined)?.voice_description || ""),
      toneDescriptors: (defaultBrandProject?.brand_settings as Record<string, unknown> | undefined)?.tone_descriptors,
      contentPillars: (defaultBrandProject?.brand_settings as Record<string, unknown> | undefined)?.content_pillars,
      targetAudience: String((defaultBrandProject?.brand_settings as Record<string, unknown> | undefined)?.target_audience || ""),
      promptGuidelines: String((defaultBrandProject?.brand_settings as Record<string, unknown> | undefined)?.prompt_guidelines || ""),
      bannedPhrases: (defaultBrandProject?.brand_settings as Record<string, unknown> | undefined)?.banned_phrases,
    });

    const orgPrompt = (await getBrandKitSystemPrompt(adminClient, defaultBrandProject?.id || null)) || fallbackBrandPrompt;
    return { prompt: orgPrompt, maxHashtags: null };
  }

  // Personal workspace → use the user's own brand_kit (the headline fix).
  const personal = await buildPersonalBrandPrompt(adminClient, userId);
  if (personal) return personal;

  return {
    prompt: "No brand context provided. Keep the output concise, platform-ready, and human.",
    maxHashtags: null,
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
    const body = await parseJsonBody<MetadataRequest>(req);

    if (!readEnv("ANTHROPIC_API_KEY", false)) {
      return jsonResponse({
        error: "ANTHROPIC_API_KEY is required for Claude post metadata generation.",
      }, 500);
    }

    const context = await loadContext(adminClient, body, user.id);
    const prompt = String(context.prompt || "").trim();
    if (!prompt) {
      return jsonResponse({ error: "A prompt or linked generation is required." }, 400);
    }

    const fields = normalizeFields(body.fields);
    const brand = await buildBrandPrompt(adminClient, context.organizationId, context.brandProjectId, context.userId);
    const brandPrompt = brand.prompt;
    const platform = String(body.platform || context.post?.platform || "instagram").trim().toLowerCase();
    const mediaType = String(context.mediaType || "image").trim().toLowerCase();

    const systemPrompt = `${brandPrompt}
You are generating lightweight post-production metadata for a social media workflow.
Return ONLY valid JSON with this exact shape:
{
  "title": "string",
  "caption": "string",
  "hashtags": ["#tag"],
  "summary": "string",
  "status": "completed"
}
Rules:
- Write a strong, human title suitable for dashboards, approval queues, and publishing.
- Write a platform-ready caption that matches the media intent.
- Return 4-8 relevant hashtags, never spammy duplicates.
- Keep brand voice intact and avoid placeholder language.
- Use the prompt as the primary source of truth.
- If media_type is video, favor a hook-driven caption.
- If platform is youtube, make the title especially clear and searchable.`;

    const llmResult = await callLlm({
      preferredProvider: "anthropic",
      systemPrompt,
      maxTokens: 800,
      temperature: 0.45,
      messages: [
        {
          role: "user",
          content: [
            `Platform: ${platform}`,
            `Media type: ${mediaType}`,
            `Requested fields: ${fields.join(", ")}`,
            `Prompt:\n${prompt}`,
          ].join("\n\n"),
        },
      ],
    });

    const parsed = safeObject(JSON.parse(pickJson(llmResult.content)));
    const title = String(parsed.title || fallbackTitleFromPrompt(prompt)).trim() || fallbackTitleFromPrompt(prompt);
    const caption = String(parsed.caption || prompt).trim() || prompt;
    const hashtags = normalizeHashtags(parsed.hashtags, brand.maxHashtags ?? 12);
    const summary = String(parsed.summary || "").trim();

    if (body.post_id) {
      const currentWorkflowState = safeObject(context.post?.workflow_state);
      const nextWorkflowState = {
        ...currentWorkflowState,
        metadata_status: "completed",
        metadata_generated_at: new Date().toISOString(),
        metadata_provider: llmResult.provider,
        metadata_model: llmResult.model,
      };

      const updatePayload: Record<string, unknown> = {
        workflow_state: nextWorkflowState,
        updated_at: new Date().toISOString(),
      };

      if (fields.includes("title")) updatePayload.title = title;
      if (fields.includes("caption")) updatePayload.caption = caption;
      if (fields.includes("hashtags")) updatePayload.hashtags = hashtags;

      const { error: postUpdateError } = await adminClient
        .from("posts")
        .update(updatePayload)
        .eq("id", body.post_id);

      if (postUpdateError) throw postUpdateError;
    }

    if (context.sessionId && title) {
      const { data: session } = await adminClient
        .from("sessions")
        .select("id, title")
        .eq("id", context.sessionId)
        .maybeSingle();

      const currentTitle = String(session?.title || "").trim();
      const promptFallback = fallbackTitleFromPrompt(prompt);
      if (!currentTitle || currentTitle === "New Session" || currentTitle === promptFallback) {
        await adminClient
          .from("sessions")
          .update({ title, updated_at: new Date().toISOString() })
          .eq("id", context.sessionId);
      }
    }

    return jsonResponse({
      title,
      caption,
      hashtags,
      summary,
      status: "completed",
      generation_status: "completed",
      fields,
      provider: llmResult.provider,
      model: llmResult.model,
      provider_warning: null,
    });
  } catch (error) {
    console.error("[generate-post-metadata] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
