import React from 'react';

const RECIPES = [
  { icon: '⊞', name: 'Product hero',  hint: 'Clean product on brand bg',    prompt: 'Professional product hero shot, clean background, studio lighting, brand colors, sharp detail, 4:5 format' },
  { icon: '❝', name: 'Quote card',    hint: 'Text + visual backdrop',        prompt: 'Elegant quote card, typographic layout, warm gradient background, minimal design, professional editorial style' },
  { icon: '▷', name: 'Reel cover',    hint: 'Bold vertical cover image',     prompt: 'Eye-catching reel cover, bold composition, vertical 9:16 format, vibrant colors, social media ready' },
  { icon: '◳', name: 'Sale flyer',    hint: 'Promotional announcement',      prompt: 'Sale promotion graphic, bold headline area, brand colors, clean layout, high contrast, urgent feel' },
];

export default function StudioBriefSidebar({ brandKit, completedGenerations = [], onSelectRecipe }) {
  const palette    = brandKit?.raw?.color_palette ?? brandKit?.raw?.colors ?? [];
  const swatches   = Array.isArray(palette) ? palette.slice(0, 5) : [];
  const brandName  = brandKit?.raw?.brand_name;
  const brandVoice = brandKit?.raw?.brand_voice || brandKit?.raw?.tone_descriptors?.[0];
  const ctaStyle   = brandKit?.raw?.call_to_action_style;
  const emojiUsage = brandKit?.raw?.emoji_usage;
  const forbidden  = brandKit?.raw?.forbidden_phrases;
  const hasBrand   = !!(brandName || brandVoice || swatches.length);

  const recent = completedGenerations
    .filter((g) => g.status === 'completed' && (g.output_url || g.thumbnail_url))
    .slice(0, 3);

  return (
    <div className="bsi">

      {/* ── Start from a recipe ─────────────────────────────────────── */}
      <div className="bsi-card">
        <div className="bsi-head">Start from a recipe</div>
        <div className="bsi-recipes">
          {RECIPES.map((r) => (
            <button
              key={r.name}
              type="button"
              className="bsi-recipe"
              onClick={() => onSelectRecipe?.(r.prompt)}
              title={r.hint}
            >
              <span className="bsi-recipe-icon">{r.icon}</span>
              <span className="bsi-recipe-name">{r.name}</span>
              <span className="bsi-recipe-hint">{r.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Brand applied ───────────────────────────────────────────── */}
      <div className="bsi-card">
        <div className="bsi-head">Brand applied</div>
        {hasBrand ? (
          <>
            {swatches.length > 0 && (
              <div className="bsi-brand-row">
                <div className="bsi-swatches">
                  {swatches.map((color, i) => (
                    <span
                      key={i}
                      className="bsi-swatch"
                      style={{ background: typeof color === 'string' ? color : color?.hex ?? color?.value ?? '#7c5cfc' }}
                      title={typeof color === 'string' ? color : color?.name}
                    />
                  ))}
                </div>
                <span className="bsi-brand-label">{brandName ?? 'Brand Kit'}</span>
              </div>
            )}
            <div className="bsi-brand-tags">
              {brandVoice && <span className="bsi-brand-tag">{brandVoice}</span>}
              {ctaStyle   && <span className="bsi-brand-tag">{ctaStyle}</span>}
              {emojiUsage && <span className="bsi-brand-tag">Emoji: {emojiUsage}</span>}
              {Array.isArray(forbidden) && forbidden.length > 0 && (
                <span className="bsi-brand-tag bsi-brand-tag--warn">{forbidden.length} phrase{forbidden.length !== 1 ? 's' : ''} blocked</span>
              )}
            </div>
            <p className="bsi-brand-note">Brand applied to generation + captions</p>
          </>
        ) : (
          <>
            <p className="bsi-no-brand">No Brand Kit set up yet.</p>
            <a href="/brand-kit" className="bsi-brand-setup">Set up Brand Kit →</a>
          </>
        )}
      </div>

      {/* ── Recent in this session ───────────────────────────────────── */}
      {recent.length > 0 && (
        <div className="bsi-card">
          <div className="bsi-head">Recent in this session</div>
          <div className="bsi-recent-list">
            {recent.map((g) => (
              <div key={g.id} className="bsi-recent-item">
                <img
                  className="bsi-recent-thumb"
                  src={g.thumbnail_url || g.output_url}
                  alt={g.prompt?.slice(0, 40) || 'Generation'}
                  loading="lazy"
                />
                <div className="bsi-recent-info">
                  <div className="bsi-recent-title">
                    {g.prompt?.slice(0, 38) || 'Untitled generation'}{g.prompt?.length > 38 ? '…' : ''}
                  </div>
                  <div className="bsi-recent-date">
                    {new Date(g.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
