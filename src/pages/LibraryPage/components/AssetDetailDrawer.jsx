"use client";

// Asset detail drawer — net-new component the approved mockup requires
// (mockup-gallery.html #asset-drawer / #version-history). Built on the
// existing UiDrawer primitive (src/components/Shared/ui/UiPrimitives.jsx) —
// reused, not reinvented, per Master Brief §0 rule 5. Preview, inline-
// editable metadata, "Used in" list (deep-links into Calendar, spec §6/§7),
// version-history chain (superseded_by_asset_id, spec §6.2), and the
// Schedule / Delete footer actions.
import { useEffect, useState } from 'react';
import { FileImage, Film, FileText, ArrowRight, Sparkles } from 'lucide-react';
import { UiButton, UiDrawer } from '../../../components/Shared/ui';
import {
  getItemTitle,
  getSourceLabel,
  getFormatLabel,
  formatFileSize,
  formatDuration,
  formatDate,
} from '../libraryItemUtils';

function AssetPreview({ asset }) {
  const [failed, setFailed] = useState(false);
  const hasMedia = Boolean(asset.file_url && !failed);

  if (!hasMedia) {
    return (
      <div className="lib-drawer-media-preview">
        {asset.media_type === 'video' ? <Film size={28} /> : asset.media_type === 'document' ? <FileText size={28} /> : <FileImage size={28} />}
      </div>
    );
  }

  return (
    <div className="lib-drawer-media-preview">
      {asset.media_type === 'video' ? (
        <video src={asset.file_url} controls onError={() => setFailed(true)} />
      ) : (
        <img src={asset.file_url} alt={asset.alt_text || getItemTitle(asset)} onError={() => setFailed(true)} />
      )}
    </div>
  );
}

export default function AssetDetailDrawer({
  asset,
  open,
  onClose,
  onSaveMetadata,
  onSchedule,
  onDelete,
  onDuplicate,
  usedInPosts = [],
  versionChain = [],
  onOpenVersion,
  onNavigateToPost,
}) {
  const [form, setForm] = useState({ title: '', description: '', altText: '', tagsText: '' });
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!asset) return;
    setForm({
      title: asset.title || '',
      description: asset.description || '',
      altText: asset.alt_text || '',
      tagsText: Array.isArray(asset.tags) ? asset.tags.join(', ') : '',
    });
  }, [asset]);

  if (!asset) return null;

  const title = getItemTitle(asset);
  const aiTags = Array.isArray(asset.ai_tags) ? asset.ai_tags.filter(Boolean) : [];
  const userTags = Array.isArray(asset.tags) ? asset.tags.filter(Boolean) : [];

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveMetadata?.(asset.id, {
        title: form.title,
        description: form.description,
        alt_text: form.altText,
        tags: form.tagsText.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
    } finally {
      setSaving(false);
    }
  };

  return (
    <UiDrawer
      open={open}
      onClose={onClose}
      className="lib-drawer"
      title={(
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {title}
          <span className={`asset-card__source-badge source-${asset.source}`} style={{ position: 'static' }}>
            {getSourceLabel(asset)}
          </span>
        </span>
      )}
      footer={(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%' }}>
          <div className="lib-drawer__footer-row">
            <UiButton type="button" variant="secondary" size="sm" onClick={handleSave} loading={saving}>
              {savedFlash ? 'Saved' : 'Save changes'}
            </UiButton>
            <UiButton type="button" variant="primary" size="sm" onClick={() => onSchedule?.(asset)}>
              Schedule&hellip;
            </UiButton>
          </div>
          <div className="lib-drawer__footer-row">
            <UiButton type="button" variant="secondary" size="sm" onClick={() => onDuplicate?.(asset)}>
              Duplicate
            </UiButton>
            <UiButton type="button" variant="primary" tone="danger" size="sm" onClick={() => onDelete?.(asset)}>
              Delete
            </UiButton>
          </div>
        </div>
      )}
    >
      <div className="lib-drawer__section">
        <span className="lib-drawer__section-label">Preview</span>
        <AssetPreview asset={asset} />
      </div>

      <div className="lib-drawer__section">
        <span className="lib-drawer__section-label">Metadata (editable)</span>
        <div className="lib-meta-grid">
          <label className="ui-field">
            <span className="ui-field-label">Title</span>
            <input
              className="ui-input"
              type="text"
              value={form.title}
              onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
            />
          </label>
          <label className="ui-field">
            <span className="ui-field-label">Description</span>
            <textarea
              className="ui-textarea"
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            />
          </label>
          <label className="ui-field">
            <span className="ui-field-label">
              Alt text <span className="ui-field-hint">(AI-suggested, human-editable)</span>
            </span>
            <input
              className="ui-input"
              type="text"
              value={form.altText}
              onChange={(event) => setForm((f) => ({ ...f, altText: event.target.value }))}
            />
          </label>
          <label className="ui-field">
            <span className="ui-field-label">Tags <span className="ui-field-hint">(comma-separated)</span></span>
            <input
              className="ui-input"
              type="text"
              value={form.tagsText}
              onChange={(event) => setForm((f) => ({ ...f, tagsText: event.target.value }))}
            />
          </label>
          {(userTags.length > 0 || aiTags.length > 0) ? (
            <div className="ui-field">
              <span className="ui-field-label">Current tags</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {userTags.map((tag) => <span key={`t-${tag}`} className="asset-card__tag">{tag}</span>)}
                {aiTags.map((tag) => <span key={`a-${tag}`} className="asset-card__tag is-ai"><Sparkles size={10} aria-hidden="true" /> {tag}</span>)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="lib-drawer__section">
        <span className="lib-drawer__section-label">
          Used in <span className="ui-field-hint">(deep-links into Calendar&rsquo;s post detail drawer)</span>
        </span>
        {usedInPosts.length === 0 ? (
          <p className="used-in-empty">Not used on any post yet — that&rsquo;s why this card shows the &quot;Unused&quot; badge.</p>
        ) : (
          <div className="used-in-list">
            {usedInPosts.map((post) => (
              <button
                key={post.id}
                type="button"
                className="used-in-item"
                onClick={() => onNavigateToPost?.(post)}
                style={{ width: '100%', border: '1px solid var(--color-border)', cursor: 'pointer' }}
              >
                <span className="used-in-item__thumb"><FileText size={14} /></span>
                <span className="used-in-item__body">
                  <span className="used-in-item__title">{post.title || post.caption || 'Untitled post'}</span>
                  <span className="used-in-item__meta">{post.status} &middot; {formatDate(post.scheduled_at)}</span>
                </span>
                <span className="used-in-item__arrow"><ArrowRight size={14} /></span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lib-drawer__section">
        <span className="lib-drawer__section-label">Version history</span>
        {versionChain.length <= 1 ? (
          <p className="ui-field-hint">No prior versions — this is the only upload of this asset.</p>
        ) : (
          <div className="version-chain">
            {versionChain.map((version, index) => (
              <div key={version.id}>
                <div className={`version-item${version.id === asset.id ? ' is-current' : ' is-superseded'}`}>
                  <span className="version-item__thumb" />
                  <div className="version-item__body">
                    <span className="version-item__label">
                      {getItemTitle(version)}{' '}
                      {version.id === asset.id ? (
                        <span className="ui-badge ui-badge-tone-brand">Current</span>
                      ) : (
                        <span className="ui-field-hint">(superseded)</span>
                      )}
                    </span>
                    <span className="version-item__meta">{formatDate(version.created_at)}</span>
                  </div>
                  <button
                    type="button"
                    className={`ui-button ${version.id === asset.id ? 'ui-button-secondary' : 'ui-button-ghost'} sm`}
                    onClick={() => onOpenVersion?.(version)}
                  >
                    View
                  </button>
                </div>
                {index < versionChain.length - 1 ? <div className="version-item__connector" /> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="lib-drawer__section">
        <span className="lib-drawer__section-label">Technical</span>
        <p className="ui-field-hint">
          {getFormatLabel(asset)}
          {asset.file_size_bytes ? ` · ${formatFileSize(asset.file_size_bytes)}` : ''}
          {asset.dimensions?.width ? ` · ${asset.dimensions.width}×${asset.dimensions.height}` : ''}
          {asset.duration_seconds ? ` · ${formatDuration(asset.duration_seconds)}` : ''}
          {` · uploaded ${formatDate(asset.created_at)}`}
          {asset.checksum ? ' · checksum recorded' : ''}
        </p>
      </div>
    </UiDrawer>
  );
}
