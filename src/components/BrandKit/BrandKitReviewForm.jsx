import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck } from 'lucide-react';
import useBrandKitStore from '../../stores/BrandKitStore';
import AssetUploader from './AssetUploader';
import BrandKitSaveWarning from './BrandKitSaveWarning';
import { TIER_1_FIELDS, getMissingTier1Fields, isFilled } from '../../utils/brandKitValidation';
import { fieldProvenance, PROVENANCE } from '../../utils/brandProvenance';
import { contrastRatio as contrastOf, MIN_TEXT_CONTRAST } from '../../utils/wcagContrast';
import { normalizeDesignForSave } from '../../utils/brandDesignClient';
import { Button } from '../../ui-v2';
import styles from './BrandKit.module.css';

const VOICES = ['professional', 'playful', 'authoritative', 'conversational', 'inspirational', 'edgy'];
const EMOJIS = ['none', 'minimal', 'moderate', 'heavy'];
const CTA_STYLES = ['question-based', 'imperative', 'soft'];
const INDUSTRIES = ['Fashion', 'Tech', 'Food and Bev', 'Health and Wellness', 'Finance', 'Creative Agency', 'Other'];
const LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'zh'];

const TAB_CONFIG = [
  {
    key: 'Basics',
    fields: ['kit_name', 'brand_name', 'industry', 'tagline', 'website_url', 'target_audience', 'audience_age_range', 'audience_locations', 'primary_language'],
    description: 'Core identity and audience fit.',
  },
  {
    key: 'Voice',
    fields: ['brand_voice', 'tone_descriptors', 'writing_style_notes', 'signature_phrases', 'forbidden_phrases', 'emoji_usage', 'call_to_action_style'],
    description: 'How your brand should sound.',
  },
  {
    key: 'Guardrails',
    fields: ['content_restrictions', 'competitor_names', 'legal_disclaimers', 'brand_safe_only', 'min_caption_words', 'max_caption_words', 'max_hashtags'],
    description: 'Safety boundaries and constraints.',
  },
  {
    key: 'Visual Style',
    fields: ['visual_style_keywords', 'color_palette', 'font_display', 'font_body', 'typography_notes', 'photo_style_notes', 'avoid_visual_elements'],
    description: 'Visual system and creative cues.',
  },
  {
    key: 'Design',
    fields: ['color_roles', 'type_scale', 'logo_rules', 'layout_rules', 'contact_block', 'social_handles', 'required_marks', 'imagery_rules'],
    description: 'What a renderer needs: which colour is the button, how the type is set, and what must appear on every asset.',
  },
  {
    key: 'Assets',
    fields: [],
    description: 'Upload files used in generation.',
  },
];

function normalizeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  return String(value);
}

function normalizeTagArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        return normalizeTagArray(JSON.parse(trimmed));
      } catch (_err) { /* fall through to delimiter split */ }
    }
    return trimmed.split(/[,\n;]+/).map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function isHexColor(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test((value || '').trim());
}

function normalizeColorPalette(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === 'string') {
        const token = entry.trim();
        if (!token) return null;
        return { hex: isHexColor(token) ? token : '#6366f1', name: isHexColor(token) ? '' : token, usage: '' };
      }
      if (entry && typeof entry === 'object') {
        const hexCandidate = typeof entry.hex === 'string' ? entry.hex.trim() : '';
        return {
          hex: isHexColor(hexCandidate) ? hexCandidate : '#6366f1',
          name: normalizeText(entry.name).trim(),
          usage: normalizeText(entry.usage).trim(),
        };
      }
      return null;
    }).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        return normalizeColorPalette(JSON.parse(trimmed));
      } catch (_err) { return []; }
    }
    return normalizeColorPalette(trimmed.split(/[,\n;]+/));
  }
  return [];
}

function normalizeFontPair(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { family: normalizeText(value.family).trim(), style: normalizeText(value.style).trim() };
  }
  return { family: '', style: '' };
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !trimmed.startsWith('{')) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_err) { return {}; }
  }
  return {};
}

function toFormState(initialData = {}) {
  return {
    kit_name: normalizeText(initialData.kit_name),
    brand_name: normalizeText(initialData.brand_name),
    industry: normalizeText(initialData.industry),
    tagline: normalizeText(initialData.tagline),
    website_url: normalizeText(initialData.website_url),
    primary_language: normalizeText(initialData.primary_language || 'en'),
    target_audience: normalizeText(initialData.target_audience),
    audience_age_range: normalizeText(initialData.audience_age_range),
    audience_locations: normalizeTagArray(initialData.audience_locations),
    brand_voice: normalizeText(initialData.brand_voice),
    tone_descriptors: normalizeTagArray(initialData.tone_descriptors),
    writing_style_notes: normalizeText(initialData.writing_style_notes),
    signature_phrases: normalizeTagArray(initialData.signature_phrases),
    forbidden_phrases: normalizeTagArray(initialData.forbidden_phrases),
    emoji_usage: normalizeText(initialData.emoji_usage || 'moderate'),
    call_to_action_style: normalizeText(initialData.call_to_action_style),
    content_restrictions: normalizeTagArray(initialData.content_restrictions),
    competitor_names: normalizeTagArray(initialData.competitor_names),
    legal_disclaimers: normalizeText(initialData.legal_disclaimers),
    brand_safe_only: normalizeBoolean(initialData.brand_safe_only, true),
    min_caption_words: normalizeNumber(initialData.min_caption_words, 20),
    max_caption_words: normalizeNumber(initialData.max_caption_words, 300),
    max_hashtags: normalizeNumber(initialData.max_hashtags, 30),
    visual_style_keywords: normalizeTagArray(initialData.visual_style_keywords),
    color_palette: normalizeColorPalette(initialData.color_palette),
    font_display: normalizeFontPair(initialData.font_display),
    font_body: normalizeFontPair(initialData.font_body),
    typography_notes: normalizeText(initialData.typography_notes),
    photo_style_notes: normalizeText(initialData.photo_style_notes),
    avoid_visual_elements: normalizeTagArray(initialData.avoid_visual_elements),
    platform_preferences: normalizeObject(initialData.platform_preferences),

    // Design layer (migration 20260901120000). Pre-filled by the site harvester
    // and editable here; empty objects when the kit predates it, which every
    // editor below renders as an honest "not set yet" rather than a fake value.
    color_roles: normalizeObject(initialData.color_roles),
    type_scale: normalizeObject(initialData.type_scale),
    logo_rules: normalizeObject(initialData.logo_rules),
    layout_rules: normalizeObject(initialData.layout_rules),
    contact_block: normalizeObject(initialData.contact_block),
    social_handles: normalizeObject(initialData.social_handles),
    required_marks: normalizeObject(initialData.required_marks),
    imagery_rules: normalizeObject(initialData.imagery_rules),
  };
}

// Roles in the order a designer reads them: the ground, then what sits on it,
// then the thing that asks for a click.
const COLOR_ROLE_ORDER = [
  ['background', 'Background', 'The page ground most of the design sits on'],
  ['surface', 'Surface', 'Cards and panels raised off the background'],
  ['text_primary', 'Text', 'Headlines and body copy'],
  ['text_secondary', 'Muted text', 'Captions and supporting lines'],
  ['accent', 'Accent', 'The colour that is unmistakably this brand'],
  ['cta_bg', 'Button', 'Behind a call to action'],
  ['cta_text', 'Button text', 'On top of the button'],
  ['border', 'Border', 'Hairlines and dividers'],
];

const SOCIAL_PLATFORMS = ['instagram', 'x', 'facebook', 'linkedin', 'tiktok', 'youtube'];


function TagInput({ value = [], onChange, placeholder }) {
  const tags = useMemo(() => normalizeTagArray(value), [value]);
  const [input, setInput] = useState('');

  const addTag = () => {
    const tag = input.trim();
    if (!tag || tags.includes(tag)) { setInput(''); return; }
    onChange([...tags, tag]);
    setInput('');
  };

  return (
    <div className={styles.tagInputWrapper}>
      {tags.map((tag) => (
        <span key={tag} className={styles.tagChip}>
          {tag}
          <button type="button" onClick={() => onChange(tags.filter((item) => item !== tag))}>×</button>
        </span>
      ))}
      <input
        className={styles.tagInputField}
        type="text"
        value={input}
        placeholder={placeholder}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(); }
        }}
      />
      <button className={styles.tagAddBtn} type="button" onClick={addTag}>Add</button>
    </div>
  );
}

function ColorPaletteEditor({ value = [], onChange }) {
  const colors = useMemo(() => normalizeColorPalette(value), [value]);

  const addColor = () => {
    if (colors.length >= 8) return;
    onChange([...colors, { hex: '#6366f1', name: '', usage: '' }]);
  };
  const updateColor = (index, field, nextValue) => {
    onChange(colors.map((color, idx) => (idx === index ? { ...color, [field]: nextValue } : color)));
  };

  return (
    <div className={styles.palette}>
      {colors.map((color, index) => (
        <div key={`${color.hex || ''}-${index}`} className={styles.paletteRow}>
          <input
            type="color"
            className={styles.colorSwatch}
            value={color.hex || '#6366f1'}
            onChange={(event) => updateColor(index, 'hex', event.target.value)}
          />
          <input
            className={styles.input}
            type="text"
            value={color.name || ''}
            placeholder="Color name"
            onChange={(event) => updateColor(index, 'name', event.target.value)}
          />
          <input
            className={styles.input}
            type="text"
            value={color.usage || ''}
            placeholder="Usage"
            onChange={(event) => updateColor(index, 'usage', event.target.value)}
          />
          <button className={styles.removeBtn} type="button" onClick={() => onChange(colors.filter((_, idx) => idx !== index))}>×</button>
        </div>
      ))}
      {colors.length < 8 && <Button variant="ghost" size="sm" type="button" onClick={addColor}>Add color</Button>}
    </div>
  );
}

/**
 * `provenance` comes from fieldProvenance() in src/utils/brandProvenance.js.
 *
 * This used to be `confidence === 'low' || confidence === 'inferred'` against a
 * value the extractor has always sent as a NUMBER, so the note below had never
 * rendered once. See the header of brandProvenance.js.
 */
function FieldShell({ label, hint, children, provenance, isTier1 = false }) {
  const source = provenance?.source;
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
        {isTier1 && <span className={styles.requiredDot} title="Important for AI quality" />}
        {source === PROVENANCE.MEASURED && (
          <span className={styles.provenanceChipMeasured} title={provenance.description}>
            <BadgeCheck size={11} aria-hidden="true" />
            Measured
          </span>
        )}
        {source === PROVENANCE.INFERRED && !provenance.needsReview && (
          <span className={styles.provenanceChipInferred} title={provenance.description}>
            AI inferred
          </span>
        )}
        {hint && <span className={styles.labelHint}>{hint}</span>}
      </label>
      {children}
      {provenance?.needsReview && (
        <p className={styles.confidenceNote}>
          <AlertTriangle size={11} aria-hidden="true" />
          {provenance.description}
        </p>
      )}
    </div>
  );
}

export default function BrandKitReviewForm({
  userId,
  onSaved,
  mode = 'manual',
  initialTab = 'Basics',
}) {
  const { brandKit, extractedDraft, saveBrandKit, isSaving } = useBrandKitStore();

  const [activeTab, setActiveTab] = useState(initialTab);
  const [showWarning, setShowWarning] = useState(false);
  const [pendingMissing, setPendingMissing] = useState([]);
  const [saveError, setSaveError] = useState(null);

  const confidenceMap = extractedDraft?.confidenceMap || {};
  // Provenance is read from the draft when the kit was just imported, and from
  // the saved kit afterwards — so a field stays labelled "Measured" after the
  // user saves, rather than silently reverting to looking like a guess.
  const extractionEvidence = extractedDraft?.brandKit?.extraction_evidence
    || brandKit?.extraction_evidence
    || {};
  const prov = (field) => fieldProvenance(field, { confidenceMap, extractionEvidence });
  const initialData = useMemo(
    () => ({ ...(brandKit || {}), ...(extractedDraft?.brandKit || {}) }),
    [brandKit, extractedDraft],
  );
  const [form, setForm] = useState(() => toFormState(initialData));

  useEffect(() => { setForm(toFormState(initialData)); }, [initialData]);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const tabMetrics = useMemo(() => TAB_CONFIG.map((tab) => {
    if (tab.key === 'Assets') return { key: tab.key, filled: 0, total: 0, missingCritical: [] };
    if (tab.key === 'Design') {
      // These are objects, and isFilled({}) is truthy — counting them the normal
      // way reports "8/8" for a kit with no design data at all, which is the
      // dashboard-lying-about-its-own-state defect in miniature.
      const filled = tab.fields.filter((field) => Object.keys(form[field] || {}).length > 0).length;
      return { key: tab.key, filled, total: tab.fields.length, missingCritical: [] };
    }
    const filled = tab.fields.filter((field) => isFilled(form[field])).length;
    const missingCritical = TIER_1_FIELDS.filter((field) => tab.fields.includes(field.key) && !isFilled(form[field.key]));
    return { key: tab.key, filled, total: tab.fields.length, missingCritical };
  }), [form]);

  const headerText = {
    extracted: "Review your Brand Kit — looks like we got most of it.",
    conversational: 'Review your Brand Kit — you are almost there.',
    manual: 'Build your Brand Kit',
  }[mode] || 'Build your Brand Kit';

  const saveNow = async () => {
    try {
      setSaveError(null);
      // The design layer rides on the draft, normalised server-side by
      // _shared/brandDesign.ts. Without this line the harvester measures a
      // brand's colour roles, type scale and contact block and then discards
      // them at the final step — the disconnection defect, one save away.
      const draftDesign = extractedDraft?.design || {};
      // The form holds whatever the user typed, including a half-finished hex.
      // normalizeDesignForSave drops what cannot be made valid rather than
      // correcting it to a guess — a silently substituted colour is a colour in
      // someone's brand that they never chose. Draft values come from the server
      // normaliser and are merged UNDER the form so an edit always wins.
      const design = normalizeDesignForSave({ ...draftDesign, ...form });
      const payload = {
        ...form,
        ...design,
        // Provenance is server-authored and has no editor, so it is carried
        // through from the draft rather than rebuilt from form state.
        ...(draftDesign.extraction_evidence
          ? { extraction_evidence: draftDesign.extraction_evidence }
          : {}),
        setup_completed: true,
        setup_skipped: false,
        design_setup_completed: Object.keys(design.color_roles || {}).length > 0,
      };
      await saveBrandKit(userId, payload);
      onSaved?.();
    } catch (err) {
      setSaveError(err?.message || 'Failed to save Brand Kit');
    }
  };

  const handleSubmit = async () => {
    const missing = getMissingTier1Fields(form);
    if (missing.length > 0) {
      setPendingMissing(missing);
      setShowWarning(true);
      return;
    }
    await saveNow();
  };

  const currentBrandKitId = brandKit?.id || null;

  const renderBasics = () => (
    <div className={styles.reviewSection}>
      <FieldShell label="Kit name" hint='e.g. "Summer 2026" — a label to tell your kits apart, separate from your brand name'>
        <input className={styles.input} type="text" value={form.kit_name} onChange={(event) => setField('kit_name', event.target.value)} placeholder="e.g. Main brand, Summer 2026" />
      </FieldShell>
      <FieldShell label="Brand Name" provenance={prov('brand_name')} isTier1>
        <input className={styles.input} type="text" value={form.brand_name} onChange={(event) => setField('brand_name', event.target.value)} />
      </FieldShell>
      <FieldShell label="Industry" provenance={prov('industry')}>
        <select className={styles.select} value={form.industry} onChange={(event) => setField('industry', event.target.value)}>
          <option value="">Select</option>
          {INDUSTRIES.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
        </select>
      </FieldShell>
      <FieldShell label="Tagline" provenance={prov('tagline')}>
        <input className={styles.input} type="text" value={form.tagline} onChange={(event) => setField('tagline', event.target.value)} />
      </FieldShell>
      <FieldShell label="Website URL" provenance={prov('website_url')}>
        <input className={styles.input} type="url" value={form.website_url} onChange={(event) => setField('website_url', event.target.value)} />
      </FieldShell>
      <FieldShell label="Target Audience" provenance={prov('target_audience')} isTier1>
        <textarea className={styles.textarea} rows={3} value={form.target_audience} onChange={(event) => setField('target_audience', event.target.value)} />
      </FieldShell>
      <FieldShell label="Audience Age Range" provenance={prov('audience_age_range')}>
        <input className={styles.input} type="text" value={form.audience_age_range} onChange={(event) => setField('audience_age_range', event.target.value)} />
      </FieldShell>
      <FieldShell label="Audience Locations" provenance={prov('audience_locations')}>
        <TagInput value={form.audience_locations} onChange={(value) => setField('audience_locations', value)} placeholder="Add location" />
      </FieldShell>
      <FieldShell label="Primary Language" provenance={prov('primary_language')}>
        <select className={styles.select} value={form.primary_language} onChange={(event) => setField('primary_language', event.target.value)}>
          {LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
        </select>
      </FieldShell>
    </div>
  );

  const renderVoice = () => (
    <div className={styles.reviewSection}>
      <FieldShell label="Brand Voice" provenance={prov('brand_voice')} isTier1>
        <div className={styles.pills}>
          {VOICES.map((voice) => (
            <button key={voice} className={[styles.pill, form.brand_voice === voice ? styles.pillActive : ''].filter(Boolean).join(' ')} type="button" onClick={() => setField('brand_voice', voice)}>
              {voice}
            </button>
          ))}
        </div>
      </FieldShell>
      <FieldShell label="Tone Descriptors" provenance={prov('tone_descriptors')}>
        <TagInput value={form.tone_descriptors} onChange={(value) => setField('tone_descriptors', value)} placeholder="Add tone" />
      </FieldShell>
      <FieldShell label="Writing Style Notes" provenance={prov('writing_style_notes')}>
        <textarea className={styles.textarea} rows={3} value={form.writing_style_notes} onChange={(event) => setField('writing_style_notes', event.target.value)} />
      </FieldShell>
      <FieldShell label="Signature Phrases" provenance={prov('signature_phrases')}>
        <TagInput value={form.signature_phrases} onChange={(value) => setField('signature_phrases', value)} placeholder="Add signature phrase" />
      </FieldShell>
      <FieldShell label="Forbidden Phrases" provenance={prov('forbidden_phrases')} isTier1>
        <TagInput value={form.forbidden_phrases} onChange={(value) => setField('forbidden_phrases', value)} placeholder="Add forbidden phrase" />
      </FieldShell>
      <FieldShell label="Emoji Usage" provenance={prov('emoji_usage')}>
        <div className={styles.pills}>
          {EMOJIS.map((emojiUsage) => (
            <button key={emojiUsage} className={[styles.pill, form.emoji_usage === emojiUsage ? styles.pillActive : ''].filter(Boolean).join(' ')} type="button" onClick={() => setField('emoji_usage', emojiUsage)}>
              {emojiUsage}
            </button>
          ))}
        </div>
      </FieldShell>
      <FieldShell label="Call to Action Style" provenance={prov('call_to_action_style')}>
        <select className={styles.select} value={form.call_to_action_style} onChange={(event) => setField('call_to_action_style', event.target.value)}>
          <option value="">Select</option>
          {CTA_STYLES.map((style) => <option key={style} value={style}>{style}</option>)}
        </select>
      </FieldShell>
    </div>
  );

  const renderGuardrails = () => (
    <div className={styles.reviewSection}>
      <FieldShell label="Content Restrictions" hint="topics/claims to avoid saying" provenance={prov('content_restrictions')} isTier1>
        <TagInput value={form.content_restrictions} onChange={(value) => setField('content_restrictions', value)} placeholder="Add restriction" />
      </FieldShell>
      <FieldShell label="Competitor Names" provenance={prov('competitor_names')}>
        <TagInput value={form.competitor_names} onChange={(value) => setField('competitor_names', value)} placeholder="Add competitor" />
      </FieldShell>
      <FieldShell label="Legal Disclaimers" provenance={prov('legal_disclaimers')}>
        <textarea className={styles.textarea} rows={3} value={form.legal_disclaimers} onChange={(event) => setField('legal_disclaimers', event.target.value)} />
      </FieldShell>
      <FieldShell label="Brand Safe Only" provenance={prov('brand_safe_only')}>
        <label className={styles.toggleLabel}>
          <input type="checkbox" checked={Boolean(form.brand_safe_only)} onChange={(event) => setField('brand_safe_only', event.target.checked)} />
          Only allow brand-safe generations
        </label>
      </FieldShell>
      <div className={styles.rangeRow}>
        <FieldShell label="Min Caption Words" provenance={prov('min_caption_words')}>
          <input className={[styles.input, styles.inputSm].join(' ')} type="number" min={0} max={500} value={form.min_caption_words} onChange={(event) => setField('min_caption_words', Number(event.target.value))} />
        </FieldShell>
        <FieldShell label="Max Caption Words" provenance={prov('max_caption_words')}>
          <input className={[styles.input, styles.inputSm].join(' ')} type="number" min={0} max={1000} value={form.max_caption_words} onChange={(event) => setField('max_caption_words', Number(event.target.value))} />
        </FieldShell>
        <FieldShell label="Max Hashtags" provenance={prov('max_hashtags')}>
          <input className={[styles.input, styles.inputSm].join(' ')} type="number" min={0} max={30} value={form.max_hashtags} onChange={(event) => setField('max_hashtags', Number(event.target.value))} />
        </FieldShell>
      </div>
    </div>
  );

  const renderVisual = () => (
    <div className={styles.reviewSection}>
      <FieldShell label="Visual Style Keywords" provenance={prov('visual_style_keywords')}>
        <TagInput value={form.visual_style_keywords} onChange={(value) => setField('visual_style_keywords', value)} placeholder="Add visual keyword" />
      </FieldShell>
      <FieldShell label="Color Palette" provenance={prov('color_palette')}>
        <ColorPaletteEditor value={form.color_palette} onChange={(value) => setField('color_palette', value)} />
      </FieldShell>
      <FieldShell label="Font pairing">
        <div className={styles.fontPairGrid}>
          <div className={styles.fontPairCard}>
            <span className={styles.fontPairLabel}>Display font</span>
            <input
              className={styles.input}
              type="text"
              placeholder="Family (e.g. Space Grotesk)"
              value={form.font_display?.family || ''}
              onChange={(event) => setField('font_display', { ...form.font_display, family: event.target.value })}
            />
            <input
              className={styles.input}
              type="text"
              placeholder="Style (e.g. Bold, 600)"
              value={form.font_display?.style || ''}
              onChange={(event) => setField('font_display', { ...form.font_display, style: event.target.value })}
            />
          </div>
          <div className={styles.fontPairCard}>
            <span className={styles.fontPairLabel}>Body font</span>
            <input
              className={styles.input}
              type="text"
              placeholder="Family (e.g. Inter)"
              value={form.font_body?.family || ''}
              onChange={(event) => setField('font_body', { ...form.font_body, family: event.target.value })}
            />
            <input
              className={styles.input}
              type="text"
              placeholder="Style (e.g. Regular, 400)"
              value={form.font_body?.style || ''}
              onChange={(event) => setField('font_body', { ...form.font_body, style: event.target.value })}
            />
          </div>
        </div>
      </FieldShell>
      <FieldShell label="Typography Notes" hint="free-text notes, in addition to the font pair above" provenance={prov('typography_notes')}>
        <textarea className={styles.textarea} rows={2} value={form.typography_notes} onChange={(event) => setField('typography_notes', event.target.value)} />
      </FieldShell>
      <FieldShell label="Photo Style Notes" provenance={prov('photo_style_notes')}>
        <textarea className={styles.textarea} rows={2} value={form.photo_style_notes} onChange={(event) => setField('photo_style_notes', event.target.value)} />
      </FieldShell>
      <FieldShell label="Things to avoid (visual)" hint="imagery/photo styles to avoid, e.g. stock photography" provenance={prov('avoid_visual_elements')}>
        <TagInput value={form.avoid_visual_elements} onChange={(value) => setField('avoid_visual_elements', value)} placeholder="Add visual element to avoid" />
      </FieldShell>
    </div>
  );

  const setNested = (group, key, value) => setForm((prev) => ({
    ...prev,
    [group]: { ...(prev[group] || {}), [key]: value },
  }));

  const roles = form.color_roles || {};
  const backgroundHex = roles.background?.hex || '';

  const renderDesign = () => (
    <div className={styles.reviewSection}>
      <FieldShell
        label="Colour roles"
        hint="which colour does what — a palette says a colour exists, a role says it is the button"
        provenance={prov('color_roles')}
      >
        <div className={styles.roleGrid}>
          {COLOR_ROLE_ORDER.map(([key, label, description]) => {
            const role = roles[key] || {};
            const hex = role.hex || '';
            const ratio = key === 'cta_text'
              ? contrastOf(hex, roles.cta_bg?.hex)
              : (key === 'background' ? null : contrastOf(hex, backgroundHex));
            const isTextRole = key === 'text_primary' || key === 'text_secondary' || key === 'cta_text';
            const fails = isTextRole && ratio !== null && ratio < MIN_TEXT_CONTRAST;

            return (
              <div key={key} className={styles.roleCard}>
                <span
                  className={styles.roleSwatch}
                  style={hex ? { background: hex } : undefined}
                  data-empty={hex ? undefined : 'true'}
                  aria-hidden="true"
                />
                <div className={styles.roleBody}>
                  <span className={styles.roleName}>
                    {label}
                    {role.source === 'measured' && (
                      <span className={styles.provenanceChipMeasured}>Measured</span>
                    )}
                  </span>
                  <span className={styles.roleDescription}>{description}</span>
                  <div className={styles.roleInputs}>
                    <input
                      className={styles.roleColorInput}
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'}
                      onChange={(event) => setNested('color_roles', key, { ...role, hex: event.target.value, source: 'user' })}
                      aria-label={`${label} colour`}
                    />
                    <input
                      className={styles.roleHexInput}
                      type="text"
                      value={hex}
                      placeholder="Not set"
                      spellCheck="false"
                      onChange={(event) => setNested('color_roles', key, { ...role, hex: event.target.value.trim(), source: 'user' })}
                      aria-label={`${label} hex value`}
                    />
                  </div>
                  {ratio !== null && (
                    <span className={fails ? styles.contrastFail : styles.contrastPass}>
                      {ratio}:1{fails ? ' — too low to read' : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className={styles.hint}>
          Contrast is measured against your background. Anything under 4.5:1 is not
          used for text — the renderer picks a legible colour instead.
        </p>
      </FieldShell>

      <FieldShell label="Type scale" hint="a family name alone is not enough to set a line" provenance={prov('type_scale')}>
        <div className={styles.fontPairGrid}>
          {['display', 'body'].map((role) => {
            const entry = (form.type_scale || {})[role] || {};
            return (
              <div key={role} className={styles.fontPairCard}>
                <span className={styles.fontPairLabel}>{role === 'display' ? 'Display' : 'Body'}</span>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="Family"
                  value={entry.family || ''}
                  onChange={(event) => setNested('type_scale', role, { ...entry, family: event.target.value })}
                />
                <select
                  className={styles.select}
                  value={String(entry.weight || (role === 'display' ? 700 : 400))}
                  onChange={(event) => setNested('type_scale', role, { ...entry, weight: Number(event.target.value) })}
                  aria-label={`${role} weight`}
                >
                  {[300, 400, 500, 600, 700, 800, 900].map((weight) => (
                    <option key={weight} value={weight}>{weight}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </FieldShell>

      <FieldShell label="Layout rules" hint="margins and limits the renderer must respect">
        <div className={styles.designGrid}>
          <label className={styles.designField}>
            <span className={styles.designFieldLabel}>Safe margin (%)</span>
            <input
              className={styles.input}
              type="number"
              min="0"
              max="25"
              value={form.layout_rules?.safe_margin_pct ?? 6}
              onChange={(event) => setNested('layout_rules', 'safe_margin_pct', Number(event.target.value))}
            />
          </label>
          <label className={styles.designField}>
            <span className={styles.designFieldLabel}>Max text lines</span>
            <input
              className={styles.input}
              type="number"
              min="1"
              max="12"
              value={form.layout_rules?.text_max_lines ?? 4}
              onChange={(event) => setNested('layout_rules', 'text_max_lines', Number(event.target.value))}
            />
          </label>
          <label className={styles.designField}>
            <span className={styles.designFieldLabel}>Text alignment</span>
            <select
              className={styles.select}
              value={form.layout_rules?.alignment || 'left'}
              onChange={(event) => setNested('layout_rules', 'alignment', event.target.value)}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
        </div>
      </FieldShell>

      <FieldShell label="Logo rules" hint="clear space is the most-violated brand rule in generated artwork">
        <div className={styles.designGrid}>
          <label className={styles.designField}>
            <span className={styles.designFieldLabel}>Clear space (× mark height)</span>
            <input
              className={styles.input}
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={form.logo_rules?.clear_space_ratio ?? 0.5}
              onChange={(event) => setNested('logo_rules', 'clear_space_ratio', Number(event.target.value))}
            />
          </label>
          <label className={styles.designField}>
            <span className={styles.designFieldLabel}>Minimum width (px)</span>
            <input
              className={styles.input}
              type="number"
              min="16"
              max="2048"
              value={form.logo_rules?.min_width_px ?? 96}
              onChange={(event) => setNested('logo_rules', 'min_width_px', Number(event.target.value))}
            />
          </label>
          <label className={styles.designField}>
            <span className={styles.designFieldLabel}>Preferred corner</span>
            <select
              className={styles.select}
              value={form.logo_rules?.preferred_corner || 'bottom-right'}
              onChange={(event) => setNested('logo_rules', 'preferred_corner', event.target.value)}
            >
              <option value="top-left">Top left</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
            </select>
          </label>
        </div>
      </FieldShell>

      <FieldShell
        label="Contact block"
        hint="what actually has to appear on a flyer"
        provenance={prov('contact_block')}
      >
        <div className={styles.designGrid}>
          {[['website', 'Website'], ['email', 'Email'], ['phone', 'Phone'], ['address', 'Address']].map(([key, label]) => (
            <label key={key} className={styles.designField}>
              <span className={styles.designFieldLabel}>{label}</span>
              <input
                className={styles.input}
                type="text"
                value={form.contact_block?.[key] || ''}
                onChange={(event) => setNested('contact_block', key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={Boolean(form.contact_block?.show_on_designs)}
            onChange={(event) => setNested('contact_block', 'show_on_designs', event.target.checked)}
          />
          <span>Print these details on generated designs</span>
        </label>
      </FieldShell>

      <FieldShell label="Social handles" provenance={prov('social_handles')}>
        <div className={styles.designGrid}>
          {SOCIAL_PLATFORMS.map((platform) => {
            const entry = (form.social_handles || {})[platform] || {};
            return (
              <label key={platform} className={styles.designField}>
                <span className={styles.designFieldLabel}>{platform}</span>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="@handle"
                  value={entry.handle || ''}
                  onChange={(event) => setNested('social_handles', platform, { ...entry, handle: event.target.value })}
                />
              </label>
            );
          })}
        </div>
      </FieldShell>

      <FieldShell
        label="Required marks"
        hint="a legal line that must appear on artwork — separate from the caption-side disclaimer"
      >
        <textarea
          className={styles.textarea}
          rows={2}
          placeholder="e.g. Drink responsibly. 18+."
          value={form.required_marks?.legal_line || ''}
          onChange={(event) => setNested('required_marks', 'legal_line', event.target.value)}
        />
      </FieldShell>

      <FieldShell label="Imagery rules" hint="what to photograph, and what never to show">
        <div className={styles.designStack}>
          <div>
            <span className={styles.designFieldLabel}>Subject matter</span>
            <TagInput
              value={form.imagery_rules?.subject_matter || []}
              onChange={(value) => setNested('imagery_rules', 'subject_matter', value)}
              placeholder="Add subject"
            />
          </div>
          <div>
            <span className={styles.designFieldLabel}>Never show</span>
            <TagInput
              value={form.imagery_rules?.never_show || []}
              onChange={(value) => setNested('imagery_rules', 'never_show', value)}
              placeholder="Add something to avoid"
            />
          </div>
          <label className={styles.designField}>
            <span className={styles.designFieldLabel}>People</span>
            <select
              className={styles.select}
              value={form.imagery_rules?.people || ''}
              onChange={(event) => setNested('imagery_rules', 'people', event.target.value)}
            >
              <option value="">No preference</option>
              <option value="real">Real people only</option>
              <option value="illustrated">Illustrated only</option>
              <option value="none">Never show people</option>
            </select>
          </label>
        </div>
      </FieldShell>
    </div>
  );

  const renderAssets = () => (
    <div className={styles.reviewSection}>
      {userId && currentBrandKitId ? (
        <AssetUploader userId={userId} brandKitId={currentBrandKitId} />
      ) : (
        <p className={styles.hint}>Save your Brand Kit once to enable asset uploads.</p>
      )}
    </div>
  );

  return (
    <>
      <div className={styles.reviewLayout}>
        <aside className={styles.reviewSidebar}>
          <h3 className={styles.reviewSidebarTitle}>Brand Kit Sections</h3>
          {TAB_CONFIG.map((tab) => {
            const metrics = tabMetrics.find((entry) => entry.key === tab.key);
            const hasWarning = Boolean(metrics?.missingCritical?.length);
            const meta = tab.key === 'Assets'
              ? 'Files and references'
              : hasWarning ? 'Missing critical' : `${metrics?.filled || 0}/${metrics?.total || 0} fields`;

            return (
              <button
                key={tab.key}
                className={[
                  styles.reviewTab,
                  activeTab === tab.key ? styles.reviewTabActive : '',
                  hasWarning ? styles.reviewTabWarning : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                <span className={styles.reviewTabLabel}>{tab.key}</span>
                <span className={styles.reviewTabMeta}>{meta}</span>
              </button>
            );
          })}
        </aside>

        <section className={styles.reviewPanel}>
          <div className={styles.reviewPanelHeader}>
            <div>
              <h2 className={styles.reviewPanelTitle}>{headerText}</h2>
              <p className={styles.reviewPanelDesc}>{TAB_CONFIG.find((tab) => tab.key === activeTab)?.description}</p>
            </div>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? 'Saving…' : (brandKit?.setup_completed ? 'Save changes' : 'Confirm and activate')}
            </Button>
          </div>

          {saveError && <div className={styles.errorBanner} role="alert">{saveError}</div>}

          {activeTab === 'Basics' && renderBasics()}
          {activeTab === 'Voice' && renderVoice()}
          {activeTab === 'Guardrails' && renderGuardrails()}
          {activeTab === 'Visual Style' && renderVisual()}
          {activeTab === 'Design' && renderDesign()}
          {activeTab === 'Assets' && renderAssets()}

          <p className={styles.reviewFooterNote}>
            Your progress is kept as you move between tabs — nothing is saved to your account until you submit.
          </p>
        </section>
      </div>

      {showWarning && (
        <BrandKitSaveWarning
          missingFields={pendingMissing}
          onDismiss={() => setShowWarning(false)}
          onComplete={async () => { setShowWarning(false); await saveNow(); }}
        />
      )}
    </>
  );
}
