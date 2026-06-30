import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callLlm } from "../_shared/llm.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

// ── Types ─────────────────────────────────────────────────────────────────────
type ExistingPost = { id?: string; scheduled_at?: string; platform?: string; status?: string; captionSnippet?: string; };
type DraftItem    = { id: string; title?: string; platform?: string; media_type?: string; };

type CalendarAiBody = {
  action: "slot_suggestions" | "caption_audit" | "week_plan" | "command";
  weekStart?: string;
  platforms?: string[];
  existingPosts?: ExistingPost[];
  brandVoice?: string | null;
  contentType?: string;
  count?: number;
  caption?: string;
  platform?: string;
  hashtags?: string[];
  mediaType?: string;
  brandKeywords?: string[];
  forbiddenPhrases?: string[];
  goals?: string;
  drafts?: DraftItem[];
  command?: string;
  posts?: ExistingPost[];
  selectedPostId?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function pickJson(value: string): string {
  const text = String(value || "").trim();
  if (!text) throw new Error("LLM returned an empty response");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function safeParseJson(raw: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try { return JSON.parse(pickJson(raw)) as Record<string, unknown>; }
  catch { return fallback; }
}

// ── slot_suggestions ──────────────────────────────────────────────────────────
async function slotSuggestionsData(body: CalendarAiBody) {
  const { weekStart = "", platforms = [], existingPosts = [], brandVoice = null, contentType = "image", count = 5 } = body;

  const system = `You are a social media scheduling strategist. Return ONLY valid JSON.
Shape: { "suggestions": [{ "day":"<Mon|Tue|Wed|Thu|Fri|Sat|Sun>","time":"<HH:MM>","platform":"<platform>","score":<0-100>,"reason":"<string>","contentTypeHint":"<image|video|carousel>" }], "rationale":"<string>" }`;

  const existing = existingPosts.length ? existingPosts.map((p) => `- ${p.platform} @ ${p.scheduled_at}`).join("\n") : "None";
  const user = `Week starting: ${weekStart || "this Monday"}\nPlatforms: ${platforms.join(", ") || "not specified"}\nContent type: ${contentType}\nBrand voice: ${brandVoice || "neutral"}\nAlready scheduled:\n${existing}\n\nReturn ${count} slot suggestions spread across different days.`;

  const r = await callLlm({ systemPrompt: system, messages: [{ role: "user", content: user }], preferredProvider: "groq", maxTokens: 900, temperature: 0.5, jsonMode: true });
  const p = safeParseJson(r.content, { suggestions: [], rationale: "" });
  return { suggestions: Array.isArray(p.suggestions) ? p.suggestions : [], rationale: typeof p.rationale === "string" ? p.rationale : "" };
}

// ── caption_audit ─────────────────────────────────────────────────────────────
async function captionAuditData(body: CalendarAiBody) {
  const { caption = "", platform = "instagram", hashtags = [], mediaType = "image", brandVoice = null, brandKeywords = [], forbiddenPhrases = [] } = body;

  const system = `You are a social media caption quality auditor. Return ONLY valid JSON.
Shape: { "score":<0-100>, "grade":"<Poor|Fair|Good|Great>", "issues":[{"type":"<warning|improvement|info>","message":"<string>"}], "fixedCaption":"<string>", "fixedHashtags":["<string>"], "explanation":"<string>" }`;

  const limits: Record<string, string> = { x: "max 280 chars", instagram: "125-150 words, up to 30 hashtags", tiktok: "short hook, 3-5 hashtags", linkedin: "professional tone, 5-7 hashtags" };
  const user = `Platform: ${platform} — ${limits[platform] || "standard"}\nMedia: ${mediaType}\nBrand voice: ${brandVoice || "neutral"}\nKeywords: ${brandKeywords.join(", ") || "none"}\nForbidden: ${forbiddenPhrases.join(", ") || "none"}\n\nCaption:\n"""\n${caption}\n"""\n\nHashtags: ${hashtags.join(", ") || "none"}\n\nAudit it and return improved version.`;

  const r = await callLlm({ systemPrompt: system, messages: [{ role: "user", content: user }], preferredProvider: "groq", maxTokens: 1000, temperature: 0.4, jsonMode: true });
  const p = safeParseJson(r.content, { score: 50, grade: "Fair", issues: [], fixedCaption: caption, fixedHashtags: hashtags, explanation: "" });
  return {
    score:        typeof p.score === "number" ? p.score : 50,
    grade:        typeof p.grade === "string" ? p.grade : "Fair",
    issues:       Array.isArray(p.issues) ? p.issues : [],
    fixedCaption: typeof p.fixedCaption === "string" ? p.fixedCaption : caption,
    fixedHashtags: Array.isArray(p.fixedHashtags) ? p.fixedHashtags : hashtags,
    explanation:  typeof p.explanation === "string" ? p.explanation : "",
  };
}

// ── week_plan ─────────────────────────────────────────────────────────────────
async function weekPlanData(body: CalendarAiBody) {
  const { weekStart = "", platforms = [], goals = "", drafts = [], brandVoice = null, brandKeywords = [], existingPosts = [] } = body;

  const system = `You are a senior social media content strategist. Generate a realistic weekly content calendar.
Return ONLY valid JSON.
Shape: { "plan": [{ "day":"<YYYY-MM-DD>","time":"<HH:MM>","platform":"<platform>","contentType":"<image|video|carousel>","hook":"<string>","caption":"<string>","hashtags":["<string>"],"draftId":"<id or null>","isNew":<boolean> }], "summary":"<string>" }`;

  const draftList = drafts.length ? drafts.map((d) => `- id:${d.id} | ${d.title || "Untitled"} | ${d.platform || "any"} | ${d.media_type || "image"}`).join("\n") : "No drafts.";
  const existing  = existingPosts.length ? existingPosts.map((p) => `- ${p.platform} @ ${p.scheduled_at}`).join("\n") : "None";
  const user = `Week starting: ${weekStart || "this Monday"}\nPlatforms: ${platforms.join(", ") || "instagram, tiktok"}\nBrand voice: ${brandVoice || "neutral"}\nKeywords: ${(brandKeywords || []).join(", ") || "none"}\nGoals: ${goals || "1-2 posts per platform, engaging content"}\n\nAvailable drafts:\n${draftList}\n\nAlready scheduled (avoid overlap):\n${existing}\n\nGenerate plan. Link draftId if a draft fits, otherwise isNew:true.`;

  const r = await callLlm({ systemPrompt: system, messages: [{ role: "user", content: user }], preferredProvider: "groq", maxTokens: 2500, temperature: 0.65, jsonMode: true });
  const p = safeParseJson(r.content, { plan: [], summary: "" });
  return { plan: Array.isArray(p.plan) ? p.plan : [], summary: typeof p.summary === "string" ? p.summary : "" };
}

// ── command (⌘K) ──────────────────────────────────────────────────────────────
async function commandData(body: CalendarAiBody) {
  const { command = "", weekStart = "", posts = [], drafts = [], selectedPostId = null } = body;

  const system = `You are an AI assistant inside a content calendar app.
Interpret the user's command and return ONLY valid JSON.
Shape: { "intent":"<reschedule|caption_fix|add_post|delete_post|suggest_slots|week_plan|audit|explain|unknown>", "actions":[{"type":"<string>","payload":{}}], "reply":"<1-3 sentence friendly reply>" }

Action payload shapes:
- reschedule:    { "postId":"<id>", "newScheduledAt":"<ISO>" }
- update_caption:{ "postId":"<id>", "caption":"<string>", "hashtags":["<string>"] }
- add_draft_post:{ "draftId":"<id>", "scheduledAt":"<ISO>", "platform":"<string>" }
- delete_post:   { "postId":"<id>" }
- suggest_slots: {}
- week_plan:     {}
- audit:         { "postId":"<id>" }
No actions needed for explain/unknown.`;

  const postList  = posts.length  ? posts.map((p)  => `- id:${p.id || "?"} | ${p.platform} | ${p.status} | ${p.scheduled_at || "unscheduled"} | "${(p.captionSnippet || "").slice(0, 80)}"`).join("\n") : "No posts.";
  const draftList = drafts.length ? drafts.map((d) => `- id:${d.id} | ${d.title || "Untitled"} | ${d.platform || "any"} | ${d.media_type || "image"}`).join("\n") : "No drafts.";
  const user = `Week: ${weekStart || "this week"}\nSelected post: ${selectedPostId || "none"}\n\nPosts:\n${postList}\n\nDrafts:\n${draftList}\n\nCommand: "${command}"`;

  const r = await callLlm({ systemPrompt: system, messages: [{ role: "user", content: user }], preferredProvider: "groq", maxTokens: 900, temperature: 0.4, jsonMode: true });
  const p = safeParseJson(r.content, { intent: "unknown", actions: [], reply: "Done." });

  const intent  = typeof p.intent  === "string" ? p.intent  : "unknown";
  const actions = Array.isArray(p.actions) ? p.actions : [];
  const reply   = typeof p.reply   === "string" ? p.reply   : "Done.";

  // When AI wants a week plan, generate it inline so client gets plan data
  if (intent === "week_plan") {
    try {
      const planBody: CalendarAiBody = {
        action: "week_plan",
        weekStart,
        platforms: [...new Set((posts).map((p) => p.platform).filter((x): x is string => Boolean(x)))],
        goals: command,
        drafts: drafts as DraftItem[],
        existingPosts: posts,
      };
      const pd = await weekPlanData(planBody);
      return { intent, actions: [{ type: "week_plan", payload: {} }, ...actions], reply, plan: pd.plan, summary: pd.summary };
    } catch (_e) {
      // Return without plan; client will still show the action button
    }
  }

  return { intent, actions, reply };
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────
serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    await requireUser(authClient);

    const body   = await parseJsonBody<CalendarAiBody>(req);
    const action = body?.action;

    if (!action) return jsonResponse({ error: "Missing action" }, 400);

    if (action === "slot_suggestions") return jsonResponse(await slotSuggestionsData(body));
    if (action === "caption_audit")    return jsonResponse(await captionAuditData(body));
    if (action === "week_plan")        return jsonResponse(await weekPlanData(body));
    if (action === "command")          return jsonResponse(await commandData(body));

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("[calendar-ai] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
