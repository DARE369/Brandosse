"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bookmark,
  Image as ImageIcon,
  Lightbulb,
  Mic,
  Plus,
  Save,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { useOrgContext } from '../hooks/useOrgContext';
import { fetchOrganizationMembers } from '../services/orgService';
import { fetchOrgAssets } from '../services/assetLibraryService';
import {
  fetchOrgBrandKit,
  syncOrgBrandKitEditors,
  upsertOrgBrandKit,
} from '../services/brandKitService';
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toTextList(value) {
  return safeArray(value).map((entry) => String(entry || '').trim()).filter(Boolean);
}

function safeText(value) {
  return String(value ?? '').trim();
}

function createEmptyBrandKit(organizationName = '', brandProjectName = '') {
  return {
    brand_name: brandProjectName || organizationName || '',
    tagline: '',
    voice_description: '',
    tone_descriptors: [],
    content_pillars: [],
    target_audience: '',
    banned_phrases: [],
    approved_hashtag_sets: [],
    prompt_prefix: '',
    prompt_guidelines: '',
    primary_logo_asset_id: null,
    secondary_logo_asset_id: null,
    color_palette: [],
    typography_notes: '',
    visual_style_notes: '',
    completeness_score: 0,
    last_edited_by: null,
    updated_at: null,
  };
}

function normalizeBrandKit(brandKit, organizationName = '', brandProjectName = '') {
  return {
    ...createEmptyBrandKit(organizationName, brandProjectName),
    ...(brandKit || {}),
    brand_name: safeText(brandKit?.brand_name) || (brandProjectName || organizationName || ''),
    tagline: safeText(brandKit?.tagline),
    voice_description: safeText(brandKit?.voice_description),
    target_audience: safeText(brandKit?.target_audience),
    prompt_prefix: safeText(brandKit?.prompt_prefix),
    prompt_guidelines: safeText(brandKit?.prompt_guidelines),
    typography_notes: safeText(brandKit?.typography_notes),
    visual_style_notes: safeText(brandKit?.visual_style_notes),
    tone_descriptors: toTextList(brandKit?.tone_descriptors),
    content_pillars: toTextList(brandKit?.content_pillars),
    banned_phrases: toTextList(brandKit?.banned_phrases),
    approved_hashtag_sets: safeArray(brandKit?.approved_hashtag_sets).map((entry) => ({
      name: safeText(entry?.name),
      platform: safeText(entry?.platform),
      hashtags: toTextList(entry?.hashtags),
    })),
    color_palette: safeArray(brandKit?.color_palette).map((entry) => ({
      name: safeText(entry?.name),
      hex: safeText(entry?.hex),
      role: safeText(entry?.role),
    })),
  };
}

function formatRelativeTime(value) {
  if (!value) return 'Not edited yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not edited yet';

  const diffMinutes = Math.floor((Date.now() - parsed.getTime()) / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return parsed.toLocaleDateString();
}

function buildInputValue(list = []) {
  return safeArray(list).join(', ');
}

function parseInputValue(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function SectionHeader({ icon: Icon, title, canEdit, editing, onEdit, saving }) {
  return (
    <div className="org-brand-kit-section-header">
      <div className="org-brand-kit-section-title">
        <Icon size={18} />
        <h3>{title}</h3>
      </div>

      {canEdit ? (
        editing ? (
          <span className="org-brand-kit-section-state">{saving ? 'Saving…' : 'Editing'}</span>
        ) : (
          <button type="button" className="org-text-button" onClick={onEdit}>
            Edit
          </button>
        )
      ) : null}
    </div>
  );
}

function StatRing({ value = 0 }) {
  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  let tone = 'low';
  if (safeValue >= 70) tone = 'high';
  else if (safeValue >= 40) tone = 'medium';

  return (
    <div className={`org-brand-kit-score tone-${tone}`}>
      <div
        className="org-brand-kit-score-ring"
        style={{ '--brand-kit-score': `${safeValue}%` }}
      />
      <div className="org-brand-kit-score-copy">
        <strong>{safeValue}%</strong>
        <span>Kit Completeness</span>
      </div>
    </div>
  );
}

function AssetPreview({ asset, emptyLabel }) {
  if (!asset?.thumbnail_url && !asset?.file_url) {
    return (
      <div className="org-brand-kit-asset-empty">
        <ImageIcon size={18} />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="org-brand-kit-logo-thumb">
      <img src={asset.thumbnail_url || asset.file_url} alt={asset.name || emptyLabel} />
    </div>
  );
}

function HashtagSetEditor({ value = [], onChange }) {
  const sets = safeArray(value);

  const updateRow = (index, nextRow) => {
    onChange(sets.map((entry, entryIndex) => (entryIndex === index ? nextRow : entry)));
  };

  const addRow = () => {
    onChange([
      ...sets,
      { name: '', platform: '', hashtags: [] },
    ]);
  };

  const removeRow = (index) => {
    onChange(sets.filter((_, entryIndex) => entryIndex !== index));
  };

  return (
    <div className="org-brand-kit-stack">
      {sets.map((entry, index) => (
        <div key={`${entry.name || 'set'}-${index}`} className="org-brand-kit-inline-grid">
          <input
            type="text"
            value={safeText(entry.name)}
            placeholder="Set name"
            onChange={(event) => updateRow(index, { ...entry, name: event.target.value })}
          />
          <input
            type="text"
            value={safeText(entry.platform)}
            placeholder="Platform"
            onChange={(event) => updateRow(index, { ...entry, platform: event.target.value })}
          />
          <input
            type="text"
            value={buildInputValue(entry.hashtags)}
            placeholder="#tag1, #tag2"
            onChange={(event) => updateRow(index, { ...entry, hashtags: parseInputValue(event.target.value) })}
          />
          <button type="button" className="org-icon-button subtle small" onClick={() => removeRow(index)} aria-label="Remove hashtag set">
            <X size={14} />
          </button>
        </div>
      ))}

      <button type="button" className="org-text-button" onClick={addRow}>
        <Plus size={14} />
        Add Hashtag Set
      </button>
    </div>
  );
}

function ColorPaletteEditor({ value = [], onChange }) {
  const palette = safeArray(value);

  const updateRow = (index, nextRow) => {
    onChange(palette.map((entry, entryIndex) => (entryIndex === index ? nextRow : entry)));
  };

  const addRow = () => {
    onChange([
      ...palette,
      { name: '', hex: '#6366F1', role: 'primary' },
    ]);
  };

  const removeRow = (index) => {
    onChange(palette.filter((_, entryIndex) => entryIndex !== index));
  };

  return (
    <div className="org-brand-kit-stack">
      {palette.map((entry, index) => (
        <div key={`${entry.name || 'color'}-${index}`} className="org-brand-kit-inline-grid color">
          <input
            type="text"
            value={safeText(entry.name)}
            placeholder="Color name"
            onChange={(event) => updateRow(index, { ...entry, name: event.target.value })}
          />
          <input
            type="color"
            value={safeText(entry.hex) || '#6366F1'}
            onChange={(event) => updateRow(index, { ...entry, hex: event.target.value })}
          />
          <input
            type="text"
            value={safeText(entry.hex)}
            placeholder="#6366F1"
            onChange={(event) => updateRow(index, { ...entry, hex: event.target.value })}
          />
          <select
            value={safeText(entry.role) || 'primary'}
            onChange={(event) => updateRow(index, { ...entry, role: event.target.value })}
          >
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="accent">Accent</option>
            <option value="neutral">Neutral</option>
          </select>
          <button type="button" className="org-icon-button subtle small" onClick={() => removeRow(index)} aria-label="Remove color">
            <X size={14} />
          </button>
        </div>
      ))}

      <button type="button" className="org-text-button" onClick={addRow}>
        <Plus size={14} />
        Add Color
      </button>
    </div>
  );
}

function EditorAccessCard({
  visible,
  members,
  selectedEditorIds,
  onToggle,
  onSave,
  saving,
}) {
  if (!visible) return null;

  return (
    <article className="org-brand-kit-card editor-access">
      <SectionHeader icon={Users} title="Editing Access" canEdit={false} />
      <p className="org-brand-kit-muted">
        Grant non-admin members permission to edit the brand kit without giving them broader organization admin access.
      </p>

      <div className="org-brand-kit-editor-grid">
        {members.map((member) => {
          const label = member.profile?.full_name || member.profile?.email || member.userId;
          const checked = selectedEditorIds.includes(member.userId);

          return (
            <label key={member.userId} className="org-brand-kit-editor-row">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(member.userId)}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>

      <div className="org-brand-kit-section-actions">
        <button type="button" className="org-primary-button" onClick={onSave} disabled={saving}>
          <Save size={14} />
          {saving ? 'Saving Access…' : 'Save Access'}
        </button>
      </div>
    </article>
  );
}

export default function BrandKitPage() {
  const { navigate } = useAppNavigation();
  const { user } = useAuth();
  const {
    organization,
    organizationId,
    activeBrandProject,
    isOrgAdmin,
  } = useOrgContext();

  const [brandKit, setBrandKit] = useState(null);
  const [editors, setEditors] = useState([]);
  const [members, setMembers] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState('');
  const [savingSection, setSavingSection] = useState('');
  const [draft, setDraft] = useState(() => createEmptyBrandKit());
  const [selectedEditorIds, setSelectedEditorIds] = useState([]);

  const loadData = async () => {
    if (!organizationId || !activeBrandProject?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [{ brandKit: nextBrandKit, editors: nextEditors }, nextMembers, nextAssets] = await Promise.all([
        fetchOrgBrandKit({
          organizationId,
          brandProjectId: activeBrandProject.id,
        }),
        fetchOrganizationMembers(organizationId),
        fetchOrgAssets({
          organizationId,
          brandProjectId: activeBrandProject.id,
          includeArchived: false,
        }),
      ]);

      setBrandKit(nextBrandKit);
      setEditors(nextEditors);
      setMembers(nextMembers);
      setAssets(nextAssets);
      setDraft(normalizeBrandKit(nextBrandKit, organization?.name, activeBrandProject?.name));
      setSelectedEditorIds(nextEditors.map((entry) => entry.user_id));
    } catch (error) {
      console.error('Failed to load org brand kit:', error);
      toast.error(error?.message || 'Could not load the brand kit.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [activeBrandProject?.id, organization?.name, organizationId]);

  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );

  const selectedPrimaryLogo = useMemo(
    () => assets.find((asset) => asset.id === draft.primary_logo_asset_id) || null,
    [assets, draft.primary_logo_asset_id],
  );

  const selectedSecondaryLogo = useMemo(
    () => assets.find((asset) => asset.id === draft.secondary_logo_asset_id) || null,
    [assets, draft.secondary_logo_asset_id],
  );

  const brandAssets = useMemo(
    () => assets.filter((asset) => asset.is_brand_asset),
    [assets],
  );

  const selectableLogoAssets = useMemo(
    () => assets.filter((asset) => asset.file_type === 'image' || asset.is_brand_asset),
    [assets],
  );

  const lastEditedByLabel = useMemo(() => {
    const match = memberMap.get(brandKit?.last_edited_by);
    return match?.profile?.full_name || match?.profile?.email || 'Unknown';
  }, [brandKit?.last_edited_by, memberMap]);

  const canEdit = useMemo(
    () => Boolean(isOrgAdmin || editors.some((entry) => entry.user_id === user?.id)),
    [editors, isOrgAdmin, user?.id],
  );

  const resetDraft = () => {
    setDraft(normalizeBrandKit(brandKit, organization?.name, activeBrandProject?.name));
    setEditingSection('');
  };

  const saveSection = async (sectionKey, fields) => {
    if (!organizationId || !activeBrandProject?.id || !canEdit) return;

    setSavingSection(sectionKey);
    try {
      await upsertOrgBrandKit({
        organizationId,
        brandProjectId: activeBrandProject.id,
        fields,
      });

      toast.success('Brand kit updated.');
      setEditingSection('');
      await loadData();
    } catch (error) {
      toast.error(error?.message || 'Could not save this section.');
    } finally {
      setSavingSection('');
    }
  };

  const handleToggleEditor = (userId) => {
    setSelectedEditorIds((current) => (
      current.includes(userId)
        ? current.filter((entry) => entry !== userId)
        : [...current, userId]
    ));
  };

  const handleSaveEditors = async () => {
    if (!isOrgAdmin || !brandKit?.id || !user?.id) return;

    setSavingSection('editors');
    try {
      await syncOrgBrandKitEditors({
        brandKitId: brandKit.id,
        editorUserIds: selectedEditorIds,
        grantedBy: user.id,
      });
      toast.success('Editor access updated.');
      await loadData();
    } catch (error) {
      toast.error(error?.message || 'Could not update brand kit editors.');
    } finally {
      setSavingSection('');
    }
  };

  const score = brandKit?.completeness_score || draft.completeness_score || 0;

  if (loading) {
    return (
      <section className="org-page org-brand-kit-page">
        <div className="org-panel-loading">Loading brand kit…</div>
      </section>
    );
  }

  return (
    <section className="org-page org-brand-kit-page">
      <div className="org-brand-kit-header">
        <div className="org-brand-kit-header-copy">
          <span className="org-brand-kit-kicker">Brand Kit</span>
          <h1>Brand Kit</h1>
          <div className="org-brand-kit-badge-row">
            <span className="org-brand-kit-project-badge">{activeBrandProject?.name || 'Brand project'}</span>
            <span className="org-brand-kit-muted">
              Last edited by {lastEditedByLabel} {formatRelativeTime(brandKit?.updated_at)}
            </span>
          </div>
        </div>

        <StatRing value={score} />
      </div>

      <EditorAccessCard
        visible={isOrgAdmin}
        members={members.filter((member) => !['org_owner', 'org_admin'].includes(member.roleKey || member.role))}
        selectedEditorIds={selectedEditorIds}
        onToggle={handleToggleEditor}
        onSave={handleSaveEditors}
        saving={savingSection === 'editors'}
      />

      <article className="org-brand-kit-card">
        <SectionHeader
          icon={Bookmark}
          title="Brand Identity"
          canEdit={canEdit}
          editing={editingSection === 'identity'}
          onEdit={() => setEditingSection('identity')}
          saving={savingSection === 'identity'}
        />

        {editingSection === 'identity' ? (
          <>
            <div className="org-brand-kit-form-grid">
              <label className="org-field-group">
                <span>Brand Name</span>
                <input
                  type="text"
                  value={draft.brand_name}
                  onChange={(event) => setDraft((current) => ({ ...current, brand_name: event.target.value }))}
                />
              </label>

              <label className="org-field-group">
                <span>Tagline</span>
                <input
                  type="text"
                  value={draft.tagline}
                  onChange={(event) => setDraft((current) => ({ ...current, tagline: event.target.value }))}
                />
              </label>

              <label className="org-field-group">
                <span>Primary Logo</span>
                <select
                  value={draft.primary_logo_asset_id || ''}
                  onChange={(event) => setDraft((current) => ({ ...current, primary_logo_asset_id: event.target.value || null }))}
                >
                  <option value="">No logo selected</option>
                  {selectableLogoAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="org-brand-kit-section-actions">
              <button type="button" className="org-primary-button" onClick={() => saveSection('identity', {
                brand_name: draft.brand_name,
                tagline: draft.tagline,
                primary_logo_asset_id: draft.primary_logo_asset_id,
              })} disabled={savingSection === 'identity'}>
                <Save size={14} />
                Save
              </button>
              <button type="button" className="org-text-button" onClick={resetDraft}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="org-brand-kit-identity">
            <div>
              <h2>{draft.brand_name || activeBrandProject?.name || 'Brand name not set'}</h2>
              <p>{draft.tagline || 'No tagline set yet.'}</p>
            </div>
            <AssetPreview asset={selectedPrimaryLogo} emptyLabel="No primary logo" />
          </div>
        )}
      </article>

      <article className="org-brand-kit-card">
        <SectionHeader
          icon={Mic}
          title="Voice & Tone"
          canEdit={canEdit}
          editing={editingSection === 'voice'}
          onEdit={() => setEditingSection('voice')}
          saving={savingSection === 'voice'}
        />

        {editingSection === 'voice' ? (
          <>
            <div className="org-brand-kit-form-grid single">
              <label className="org-field-group">
                <span>Voice Description</span>
                <textarea
                  rows={4}
                  value={draft.voice_description}
                  onChange={(event) => setDraft((current) => ({ ...current, voice_description: event.target.value }))}
                />
              </label>
              <label className="org-field-group">
                <span>Tone Descriptors</span>
                <input
                  type="text"
                  value={buildInputValue(draft.tone_descriptors)}
                  placeholder="bold, witty, authoritative"
                  onChange={(event) => setDraft((current) => ({ ...current, tone_descriptors: parseInputValue(event.target.value) }))}
                />
              </label>
              <label className="org-field-group">
                <span>Content Pillars</span>
                <input
                  type="text"
                  value={buildInputValue(draft.content_pillars)}
                  placeholder="campaigns, launches, community"
                  onChange={(event) => setDraft((current) => ({ ...current, content_pillars: parseInputValue(event.target.value) }))}
                />
              </label>
              <label className="org-field-group">
                <span>Target Audience</span>
                <input
                  type="text"
                  value={draft.target_audience}
                  onChange={(event) => setDraft((current) => ({ ...current, target_audience: event.target.value }))}
                />
              </label>
            </div>

            <div className="org-brand-kit-section-actions">
              <button type="button" className="org-primary-button" onClick={() => saveSection('voice', {
                voice_description: draft.voice_description,
                tone_descriptors: draft.tone_descriptors,
                content_pillars: draft.content_pillars,
                target_audience: draft.target_audience,
              })} disabled={savingSection === 'voice'}>
                <Save size={14} />
                Save
              </button>
              <button type="button" className="org-text-button" onClick={resetDraft}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="org-brand-kit-stack">
            <blockquote className="org-brand-kit-quote">
              {draft.voice_description || 'No voice description set yet.'}
            </blockquote>
            <div className="org-brand-kit-pill-group">
              {draft.tone_descriptors.length > 0 ? draft.tone_descriptors.map((entry) => (
                <span key={entry} className="org-brand-kit-pill tone">{entry}</span>
              )) : <span className="org-brand-kit-muted">No tone descriptors yet.</span>}
            </div>
            <div className="org-brand-kit-pill-group">
              {draft.content_pillars.length > 0 ? draft.content_pillars.map((entry) => (
                <span key={entry} className="org-brand-kit-pill pillar">{entry}</span>
              )) : <span className="org-brand-kit-muted">No content pillars yet.</span>}
            </div>
            <p className="org-brand-kit-audience">
              {draft.target_audience || 'No target audience set yet.'}
            </p>
          </div>
        )}
      </article>

      <article className="org-brand-kit-card">
        <SectionHeader
          icon={Lightbulb}
          title="Content Guidance"
          canEdit={canEdit}
          editing={editingSection === 'guidance'}
          onEdit={() => setEditingSection('guidance')}
          saving={savingSection === 'guidance'}
        />

        {editingSection === 'guidance' ? (
          <>
            <div className="org-brand-kit-form-grid single">
              <label className="org-field-group">
                <span>Prompt Prefix</span>
                <textarea
                  rows={3}
                  value={draft.prompt_prefix}
                  onChange={(event) => setDraft((current) => ({ ...current, prompt_prefix: event.target.value }))}
                />
              </label>
              <label className="org-field-group">
                <span>Prompt Guidelines</span>
                <textarea
                  rows={5}
                  value={draft.prompt_guidelines}
                  onChange={(event) => setDraft((current) => ({ ...current, prompt_guidelines: event.target.value }))}
                />
              </label>
              <label className="org-field-group">
                <span>Banned Phrases</span>
                <input
                  type="text"
                  value={buildInputValue(draft.banned_phrases)}
                  placeholder="cheap, guaranteed, overnight success"
                  onChange={(event) => setDraft((current) => ({ ...current, banned_phrases: parseInputValue(event.target.value) }))}
                />
              </label>
              <div className="org-field-group">
                <span>Approved Hashtag Sets</span>
                <HashtagSetEditor
                  value={draft.approved_hashtag_sets}
                  onChange={(nextValue) => setDraft((current) => ({ ...current, approved_hashtag_sets: nextValue }))}
                />
              </div>
            </div>

            <div className="org-brand-kit-section-actions">
              <button type="button" className="org-primary-button" onClick={() => saveSection('guidance', {
                prompt_prefix: draft.prompt_prefix,
                prompt_guidelines: draft.prompt_guidelines,
                banned_phrases: draft.banned_phrases,
                approved_hashtag_sets: draft.approved_hashtag_sets,
              })} disabled={savingSection === 'guidance'}>
                <Save size={14} />
                Save
              </button>
              <button type="button" className="org-text-button" onClick={resetDraft}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="org-brand-kit-stack">
            <div className="org-brand-kit-code-block">{draft.prompt_prefix || 'No prompt prefix configured yet.'}</div>
            <div className="org-brand-kit-guidance-copy">{draft.prompt_guidelines || 'No extended AI instructions configured yet.'}</div>
            <div className="org-brand-kit-pill-group">
              {draft.banned_phrases.length > 0 ? draft.banned_phrases.map((entry) => (
                <span key={entry} className="org-brand-kit-pill banned">{entry}</span>
              )) : <span className="org-brand-kit-muted">No banned phrases configured.</span>}
            </div>
            <div className="org-brand-kit-hashtag-list">
              {draft.approved_hashtag_sets.length > 0 ? draft.approved_hashtag_sets.map((entry, index) => (
                <div key={`${entry.name || entry.platform}-${index}`} className="org-brand-kit-hashtag-card">
                  <strong>{entry.name || 'Hashtag Set'}</strong>
                  <span>{entry.platform || 'All platforms'}</span>
                  <div className="org-brand-kit-pill-group">
                    {entry.hashtags.map((tag) => (
                      <span key={tag} className="org-brand-kit-pill neutral">{tag}</span>
                    ))}
                  </div>
                </div>
              )) : <span className="org-brand-kit-muted">No approved hashtag sets yet.</span>}
            </div>
          </div>
        )}
      </article>

      <article className="org-brand-kit-card">
        <SectionHeader
          icon={ImageIcon}
          title="Visual Identity"
          canEdit={canEdit}
          editing={editingSection === 'visual'}
          onEdit={() => setEditingSection('visual')}
          saving={savingSection === 'visual'}
        />

        {editingSection === 'visual' ? (
          <>
            <div className="org-brand-kit-form-grid single">
              <label className="org-field-group">
                <span>Secondary Logo</span>
                <select
                  value={draft.secondary_logo_asset_id || ''}
                  onChange={(event) => setDraft((current) => ({ ...current, secondary_logo_asset_id: event.target.value || null }))}
                >
                  <option value="">No logo selected</option>
                  {selectableLogoAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
              </label>
              <div className="org-field-group">
                <span>Color Palette</span>
                <ColorPaletteEditor
                  value={draft.color_palette}
                  onChange={(nextValue) => setDraft((current) => ({ ...current, color_palette: nextValue }))}
                />
              </div>
              <label className="org-field-group">
                <span>Typography Notes</span>
                <textarea
                  rows={3}
                  value={draft.typography_notes}
                  onChange={(event) => setDraft((current) => ({ ...current, typography_notes: event.target.value }))}
                />
              </label>
              <label className="org-field-group">
                <span>Visual Style Notes</span>
                <textarea
                  rows={4}
                  value={draft.visual_style_notes}
                  onChange={(event) => setDraft((current) => ({ ...current, visual_style_notes: event.target.value }))}
                />
              </label>
            </div>

            <div className="org-brand-kit-section-actions">
              <button type="button" className="org-primary-button" onClick={() => saveSection('visual', {
                secondary_logo_asset_id: draft.secondary_logo_asset_id,
                color_palette: draft.color_palette,
                typography_notes: draft.typography_notes,
                visual_style_notes: draft.visual_style_notes,
              })} disabled={savingSection === 'visual'}>
                <Save size={14} />
                Save
              </button>
              <button type="button" className="org-text-button" onClick={resetDraft}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="org-brand-kit-stack">
            <div className="org-brand-kit-logo-row">
              <AssetPreview asset={selectedPrimaryLogo} emptyLabel="No primary logo" />
              <AssetPreview asset={selectedSecondaryLogo} emptyLabel="No secondary logo" />
            </div>
            <div className="org-brand-kit-color-row">
              {draft.color_palette.length > 0 ? draft.color_palette.map((entry, index) => (
                <div key={`${entry.name || entry.hex}-${index}`} className="org-brand-kit-color-card">
                  <span className="org-brand-kit-color-dot" style={{ background: entry.hex || 'var(--color-primary)' }} />
                  <strong>{entry.name || entry.role || 'Color'}</strong>
                  <small>{entry.hex || 'No hex'}</small>
                </div>
              )) : <span className="org-brand-kit-muted">No palette configured yet.</span>}
            </div>
            <p>{draft.typography_notes || 'No typography notes yet.'}</p>
            <p className="org-brand-kit-muted-emphasis">{draft.visual_style_notes || 'No visual style notes yet.'}</p>
          </div>
        )}
      </article>

      <article className="org-brand-kit-card">
        <SectionHeader icon={Archive} title="Brand Assets" canEdit={false} />
        <div className="org-brand-kit-asset-row">
          {brandAssets.length > 0 ? brandAssets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="org-brand-kit-asset-card"
              onClick={() => navigate(`/app/org/${organizationId}/library`)}
            >
              <AssetPreview asset={asset} emptyLabel={asset.name} />
              <span>{asset.name}</span>
            </button>
          )) : (
            <div className="org-brand-kit-muted">No brand assets are marked in the shared library yet.</div>
          )}
        </div>
        <div className="org-brand-kit-section-actions">
          <button type="button" className="org-text-button" onClick={() => navigate(`/app/org/${organizationId}/library`)}>
            View all brand assets in library
          </button>
        </div>
      </article>
    </section>
  );
}
