import React from 'react';
import { Copy, Image as ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';

function getPromptText(record) {
  return String(
    record?.rawPost?.media?.prompt
    || record?.rawPost?.generation?.prompt
    || record?.rawPipelineItem?.title
    || record?.previewText
    || record?.title
    || '',
  ).trim();
}

function getPreviewLabel(record) {
  if (record?.contentTypeLabel) {
    return `${record.contentTypeLabel} preview`;
  }
  return 'Post preview';
}

export default function PostPreview({ record }) {
  if (!record) return null;

  const promptText = getPromptText(record);
  const imageUrl = record.mediaPreviewUrl || null;

  const handleCopy = async () => {
    if (!promptText) return;
    try {
      await navigator.clipboard.writeText(promptText);
      toast.success('Prompt copied');
    } catch (error) {
      toast.error('Could not copy this prompt.');
    }
  };

  return (
    <section className="org-calendar-detail-section">
      <div className="org-calendar-section-head">
        <div>
          <span className="org-calendar-section-eyebrow">Post Preview</span>
          <h4>{getPreviewLabel(record)}</h4>
        </div>
        {record.contentTypeLabel ? (
          <span className="org-calendar-detail-chip neutral">{record.contentTypeLabel}</span>
        ) : null}
      </div>

      <div className={`org-calendar-preview-frame ${imageUrl ? 'has-image' : ''}`.trim()}>
        {imageUrl ? (
          <img src={imageUrl} alt={record.title || 'Post preview'} />
        ) : (
          <div className="org-calendar-preview-placeholder">
            <span className="org-calendar-preview-icon">
              <ImageIcon size={18} />
            </span>
            <strong>Preview pending</strong>
            <p>Generated media will appear here once the asset is ready.</p>
          </div>
        )}
      </div>

      {promptText ? (
        <div className="org-calendar-prompt-chip">
          <button type="button" className="org-calendar-chip-action" onClick={handleCopy}>
            <Copy size={14} />
            Copy
          </button>
          <p>{promptText}</p>
        </div>
      ) : null}
    </section>
  );
}
