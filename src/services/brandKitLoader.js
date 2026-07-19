// src/services/brandKitLoader.js
//
// Multi-kit note (docs/brand-kit-rebuild/DECISIONS_LOG.md — "Active-kit
// model for Studio"): an account can hold several brand kits, but Studio
// always generates from exactly one — whichever kit has `is_active = true`
// (enforced by a partial unique index, see
// supabase/migrations/20260708140000_brand_kit_multi_kit.sql). This file is
// the live bridge between Brand Kit data and content generation quality
// (imported by SessionStore.js and generationPipeline.js) — treat any
// further change here as a breaking-change review, not a routine edit.
import { supabase } from '../services/supabaseClient';

export async function loadBrandKit(userId) {
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!kit) {
    return condenseBrandKit(null, []);
  }

  // Assets are scoped to the active kit specifically, not every kit the
  // account owns — a user with an inactive "Client B" kit's logo shouldn't
  // leak into generations steered by the active "Client A" kit.
  const { data: assets } = await supabase
    .from('brand_assets')
    .select('name, asset_type, description, tags, usage_hints, alt_text, extracted_text, visual_summary, font_family')
    .eq('brand_kit_id', kit.id)
    .eq('status', 'ready')
    .limit(20);

  return condenseBrandKit(kit, assets ?? []);
}

function condenseBrandKit(kit, assets) {
  if (!kit) return { configured: false, summary: '', asset_context: '', raw: null };

  const summary = [
    kit.brand_name           && `Brand: ${kit.brand_name}`,
    kit.industry             && `Industry: ${kit.industry}`,
    kit.tagline              && `Tagline: "${kit.tagline}"`,
    kit.target_audience      && `Audience: ${kit.target_audience}`,
    kit.brand_voice          && `Voice: ${kit.brand_voice}`,
    kit.tone_descriptors?.length && `Tone: ${kit.tone_descriptors.join(', ')}`,
    kit.writing_style_notes  && `Writing style: ${kit.writing_style_notes}`,
    kit.signature_phrases?.length && `Signature phrases: ${kit.signature_phrases.join('; ')}`,
    kit.forbidden_phrases?.length && `NEVER USE: ${kit.forbidden_phrases.join(', ')}`,
    kit.visual_style_keywords?.length && `Visual style: ${kit.visual_style_keywords.join(', ')}`,
    kit.photo_style_notes    && `Photo style: ${kit.photo_style_notes}`,
    kit.avoid_visual_elements?.length && `Avoid visually: ${kit.avoid_visual_elements.join(', ')}`,
    kit.font_display?.family && `Display font: ${kit.font_display.family}${kit.font_display.style ? ` (${kit.font_display.style})` : ''}`,
    kit.font_body?.family    && `Body font: ${kit.font_body.family}${kit.font_body.style ? ` (${kit.font_body.style})` : ''}`,
    kit.content_restrictions?.length && `Content restrictions: ${kit.content_restrictions.join(', ')}`,
    kit.legal_disclaimers    && `Required disclaimer: ${kit.legal_disclaimers}`,
    kit.emoji_usage          && `Emoji usage: ${kit.emoji_usage}`,
    kit.call_to_action_style && `CTA style: ${kit.call_to_action_style}`,
    kit.max_hashtags         && `Max hashtags: ${kit.max_hashtags}`,
  ].filter(Boolean).join('\n');

  const asset_context = assets.map(a => {
    const parts = [`Asset: ${a.name} (${a.asset_type})`];
    if (a.description)    parts.push(`Description: ${a.description}`);
    if (a.usage_hints)    parts.push(`Usage: ${a.usage_hints}`);
    if (a.alt_text)       parts.push(`Visual: ${a.alt_text}`);
    if (a.extracted_text) parts.push(`Doc content: ${a.extracted_text.slice(0, 500)}`);
    if (a.font_family)    parts.push(`Font: ${a.font_family}`);
    return parts.join(' | ');
  }).join('\n');

  return {
    configured: kit.setup_completed === true,
    raw: kit,
    summary,
    asset_context,
  };
}
