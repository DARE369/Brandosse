import React from 'react';
import { ArrowRight, Download, Info } from 'lucide-react';
import { getGenerationTitle, getMediaUrl } from './shared/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
   StudioCard — individual generation result card
   ───────────────────────────────────────────────────────────────────────────── */
export default function StudioCard({ generation, selected, isTopPick, onOpen, onUseForPost }) {
  const url       = getMediaUrl(generation);
  const isVideo   = generation?.media_type === 'video';
  const isDone    = generation?.status === 'completed';
  const isFailed  = generation?.status === 'failed';

  if (!isDone && !isFailed) {
    return <div className="studio-card studio-card--shimmer" aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      className={`studio-card ${selected ? 'is-selected' : ''} ${isFailed ? 'studio-card--failed' : ''}`}
      onClick={onOpen}
      aria-label={getGenerationTitle(generation)}
    >
      {url && isDone && (
        isVideo
          ? <video className="studio-card__media" src={url} muted playsInline />
          : <img className="studio-card__media" src={url} alt={getGenerationTitle(generation)} loading="lazy" />
      )}

      {isFailed && (
        <div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--bgs-muted)' }}>
          <Info size={22} />
        </div>
      )}

      {isTopPick && isDone && (
        <span className="studio-card__top-pick">★ Top pick</span>
      )}

      <span className={`studio-card__status studio-card__status--${generation.status}`} />

      {isDone && (
        <div className="studio-card__hover">
          <div className="studio-card__hover-icons">
            <a
              className="studio-card__icon-btn"
              href={url}
              download
              target="_blank"
              rel="noreferrer"
              title="Download"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={13} />
            </a>
          </div>
          <button
            type="button"
            className="studio-card__use-btn"
            onClick={(e) => { e.stopPropagation(); onUseForPost(); }}
          >
            Use for post <ArrowRight size={12} />
          </button>
        </div>
      )}
    </button>
  );
}
