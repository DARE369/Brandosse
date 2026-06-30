import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { getMagnificModelLabel } from '../../config/magnificModels';

function buildMetaPills(selectedMode, settings, prompt) {
  const pills = [];

  /* format */
  const fmt = selectedMode === 'video'
    ? (settings.resolution || '1080p')
    : (settings.aspectRatio || '1:1');
  pills.push({ label: fmt });

  /* on-brand */
  pills.push({ label: 'On-brand', accent: true });

  /* quality / duration */
  if (selectedMode === 'video') {
    pills.push({ label: `${settings.duration || 5}s` });
  } else {
    pills.push({ label: settings.resolution || '2k' });
  }

  /* avoid / negative prompt */
  if (settings.negativePrompt) {
    const avoid = settings.negativePrompt.slice(0, 20);
    pills.push({ label: `Avoiding ${avoid}${settings.negativePrompt.length > 20 ? '…' : ''}` });
  }

  return pills;
}

export default function StudioGeneratingView({
  selectedMode,
  settings,
  shimmerCount = 4,
  generationProgress = 0,
  progressLabel,
  prompt = '',
}) {
  const modelLabel = getMagnificModelLabel(settings.model) || settings.model || 'AI Model';
  const pills = useMemo(
    () => buildMetaPills(selectedMode, settings, prompt),
    [selectedMode, settings, prompt],
  );

  const shimmers = Array.from({ length: Math.max(1, shimmerCount) });

  const aspectCss = (settings.aspectRatio || '1:1').replace(':', ' / ');

  return (
    <div className="sgen">
      {/* Icon */}
      <div className="sgen-icon">
        <Sparkles size={24} />
      </div>

      {/* Title */}
      <h2 className="sgen-title">
        Generating {shimmerCount > 1 ? `${shimmerCount} takes` : ''}
      </h2>
      <p className="sgen-model">{modelLabel}{progressLabel ? ` · ${progressLabel}` : ''}</p>

      {/* Progress bar */}
      <div className="sgen-bar">
        <div
          className="sgen-bar__fill"
          style={
            generationProgress > 0
              ? { width: `${generationProgress}%`, animation: 'none' }
              : undefined
          }
        />
      </div>

      {/* Meta pills */}
      <div className="sgen-pills">
        {pills.map((p, i) => (
          <span
            key={i}
            className="sgen-pill"
            style={p.accent ? { borderColor: 'var(--bgs-primary)', color: 'var(--bgs-primary)', background: 'var(--bgs-primary-soft)' } : undefined}
          >
            {p.label}
          </span>
        ))}
      </div>

      {/* Shimmer cards */}
      <div className="sgen-grid">
        {shimmers.map((_, i) => (
          <div
            key={i}
            className="studio-card studio-card--shimmer"
            style={{ '--card-ratio': aspectCss }}
          />
        ))}
      </div>
    </div>
  );
}
