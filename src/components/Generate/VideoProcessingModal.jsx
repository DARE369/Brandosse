import React from 'react';
import { Loader2, Minimize2, Maximize2, X, RefreshCw, PlayCircle } from 'lucide-react';

function clampPercent(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function statusCopy(status) {
  switch (status) {
    case 'submitting':
    case 'queued':
      return {
        title: 'Queuing your video job',
        subtitle: 'Submitting render job...',
      };
    case 'processing':
      return {
        title: 'Generating your video',
        subtitle: 'This can take 2-4 minutes depending on queue load.',
      };
    case 'completed':
      return {
        title: 'Video ready',
        subtitle: 'Your rendered video is available in the canvas.',
      };
    case 'failed':
      return {
        title: 'Video generation failed',
        subtitle: 'Retry the same prompt or adjust your input.',
      };
    default:
      return {
        title: 'Preparing video',
        subtitle: 'Starting job...',
      };
  }
}

export function VideoStatusBar({
  status,
  progress,
  onExpand,
  onDismiss,
}) {
  const pct = clampPercent(progress);

  return (
    <div className="video-status-bar" role="status" aria-live="polite">
      <div className="video-status-bar-label">
        <span aria-hidden="true">🎬</span>
        <span>{status === 'failed' ? 'Video failed' : 'Video generating'}</span>
      </div>
      <div className="video-status-bar-progress">
        <div className="video-status-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="video-status-bar-pct">{pct}%</span>
      <button type="button" className="video-status-bar-expand" onClick={onExpand}>Expand</button>
      <button type="button" className="video-status-bar-dismiss" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

export default function VideoProcessingModal({
  jobId,
  prompt,
  status,
  progress,
  videoUrl,
  onMinimize,
  onDismiss,
  onRetry,
  onViewInCanvas,
}) {
  const pct = clampPercent(progress);
  const copy = statusCopy(status);
  const canMinimize = status === 'submitting' || status === 'queued' || status === 'processing';
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';
  const isProcessing = status === 'submitting' || status === 'queued' || status === 'processing';

  return (
    <div className="video-modal-overlay" role="dialog" aria-modal="true" aria-label="Video generation status">
      <div className="video-modal">
        <button type="button" className="video-modal-dismiss" onClick={onDismiss} aria-label="Dismiss status modal">
          <X size={16} />
        </button>

        <div className="video-modal-icon" aria-hidden="true">
          {isProcessing && <Loader2 size={30} className="animate-spin" />}
          {isCompleted && <PlayCircle size={34} />}
          {isFailed && <RefreshCw size={30} />}
        </div>

        <h3 className="video-modal-title">{copy.title}</h3>
        <p className="video-modal-subtitle">{copy.subtitle}</p>

        <p className="video-modal-prompt" title={prompt}>
          {prompt || 'No prompt'}
        </p>

        {jobId && (
          <p className="video-modal-job-id">
            Job ID: <code>{jobId}</code>
          </p>
        )}

        {(isProcessing || isCompleted) && (
          <>
            <div className="video-modal-progress-track">
              <div className="video-modal-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="video-modal-pct">{pct}%</span>
          </>
        )}

        {isProcessing && <p className="video-modal-eta">You can minimize and keep working.</p>}

        {isCompleted && videoUrl && (
          <video
            src={videoUrl}
            className="video-preview-thumb"
            controls
            muted
            playsInline
          />
        )}

        <div className="video-modal-actions">
          {canMinimize && (
            <button type="button" className="video-modal-minimize" onClick={onMinimize}>
              <Minimize2 size={15} />
              Minimize
            </button>
          )}

          {isCompleted && (
            <button type="button" className="btn-send" onClick={onViewInCanvas}>
              <Maximize2 size={16} />
              View in canvas
            </button>
          )}

          {isFailed && (
            <button type="button" className="btn-send" onClick={onRetry}>
              <RefreshCw size={16} />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
