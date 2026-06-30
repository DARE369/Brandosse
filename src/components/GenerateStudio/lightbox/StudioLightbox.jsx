import React from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  X,
} from 'lucide-react';
import { formatBytes, getMediaUrl } from '../shared/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
   StudioLightbox — full-screen asset inspector
   Rendered only when open with a valid generation (orchestrator gates this).
   ───────────────────────────────────────────────────────────────────────────── */
export default function StudioLightbox({
  lightboxGeneration,
  lightboxMeta,
  lightboxIndex,
  lightboxPrev,
  lightboxNext,
  completedGenerationsCount,
  onClose,
  onPrev,
  onNext,
  onRegenerate,
  onUseForPost,
}) {
  return (
    <div
      className="studio-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Asset inspector"
    >
      {/* Top bar */}
      <div className="studio-lightbox__topbar">
        <button type="button" className="studio-lb-btn studio-lb-btn--icon" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <div className="studio-lb-topbar__right">
          <a
            className="studio-lb-btn studio-lb-btn--icon"
            href={getMediaUrl(lightboxGeneration)}
            download
            target="_blank"
            rel="noreferrer"
            title="Download"
          >
            <Download size={16} />
          </a>
          <button
            type="button"
            className="studio-lb-btn studio-lb-btn--icon"
            onClick={() => onRegenerate(lightboxGeneration)}
            title="Regenerate"
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className="studio-lb-btn studio-lb-btn--primary"
            onClick={() => onUseForPost(lightboxGeneration)}
            disabled={lightboxGeneration.status !== 'completed'}
          >
            Use for post <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Media */}
      <div className="studio-lightbox__media">
        {lightboxGeneration.media_type === 'video'
          ? <video className="studio-lb-media" src={getMediaUrl(lightboxGeneration)} controls autoPlay muted loop />
          : <img className="studio-lb-media" src={getMediaUrl(lightboxGeneration)} alt="Generated asset" />}
      </div>

      {/* Prev / Next */}
      <button
        type="button"
        className="studio-lightbox__prev"
        onClick={onPrev}
        disabled={!lightboxPrev}
        aria-label="Previous"
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        className="studio-lightbox__next"
        onClick={onNext}
        disabled={!lightboxNext}
        aria-label="Next"
      >
        <ChevronRight size={22} />
      </button>

      {/* Meta strip */}
      <div className="studio-lightbox__meta">
        <strong>{lightboxMeta.providerModel}</strong>
        {lightboxMeta.width && lightboxMeta.height && (
          <span>{lightboxMeta.width} × {lightboxMeta.height}</span>
        )}
        {lightboxMeta.fileSize && <span>{formatBytes(lightboxMeta.fileSize)}</span>}
        {lightboxMeta.generationTimeMs && (
          <span>{Math.round(lightboxMeta.generationTimeMs / 1000)}s</span>
        )}
        <span className="studio-lightbox__index">
          {lightboxIndex + 1} / {completedGenerationsCount}
        </span>
      </div>
    </div>
  );
}
