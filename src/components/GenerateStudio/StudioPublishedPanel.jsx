import React from 'react';
import { CheckCircle, CalendarDays, Library, Plus } from 'lucide-react';
import { useAppNavigation } from '../../Context/AppNavigationContext';

export default function StudioPublishedPanel({
  selectedGeneration,
  postProduction,
  platforms,
  onGenerateAnother,
}) {
  const { navigate } = useAppNavigation();

  const thumbUrl  = selectedGeneration?.thumbnail_url || selectedGeneration?.output_url;
  const caption   = postProduction?.caption || '';
  const platCount = Array.isArray(platforms) ? platforms.length : 0;

  return (
    <div className="spub-success">
      {/* Header */}
      <div className="spub-success-head">
        <div className="spub-success-icon">
          <CheckCircle size={28} strokeWidth={1.8} />
        </div>
        <div>
          <div className="spub-success-title">Post queued</div>
          <span className="spub-demo-badge">Simulated publish</span>
        </div>
      </div>

      {/* Asset preview */}
      {thumbUrl && (
        <div className="spub-success-asset">
          <img
            className="spub-success-thumb"
            src={thumbUrl}
            alt="Published asset"
          />
        </div>
      )}

      {/* Caption preview */}
      {caption && (
        <p className="spub-success-caption">
          {caption.length > 140 ? caption.slice(0, 140) + '…' : caption}
        </p>
      )}

      {platCount > 0 && (
        <p className="spub-success-meta">
          Queued to {platCount} platform{platCount !== 1 ? 's' : ''}
        </p>
      )}

      {/* Navigation */}
      <div className="spub-success-nav">
        <button
          type="button"
          className="spub-success-nav-btn spub-success-nav-btn--primary"
          onClick={() => navigate('/app/calendar')}
        >
          <CalendarDays size={14} />
          View in Calendar
        </button>
        <button
          type="button"
          className="spub-success-nav-btn spub-success-nav-btn--secondary"
          onClick={() => navigate('/app/library')}
        >
          <Library size={14} />
          View in Library
        </button>
      </div>

      {/* Generate another */}
      <button
        type="button"
        className="spub-success-again"
        onClick={onGenerateAnother}
      >
        <Plus size={13} />
        Generate another post
      </button>
    </div>
  );
}
