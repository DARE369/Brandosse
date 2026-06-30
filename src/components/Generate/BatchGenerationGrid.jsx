import React, { useState } from 'react';
import { AlertTriangle, Download, CheckCircle2, CheckSquare, RotateCcw, Pencil, Send } from 'lucide-react';
import { GENERATION_STATUS } from '../../constants/statuses';
import useSessionStore from '../../stores/SessionStore';
const FALLBACK_VIDEO_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

const normalizeStatus = (status) => String(status || '').toLowerCase();

function resolveVideoSource(url) {
  if (!url) return FALLBACK_VIDEO_URL;
  return url.includes('video.pollinations.ai') ? FALLBACK_VIDEO_URL : url;
}

/**
 * BatchGenerationGrid - Displays generated images/videos in a grid
 * Shows full-size previews with proper aspect ratios
 */
export default function BatchGenerationGrid({ generations = [], onSelect, onRetry, onEdit }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [hoveredId, setHoveredId] = useState(null);
  const selectedGenerationId = useSessionStore((state) => state.selectedGenerationId);
  const selectGeneration = useSessionStore((state) => state.selectGeneration);

  const completedGenerations = generations.filter(
    (generation) => normalizeStatus(generation.status) === GENERATION_STATUS.COMPLETED
  );
  const allCompleted = completedGenerations.length === generations.length && generations.length > 0;

  const handleSelect = (generation) => {
    selectGeneration(generation);
    onSelect?.(generation);
  };

  const selectAll = () => {
    const allIds = completedGenerations.map((generation) => generation.id);
    setSelectedIds(allIds);
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const toggleBatchSelection = (generation, event) => {
    event.stopPropagation();
    if (normalizeStatus(generation.status) !== GENERATION_STATUS.COMPLETED) return;

    setSelectedIds((current) => (
      current.includes(generation.id)
        ? current.filter((id) => id !== generation.id)
        : [...current, generation.id]
    ));
  };

  const useSelected = () => {
    const selectedGenerations = generations.filter((generation) => selectedIds.includes(generation.id));
    if (selectedGenerations.length > 0) {
      handleSelect(selectedGenerations[0]);
    }
  };

  const handleDownload = async (generation, event) => {
    event?.stopPropagation?.();
    try {
      const response = await fetch(generation.storage_path);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const extension = blob.type.includes('png')
        ? 'png'
        : blob.type.includes('video')
          ? 'mp4'
          : 'jpg';
      link.download = `generation_${generation.id?.slice(0, 8) ?? Date.now()}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const downloadSelected = async () => {
    const selected = generations.filter((generation) => selectedIds.includes(generation.id));
    for (const generation of selected) {
      await handleDownload(generation, { stopPropagation: () => {} });
      // Small delay between downloads.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  const handleCardKeyDown = (event, generation, isCompleted) => {
    if (!isCompleted) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(generation);
    }
  };

  return (
    <div className="batch-generation-container">
      {/* Selection Header (only show if multiple completed items) */}
      {allCompleted && completedGenerations.length > 1 && (
        <div className="batch-selection-header">
          <div className="selection-info">
            <span className="batch-count">
              {completedGenerations.length} {completedGenerations.length === 1 ? 'image' : 'images'}
            </span>
            {selectedIds.length > 0 && (
              <span className="selected-info">
                - {selectedIds.length} selected
              </span>
            )}
          </div>
          <div className="selection-actions">
            {selectedIds.length === 0 ? (
              <button className="btn-select-action" onClick={selectAll} type="button">
                <CheckSquare size={14} />
                Select All
              </button>
            ) : (
              <button className="btn-select-action" onClick={clearSelection} type="button">
                Clear Selection
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grid layout based on number of items */}
      <div className={`generation-results-grid count-${generations.length}`}>
        {generations.map((generation) => {
          const isBatchSelected = selectedIds.includes(generation.id);
          const isSelected = selectedGenerationId === generation.id;
          const isHovered = hoveredId === generation.id;
          const status = normalizeStatus(generation.status);
          const isCompleted = status === GENERATION_STATUS.COMPLETED;
          const isProcessing = status === GENERATION_STATUS.PROCESSING;
          const isFailed = status === GENERATION_STATUS.FAILED;
          const isVideo = generation.media_type === 'video';

          return (
            <div
              key={generation.id}
              id={`gen-card-${generation.id}`}
              className={[
                'result-card',
                'gen-card',
                isSelected ? 'selected' : '',
                isBatchSelected ? 'multi-selected' : '',
                isProcessing ? 'processing loading-shimmer' : '',
                isFailed ? 'failed' : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => setHoveredId(generation.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => isCompleted && handleSelect(generation)}
              onKeyDown={(event) => handleCardKeyDown(event, generation, isCompleted)}
              role={isCompleted ? 'button' : undefined}
              tabIndex={isCompleted ? 0 : -1}
              aria-label={
                isCompleted
                  ? 'Click to select and open post production'
                  : isFailed
                    ? 'Generation failed'
                    : 'Result is still generating'
              }
            >
              {/* Media Preview - Full Size */}
              <div className="result-media-container">
                {isCompleted && (
                  <button
                    type="button"
                    className={`gen-card-select-btn ${isBatchSelected ? 'selected' : ''}`}
                    onClick={(event) => toggleBatchSelection(generation, event)}
                    aria-label={isBatchSelected ? 'Remove from batch selection' : 'Add to batch selection'}
                    aria-pressed={isBatchSelected}
                  >
                    {isBatchSelected ? <CheckCircle2 size={14} /> : <CheckSquare size={14} />}
                  </button>
                )}

                {isSelected && (
                  <div className="selected-post-badge">
                    <CheckCircle2 size={12} aria-hidden="true" />
                    Selected
                  </div>
                )}

                {isProcessing && isVideo && (
                  <div className="processing-overlay video-processing">
                    <span className="video-processing-icon" aria-hidden="true">VID</span>
                    <span className="processing-text">Generating video...</span>
                    <div className="processing-progress">
                      <div
                        className="processing-progress-fill"
                        style={{ width: `${generation.progress ?? 0}%` }}
                      />
                    </div>
                    <span className="progress-percentage">{generation.progress ?? 0}%</span>
                    <span className="video-eta-text">This may take 2-4 min</span>
                  </div>
                )}

                {isProcessing && !isVideo && (
                  <div className="processing-overlay">
                    <div className="processing-spinner" />
                    <span className="processing-text">Generating...</span>
                    {generation.progress > 0 && (
                      <div className="processing-progress">
                        <div
                          className="processing-progress-fill"
                          style={{ width: `${generation.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {isFailed && (
                  <div className="result-failed-state" role="status" aria-live="polite">
                    <AlertTriangle size={20} aria-hidden="true" />
                    <span className="failed-title">Generation failed</span>
                    <span className="failed-message">
                      {generation.error || generation.metadata?.error || 'Something went wrong during generation.'}
                    </span>
                    {typeof onRetry === 'function' && (
                      <button
                        type="button"
                        className="btn-failed-retry"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRetry(generation);
                        }}
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                        Retry
                      </button>
                    )}
                  </div>
                )}

                {isCompleted && isVideo && (
                  <video
                    src={resolveVideoSource(generation.storage_path)}
                    className="result-media"
                    loop
                    muted
                    playsInline
                    autoPlay={isHovered}
                  />
                )}

                {isCompleted && isVideo && (
                  <div className="video-play-badge" aria-hidden="true">Play</div>
                )}

                {isCompleted && generation.media_type === 'image' && (
                  generation.storage_path ? (
                    <img
                      key={generation.storage_path}
                      src={generation.storage_path}
                      alt="Generated content"
                      className="result-media"
                      loading="lazy"
                    />
                  ) : (
                    <div className="processing-overlay">
                      <span className="processing-text">Image not available</span>
                    </div>
                  )
                )}

                {isCompleted && generation.storage_path && (
                  <div className="gen-card-overlay">
                    {generation.media_type === 'image' && (
                      <button
                        className="gen-edit-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit?.(generation);
                        }}
                        aria-label="Edit this generation"
                        title="Edit"
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <button
                      className="gen-download-btn"
                      onClick={(event) => handleDownload(generation, event)}
                      aria-label="Download this generation"
                      title="Download"
                      type="button"
                    >
                      <Download size={15} />
                    </button>
                  </div>
                )}

                {Number(generation.carousel_slide_total) > 1 && (
                  <div
                    className="slide-badge"
                    aria-label={`Slide ${Number(generation.carousel_slide_index) > 0 ? generation.carousel_slide_index : (Number(generation.carousel_slide_index) || 0) + 1} of ${generation.carousel_slide_total}`}
                  >
                    Slide {Number(generation.carousel_slide_index) > 0 ? generation.carousel_slide_index : (Number(generation.carousel_slide_index) || 0) + 1} / {generation.carousel_slide_total}
                  </div>
                )}
              </div>

              {/* Footer Info */}
              {isCompleted && (
                <div className="result-card-footer">
                  <div className="result-meta">
                    <span className="meta-badge">{generation.media_type}</span>
                    <span className="meta-divider">-</span>
                    <span className="meta-text">
                      {(generation.metadata?.width ?? '?')}x{(generation.metadata?.height ?? '?')}
                    </span>
                    {generation.media_type === 'video' && generation.metadata?.duration && (
                      <>
                        <span className="meta-divider">-</span>
                        <span className="meta-text">{generation.metadata.duration}s</span>
                      </>
                    )}
                  </div>
                  <button
                    className={`gen-use-post-footer-btn${isSelected ? ' selected' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelect(generation);
                    }}
                    aria-label={isSelected ? 'Already selected for post production' : 'Use this generation for post production'}
                    type="button"
                  >
                    {isSelected ? (
                      <>
                        <CheckCircle2 size={11} />
                        <span>Selected</span>
                      </>
                    ) : (
                      <>
                        <Send size={11} />
                        <span>Use for post</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Batch Actions Bar (only when items are selected) */}
      {selectedIds.length > 0 && (
        <div className="batch-actions-bar">
          <span className="selected-count">
            {selectedIds.length} {selectedIds.length === 1 ? 'item' : 'items'} selected
          </span>
          <div className="batch-actions-buttons">
            <button
              className="btn-batch-action secondary"
              onClick={downloadSelected}
              type="button"
            >
              <Download size={14} />
              Download ({selectedIds.length})
            </button>
            <button
              className="btn-batch-action primary"
              onClick={useSelected}
              type="button"
            >
              Use for Post
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
