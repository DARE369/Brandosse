// src/components/BrandKit/BrandKitForm.jsx
// Tabbed form for all brand kit fields. Used inside BrandKitPage.
import React, { useEffect, useState } from 'react';
import AssetUploader        from './AssetUploader';

const TABS   = ['Basics', 'Voice', 'Guardrails', 'Visual Style', 'Assets'];
const VOICES = ['professional', 'playful', 'authoritative', 'conversational', 'inspirational', 'edgy'];
const EMOJIS = ['none', 'minimal', 'moderate', 'heavy'];
const CTA_STYLES = ['question-based', 'imperative', 'soft'];
const INDUSTRIES = ['Fashion', 'Tech', 'Food & Bev', 'Health & Wellness', 'Finance', 'Creative Agency', 'Other'];
const LANGUAGES  = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'zh'];

// Simple tag input component (inline)
function TagInput({ value = [], onChange, placeholder }) {
  const [input, setInput] = useState('');
  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput('');
  };
  return (
    <div className="tag-input-wrapper">
      <div className="tag-list">
        {value.map(tag => (
          <span key={tag} className="tag-chip">
            {tag}
            <button type="button" onClick={() => onChange(value.filter(t => t !== tag))}>×</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        placeholder={placeholder}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
      />
    </div>
  );
}

// Color palette editor
function ColorPaletteEditor({ value = [], onChange }) {
  const updateColor = (i, field, val) => {
    const next = value.map((c, idx) => idx === i ? { ...c, [field]: val } : c);
    onChange(next);
  };
  const addColor = () => {
    if (value.length >= 8) return;
    onChange([...value, { hex: '#000000', name: '', usage: '' }]);
  };
  return (
    <div className="color-palette-editor">
      {value.map((color, i) => (
        <div key={i} className="color-swatch-row">
          <input type="color" value={color.hex} onChange={e => updateColor(i, 'hex', e.target.value)} />
          <input type="text" placeholder="Name" value={color.name} onChange={e => updateColor(i, 'name', e.target.value)} />
          <input type="text" placeholder="Usage note" value={color.usage} onChange={e => updateColor(i, 'usage', e.target.value)} />
          <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>×</button>
        </div>
      ))}
      {value.length < 8 && (
        <button type="button" className="bk-btn-secondary small" onClick={addColor}>+ Add color</button>
      )}
    </div>
  );
}

function toFormState(initialData = {}) {
  return {
    brand_name:            initialData.brand_name            ?? '',
    industry:              initialData.industry              ?? '',
    tagline:               initialData.tagline               ?? '',
    website_url:           initialData.website_url           ?? '',
    primary_language:      initialData.primary_language      ?? 'en',
    target_audience:       initialData.target_audience       ?? '',
    audience_age_range:    initialData.audience_age_range    ?? '',
    audience_locations:    initialData.audience_locations    ?? [],
    brand_voice:           initialData.brand_voice           ?? '',
    tone_descriptors:      initialData.tone_descriptors      ?? [],
    writing_style_notes:   initialData.writing_style_notes   ?? '',
    signature_phrases:     initialData.signature_phrases     ?? [],
    forbidden_phrases:     initialData.forbidden_phrases     ?? [],
    emoji_usage:           initialData.emoji_usage           ?? 'moderate',
    call_to_action_style:  initialData.call_to_action_style  ?? '',
    content_restrictions:  initialData.content_restrictions  ?? [],
    competitor_names:      initialData.competitor_names      ?? [],
    legal_disclaimers:     initialData.legal_disclaimers     ?? '',
    brand_safe_only:       initialData.brand_safe_only       ?? true,
    min_caption_words:     initialData.min_caption_words     ?? 20,
    max_caption_words:     initialData.max_caption_words     ?? 300,
    max_hashtags:          initialData.max_hashtags          ?? 30,
    visual_style_keywords: initialData.visual_style_keywords ?? [],
    color_palette:         initialData.color_palette         ?? [],
    typography_notes:      initialData.typography_notes      ?? '',
    photo_style_notes:     initialData.photo_style_notes     ?? '',
    avoid_visual_elements: initialData.avoid_visual_elements ?? [],
  };
}

export default function BrandKitForm({ initialData = {}, onSave, userId, brandKitId, isSaving }) {
  const [activeTab, setActiveTab] = useState('Basics');
  const [form, setForm] = useState(() => toFormState(initialData));

  useEffect(() => {
    setForm(toFormState(initialData));
  }, [initialData]);

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSave = () => onSave(form);

  return (
    <div className="bk-form">
      {/* Tab strip */}
      <div className="bk-tab-strip" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={`bk-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="bk-tab-panel">

        {activeTab === 'Basics' && (
          <div className="bk-fields">
            <label>Brand Name <span className="required">*</span>
              <input type="text" value={form.brand_name} onChange={e => set('brand_name', e.target.value)} />
            </label>
            <label>Industry
              <select value={form.industry} onChange={e => set('industry', e.target.value)}>
                <option value="">Select…</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
            <label>Tagline <small>(max 120 chars)</small>
              <input type="text" maxLength={120} value={form.tagline} onChange={e => set('tagline', e.target.value)} />
            </label>
            <label>Website URL
              <input type="url" value={form.website_url} onChange={e => set('website_url', e.target.value)} />
            </label>
            <label>Target Audience
              <textarea rows={3} value={form.target_audience} onChange={e => set('target_audience', e.target.value)}
                placeholder="Urban professionals 25–40 interested in sustainable living" />
            </label>
            <label>Audience Age Range
              <input type="text" placeholder="25-40" value={form.audience_age_range} onChange={e => set('audience_age_range', e.target.value)} />
            </label>
            <label>Audience Locations
              <TagInput value={form.audience_locations} onChange={v => set('audience_locations', v)} placeholder="US, UK…" />
            </label>
            <label>Primary Language
              <select value={form.primary_language} onChange={e => set('primary_language', e.target.value)}>
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>
        )}

        {activeTab === 'Voice' && (
          <div className="bk-fields">
            <label>Brand Voice</label>
            <div className="bk-button-group">
              {VOICES.map(v => (
                <button key={v} type="button"
                  className={`bk-pill${form.brand_voice === v ? ' active' : ''}`}
                  onClick={() => set('brand_voice', v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <label>Tone Descriptors
              <TagInput value={form.tone_descriptors} onChange={v => set('tone_descriptors', v)} placeholder="bold, witty, warm…" />
            </label>
            <label>Writing Style Notes
              <textarea rows={3} value={form.writing_style_notes} onChange={e => set('writing_style_notes', e.target.value)}
                placeholder="Short punchy sentences. Use contractions. No corporate speak." />
            </label>
            <label>Signature Phrases
              <TagInput value={form.signature_phrases} onChange={v => set('signature_phrases', v)} placeholder="Move different…" />
            </label>
            <label>Forbidden Phrases
              <TagInput value={form.forbidden_phrases} onChange={v => set('forbidden_phrases', v)} placeholder="synergy, leverage…" />
            </label>
            <label>Emoji Usage</label>
            <div className="bk-button-group">
              {EMOJIS.map(e => (
                <button key={e} type="button"
                  className={`bk-pill${form.emoji_usage === e ? ' active' : ''}`}
                  onClick={() => set('emoji_usage', e)}>
                  {e.charAt(0).toUpperCase() + e.slice(1)}
                </button>
              ))}
            </div>
            <label>Call to Action Style
              <select value={form.call_to_action_style} onChange={e => set('call_to_action_style', e.target.value)}>
                <option value="">Select…</option>
                {CTA_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        )}

        {activeTab === 'Guardrails' && (
          <div className="bk-fields">
            <label>Content Restrictions
              <TagInput value={form.content_restrictions} onChange={v => set('content_restrictions', v)} placeholder="politics, religion…" />
            </label>
            <label>Competitor Names (never mention)
              <TagInput value={form.competitor_names} onChange={v => set('competitor_names', v)} placeholder="CompetitorX…" />
            </label>
            <label>Legal Disclaimers
              <textarea rows={3} value={form.legal_disclaimers} onChange={e => set('legal_disclaimers', e.target.value)}
                placeholder="Required boilerplate text for all captions…" />
            </label>
            <label className="bk-toggle-row">
              <span>Brand Safe Only</span>
              <input type="checkbox" checked={form.brand_safe_only} onChange={e => set('brand_safe_only', e.target.checked)} />
            </label>
            <label>Min Caption Words
              <input type="number" min={0} max={500} value={form.min_caption_words}
                onChange={e => set('min_caption_words', Number(e.target.value))} />
            </label>
            <label>Max Caption Words
              <input type="number" min={0} max={1000} value={form.max_caption_words}
                onChange={e => set('max_caption_words', Number(e.target.value))} />
            </label>
            <label>Max Hashtags
              <input type="number" min={0} max={30} value={form.max_hashtags}
                onChange={e => set('max_hashtags', Number(e.target.value))} />
            </label>
          </div>
        )}

        {activeTab === 'Visual Style' && (
          <div className="bk-fields">
            <label>Visual Style Keywords
              <TagInput value={form.visual_style_keywords} onChange={v => set('visual_style_keywords', v)} placeholder="minimal, dark, vibrant…" />
            </label>
            <label>Color Palette</label>
            <ColorPaletteEditor value={form.color_palette} onChange={v => set('color_palette', v)} />
            <label>Typography Notes
              <textarea rows={2} value={form.typography_notes} onChange={e => set('typography_notes', e.target.value)}
                placeholder="Bold headlines. Sans-serif. White on dark." />
            </label>
            <label>Photo Style Notes
              <textarea rows={2} value={form.photo_style_notes} onChange={e => set('photo_style_notes', e.target.value)}
                placeholder="Bright, lifestyle, authentic. No stock-photo feel." />
            </label>
            <label>Avoid Visual Elements
              <TagInput value={form.avoid_visual_elements} onChange={v => set('avoid_visual_elements', v)} placeholder="clipart, text overlays…" />
            </label>
          </div>
        )}

        {activeTab === 'Assets' && userId && brandKitId && (
          <AssetUploader userId={userId} brandKitId={brandKitId} />
        )}

        {activeTab === 'Assets' && (!userId || !brandKitId) && (
          <p className="bk-notice">Save your brand kit basics first to unlock asset uploads.</p>
        )}
      </div>

      {activeTab !== 'Assets' && (
        <div className="bk-form-footer">
          <button
            className="bk-btn-primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save Brand Kit'}
          </button>
        </div>
      )}
    </div>
  );
}
