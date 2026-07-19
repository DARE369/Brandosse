// src/services/calendarAIService.js
// Calendar AI features routed through the `calendar-ai` Supabase edge function.
// All functions return plain JS objects; callers decide how to handle errors.
import { supabase } from './supabaseClient';

const FALLBACK_TIMEOUT_MS = 12000;

async function invokeCalendarAI(payload, timeoutMs = FALLBACK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { data, error } = await supabase.functions.invoke('calendar-ai', {
      body: payload,
      signal: controller.signal,
    });

    if (error) {
      let detail = error.message || 'calendar-ai edge function failed';
      try {
        const ctx = error?.context;
        if (typeof ctx?.json === 'function') {
          const body = await ctx.json();
          detail = body?.error || body?.message || detail;
        } else if (typeof ctx?.text === 'function') {
          const text = await ctx.text();
          if (text) {
            const parsed = JSON.parse(text);
            detail = parsed?.error || parsed?.message || text;
          }
        }
      } catch (_) {}
      throw new Error(String(detail));
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ── Slot Suggestions ──────────────────────────────────────────────────────────
// Returns up to `count` optimal slot suggestions for the given week.
//
// params: {
//   weekStart: ISO string (Monday),
//   platforms: string[],
//   existingPosts: { scheduled_at: ISO, platform: string }[],
//   brandKit: object | null,
//   contentType: 'image' | 'video' | 'carousel',
//   count: number (default 5),
// }
//
// Returns: { suggestions: SlotSuggestion[], rationale: string }
// SlotSuggestion: { day: 'Mon'|…, time: 'HH:MM', platform: string,
//                   score: 0–100, reason: string, contentTypeHint: string }
export async function getSlotSuggestions(params) {
  const {
    weekStart,
    platforms = [],
    existingPosts = [],
    brandKit = null,
    contentType = 'image',
    count = 5,
  } = params;

  const data = await invokeCalendarAI({
    action: 'slot_suggestions',
    weekStart,
    platforms,
    existingPosts: existingPosts.map((p) => ({
      scheduled_at: p.scheduled_at,
      platform: p.platform,
    })),
    brandVoice: brandKit?.raw?.brand_voice || null,
    contentType,
    count,
  });

  return {
    suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
    rationale: data?.rationale || '',
  };
}

// ── Caption Audit ─────────────────────────────────────────────────────────────
// Audits a post's caption and returns a score + fix suggestions.
//
// post: { caption: string, platform: string, hashtags: string[], media_type: string }
// brandKit: object | null
//
// Returns: {
//   score: number 0–100,
//   grade: 'Poor'|'Fair'|'Good'|'Great',
//   issues: { type: 'warning'|'improvement'|'info', message: string }[],
//   fixedCaption: string,
//   fixedHashtags: string[],
//   explanation: string,
//   variants: { label: string, caption: string }[],
//   hashtagSuggestions: { tag: string, reach: 'High'|'Medium'|'Niche' }[],
// }
export async function auditPostCaption(post, brandKit = null) {
  const data = await invokeCalendarAI({
    action: 'caption_audit',
    caption: post.caption || '',
    platform: post.platform || 'instagram',
    hashtags: post.hashtags || [],
    mediaType: post.media_type || 'image',
    brandVoice: brandKit?.raw?.brand_voice || null,
    brandKeywords: brandKit?.raw?.visual_style_keywords || [],
    forbiddenPhrases: brandKit?.raw?.forbidden_phrases || [],
  });

  return {
    score: Number(data?.score ?? 0),
    grade: data?.grade || 'Fair',
    issues: Array.isArray(data?.issues) ? data.issues : [],
    fixedCaption: data?.fixedCaption || post.caption || '',
    fixedHashtags: Array.isArray(data?.fixedHashtags) ? data.fixedHashtags : (post.hashtags || []),
    explanation: data?.explanation || '',
    variants: Array.isArray(data?.variants) ? data.variants : [],
    hashtagSuggestions: Array.isArray(data?.hashtagSuggestions) ? data.hashtagSuggestions : [],
  };
}

// ── Week Plan Generator ───────────────────────────────────────────────────────
// Generates a content calendar plan for the given week.
//
// context: {
//   weekStart: ISO string,
//   platforms: string[],
//   goals: string,          // e.g. "3 posts this week, focus on product demos"
//   drafts: { id, title, media_type, platform }[],
//   brandKit: object | null,
//   existingPosts: { scheduled_at, platform }[],
// }
//
// Returns: {
//   plan: WeekPlanEntry[],
//   summary: string,
// }
// WeekPlanEntry: {
//   day: ISO date string,
//   time: 'HH:MM',
//   platform: string,
//   contentType: string,
//   hook: string,
//   caption: string,
//   hashtags: string[],
//   draftId: string | null,   // linked draft if matched
//   isNew: boolean,
// }
export async function generateWeekPlan(context) {
  const {
    weekStart,
    platforms = [],
    goals = '',
    drafts = [],
    brandKit = null,
    existingPosts = [],
  } = context;

  const data = await invokeCalendarAI(
    {
      action: 'week_plan',
      weekStart,
      platforms,
      goals,
      drafts: drafts.map((d) => ({
        id: d.id,
        title: d.title,
        media_type: d.media_type,
        platform: d.platform,
      })),
      brandVoice: brandKit?.raw?.brand_voice || null,
      brandKeywords: brandKit?.raw?.visual_style_keywords || [],
      existingPosts: existingPosts.map((p) => ({
        scheduled_at: p.scheduled_at,
        platform: p.platform,
      })),
    },
    20000,
  );

  return {
    plan: Array.isArray(data?.plan) ? data.plan : [],
    summary: data?.summary || '',
  };
}

// ── Command Bar (⌘K) ──────────────────────────────────────────────────────────
// Executes a natural language command in the context of the calendar.
//
// command: string   — natural language instruction
// context: {
//   weekStart: ISO string,
//   posts: { id, scheduled_at, platform, status, caption }[],
//   drafts: { id, title, platform, media_type }[],
//   selectedPostId: string | null,
// }
//
// Returns: {
//   intent: 'reschedule'|'caption_fix'|'add_post'|'delete_post'|'suggest_slots'
//         | 'week_plan'|'audit'|'explain'|'unknown',
//   actions: CalendarAction[],
//   reply: string,
// }
// CalendarAction: { type: string, payload: object }
// e.g. { type: 'reschedule', payload: { postId, newScheduledAt } }
//      { type: 'update_caption', payload: { postId, caption, hashtags } }
//      { type: 'add_draft_post', payload: { draftId, scheduledAt, platform } }
export async function executeCalendarCommand(command, context) {
  const {
    weekStart,
    posts = [],
    drafts = [],
    selectedPostId = null,
  } = context;

  const data = await invokeCalendarAI(
    {
      action: 'command',
      command: String(command || '').trim(),
      weekStart,
      posts: posts.map((p) => ({
        id: p.id,
        scheduled_at: p.scheduled_at,
        platform: p.platform,
        status: p.status,
        captionSnippet: (p.caption || '').slice(0, 120),
      })),
      drafts: drafts.map((d) => ({
        id: d.id,
        title: d.title,
        platform: d.platform,
        media_type: d.media_type,
      })),
      selectedPostId,
    },
    16000,
  );

  return {
    intent: data?.intent || 'unknown',
    actions: Array.isArray(data?.actions) ? data.actions : [],
    reply: data?.reply || 'Done.',
  };
}

// ── Publish Readiness Check ───────────────────────────────────────────────────
// Quick local-only readiness check (no network call).
// Returns a checklist the PostPanel renders before the user publishes.
export function checkPublishReadiness(post) {
  const checks = [];

  const hasCaption = Boolean(post?.caption?.trim());
  checks.push({
    id: 'caption',
    label: 'Caption written',
    pass: hasCaption,
    severity: 'error',
  });

  // Media lives on the joined `generations` row (storage_path), not on
  // `posts` itself — posts has no media_url/thumbnail_url column. Supabase
  // can return a to-one join as either an object or a single-element array
  // depending on how the relationship was inferred, so handle both (same
  // defensive unwrap publish-post's edge function uses).
  const generationRow = Array.isArray(post?.generations) ? post.generations[0] : post?.generations;
  const hasMedia = Boolean(post?.media_url || post?.thumbnail_url || generationRow?.storage_path || generationRow?.output_url);
  checks.push({
    id: 'media',
    label: 'Media attached',
    pass: hasMedia,
    severity: 'error',
  });

  const hasPlatform = Boolean(post?.platform);
  checks.push({
    id: 'platform',
    label: 'Platform selected',
    pass: hasPlatform,
    severity: 'error',
  });

  const hasScheduledAt = Boolean(post?.scheduled_at);
  checks.push({
    id: 'scheduled',
    label: 'Scheduled time set',
    pass: hasScheduledAt,
    severity: 'error',
  });

  const caption = post?.caption || '';
  const captionLen = caption.length;
  let captionLengthOk = true;
  let captionLengthNote = '';
  if (post?.platform === 'x' && captionLen > 280) {
    captionLengthOk = false;
    captionLengthNote = `X caption too long (${captionLen}/280 chars)`;
  } else if (captionLen > 2200) {
    captionLengthOk = false;
    captionLengthNote = `Caption may be too long (${captionLen} chars)`;
  }
  checks.push({
    id: 'caption_length',
    label: captionLengthNote || 'Caption length OK',
    pass: captionLengthOk,
    severity: 'warning',
  });

  const hashtags = post?.hashtags || [];
  const hashtagCountOk = !(post?.platform === 'instagram' && hashtags.length > 30);
  checks.push({
    id: 'hashtags',
    label: hashtagCountOk ? 'Hashtag count OK' : `Too many hashtags (${hashtags.length}/30 max)`,
    pass: hashtagCountOk,
    severity: 'warning',
  });

  const now = Date.now();
  const scheduledMs = post?.scheduled_at ? new Date(post.scheduled_at).getTime() : 0;
  const notInPast = !post?.scheduled_at || scheduledMs > now;
  checks.push({
    id: 'future_time',
    label: notInPast ? 'Scheduled in the future' : 'Scheduled time is in the past',
    pass: notInPast,
    severity: 'warning',
  });

  const errors = checks.filter((c) => !c.pass && c.severity === 'error');
  const warnings = checks.filter((c) => !c.pass && c.severity === 'warning');

  return {
    checks,
    canPublish: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
  };
}
