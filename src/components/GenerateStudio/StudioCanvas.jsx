import React from 'react';
import { Info, X } from 'lucide-react';
import { getMagnificModelLabel } from '../../config/magnificModels';
import IntentBrief from './IntentBrief';
import PromptSuggestions from './PromptSuggestions';
import StudioResultGrid from './StudioResultGrid';

/* ─────────────────────────────────────────────────────────────────────────────
   StudioCanvas — main canvas surface: error bar, progress, status line,
   intent brief (empty state), prompt suggestions, and the result grid.
   ───────────────────────────────────────────────────────────────────────────── */
export default function StudioCanvas({
  localError,
  error,
  onDismissError,
  isGenerating,
  generationProgress,
  progressLabel,
  settings,
  showIntentCard,
  onBuildBrief,
  onSkipIntent,
  intentDone,
  selectedMode,
  activeGenerations,
  onSelectSuggestion,
  shimmerCount,
  aspectRatioCss,
  selectedGenerationId,
  onOpenCard,
  onUseForPost,
}) {
  return (
    <main className="studio-canvas">

      {/* Error bar */}
      {(localError || error) ? (
        <div className="studio-error-bar" role="alert">
          <Info size={14} />
          <span>{localError || error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss"><X size={13} /></button>
        </div>
      ) : null}

      {/* Generation progress bar */}
      {isGenerating && (
        <div
          className={`studio-progress ${generationProgress <= 0 ? 'studio-progress--indeterminate' : ''}`}
          role="progressbar"
          aria-valuenow={Math.round(generationProgress)}
        >
          <div
            className="studio-progress__fill"
            style={{ width: generationProgress > 0 ? `${generationProgress}%` : '36%' }}
          />
        </div>
      )}

      {/* Status line */}
      {isGenerating && (
        <div className="studio-status-line" role="status">
          <span className="studio-status-dot" />
          {getMagnificModelLabel(settings.model)}
          {progressLabel ? ` · ${progressLabel}` : ' · Generating…'}
          {generationProgress > 0 && ` · ${Math.round(generationProgress)}%`}
        </div>
      )}

      {/* Intent card (empty state) */}
      {showIntentCard ? (
        <IntentBrief
          onBuildBrief={onBuildBrief}
          onSkip={onSkipIntent}
        />
      ) : (
        <>
          {/* Prompt suggestion chips — visible after intent, before first generation */}
          {intentDone && !isGenerating && activeGenerations.length === 0 && (
            <PromptSuggestions
              mode={selectedMode}
              onSelect={onSelectSuggestion}
            />
          )}

          {(activeGenerations.length > 0 || isGenerating) && (
            <StudioResultGrid
              activeGenerations={activeGenerations}
              isGenerating={isGenerating}
              shimmerCount={shimmerCount}
              aspectRatioCss={aspectRatioCss}
              selectedGenerationId={selectedGenerationId}
              onOpenCard={onOpenCard}
              onUseForPost={onUseForPost}
            />
          )}
        </>
      )}
    </main>
  );
}
