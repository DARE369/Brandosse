"use client";

// Grid-view asset card — refactored in place per AS_IS_AUDIT.md §3.2
// (Refactor: good primary/secondary action pattern carried forward; data
// model re-pointed at the new personal_assets row shape). Matches the
// approved mockup's .asset-card markup 1:1: source badge (upload /
// generation / post — LIBRARY_SPEC.md §1), "Unused" badge, always-on-touch /
// hover-revealed select checkbox + actions row (Master Brief §4 — every
// hover affordance has a tap-visible equivalent via @media (pointer:coarse)
// in LibraryV2.css), AI-tagging shimmer row, and user tags vs. AI tags
// rendered as visually distinct chips.
import { useState } from 'react';
import { FileImage, FileText, Film, MoreHorizontal, Sparkles } from 'lucide-react';
import { UiOverflowMenu } from '../../../components/Shared/ui';
import {
  getItemTitle,
  getSourceLabel,
  getMetaLeftLabel,
  getMetaRightLabel,
  isUnused,
} from '../libraryItemUtils';

function AssetMedia({ asset, selectable, isSelected, onToggleSelect }) {
  const [failed, setFailed] = useState(false);
  const title = getItemTitle(asset);
  const hasPreview = Boolean(asset.thumbnail_url && !failed);

  return (
    <div className="asset-card__media">
      <span className={`asset-card__source-badge source-${asset.source}`}>
        {getSourceLabel(asset)}
      </span>
      {isUnused(asset) ? <span className="asset-card__unused-badge">Unused</span> : null}

      {hasPreview ? (
        asset.media_type === 'video' ? (
          <video src={asset.thumbnail_url || asset.file_url} muted playsInline onError={() => setFailed(true)} />
        ) : (
          <img src={asset.thumbnail_url} alt={title} loading="lazy" onError={() => setFailed(true)} />
        )
      ) : (
        <div className="asset-card__media-fallback" role="img" aria-label={title}>
          {asset.media_type === 'video' ? <Film size={26} /> : asset.media_type === 'document' ? <FileText size={26} /> : <FileImage size={26} />}
        </div>
      )}

      <button
        type="button"
        className="asset-card__select"
        onClick={(event) => {
          event.stopPropagation();
          onToggleSelect?.(asset);
        }}
        aria-label={isSelected ? `Deselect ${title}` : `Select ${title}`}
        aria-pressed={isSelected}
      >
        {isSelected ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
        ) : null}
      </button>
    </div>
  );
}

function AssetTags({ asset }) {
  const tags = Array.isArray(asset.tags) ? asset.tags.filter(Boolean) : [];
  const aiTags = Array.isArray(asset.ai_tags) ? asset.ai_tags.filter(Boolean) : [];

  if (asset.ai_tagging_status === 'pending') {
    return (
      <div className="asset-card__ai-shimmer-row" style={{ paddingLeft: 0 }}>
        <span className="skel ai-shimmer-line w1" />
        <span className="skel ai-shimmer-line w2" />
      </div>
    );
  }

  if (tags.length === 0 && aiTags.length === 0) return null;

  return (
    <div className="asset-card__tags">
      {tags.slice(0, 3).map((tag) => (
        <span key={`tag-${tag}`} className="asset-card__tag">{tag}</span>
      ))}
      {aiTags.slice(0, 2).map((tag) => (
        <span key={`ai-${tag}`} className="asset-card__tag is-ai"><Sparkles size={10} aria-hidden="true" /> {tag}</span>
      ))}
    </div>
  );
}

export default function LibraryCard({
  asset,
  selectable = false,
  isSelected = false,
  onToggleSelect,
  onOpenDrawer,
  onSchedule,
  secondaryActions = [],
}) {
  const title = getItemTitle(asset);

  return (
    <article
      className={`asset-card${isSelected ? ' is-selected' : ''}${selectable ? ' bulk-mode' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`Open ${title}`}
      onClick={(event) => {
        if (event.target.closest('button')) return;
        onOpenDrawer?.(asset);
      }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
          event.preventDefault();
          onOpenDrawer?.(asset);
        }
      }}
    >
      <AssetMedia asset={asset} selectable={selectable} isSelected={isSelected} onToggleSelect={onToggleSelect} />

      <div className="asset-card__body">
        <h4 className="asset-card__title" title={title}>{title}</h4>
        <AssetTags asset={asset} />
        <div className="asset-card__meta-row">
          <span>{getMetaLeftLabel(asset)}</span>
          <span>{getMetaRightLabel(asset)}</span>
        </div>
      </div>

      <div className="asset-card__actions">
        <button
          type="button"
          className="ui-button ui-button-primary sm"
          onClick={(event) => {
            event.stopPropagation();
            onSchedule?.(asset);
          }}
        >
          Schedule
        </button>
        {secondaryActions.length > 0 ? (
          <span onClick={(event) => event.stopPropagation()}>
            <UiOverflowMenu items={secondaryActions} label={`More actions for ${title}`} />
          </span>
        ) : (
          <button type="button" className="ui-button ui-icon-button-ghost sm" aria-label={`More actions for ${title}`} onClick={(event) => event.stopPropagation()}>
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}
