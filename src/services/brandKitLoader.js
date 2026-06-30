// src/services/brandKitLoader.js
import { supabase } from '../services/supabaseClient';

export async function loadBrandKit(userId) {
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const { data: assets } = await supabase
    .from('brand_assets')
    .select('name, asset_type, description, tags, usage_hints, alt_text, extracted_text, visual_summary, font_family')
    .eq('user_id', userId)
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
