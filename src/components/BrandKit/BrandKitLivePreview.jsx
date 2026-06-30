import React from 'react';
import { AlertTriangle } from 'lucide-react';

function buildSampleCaption(data) {
  if (!data?.brand_name && !data?.target_audience) return null;
  const name = data.brand_name || 'Your brand';
  const voice = data.brand_voice || 'professional';

  const voiceMap = {
    professional: `${name} is built for people who demand better outcomes.`,
    playful: `${name} keeps it fun while delivering the result you need.`,
    authoritative: `${name}. Trusted by teams that expect a higher standard.`,
    conversational: `Real talk: ${name} makes the hard parts feel simple.`,
    inspirational: `${name} helps you turn momentum into meaningful progress.`,
    edgy: `${name} is not here to blend in. It is built to stand out.`,
  };

  return voiceMap[voice] || `${name} is built to deliver consistent value.`;
}

function PreviewField({ label, value, confidence }) {
  const isEmpty = !value;
  const isLow = confidence === 'low' || confidence === 'inferred';

  return (
    <div className={`bk-preview-field ${isEmpty ? 'empty' : ''} ${isLow ? 'low-confidence' : ''}`}>
      <span className="bk-preview-field-label">{label}</span>
      <span className="bk-preview-field-value">
        {isEmpty ? (
          <span className="bk-preview-field-empty">Not extracted yet</span>
        ) : (
          value
        )}
        {isLow && !isEmpty && (
          <span className="bk-confidence-flag" title="AI inferred this field. Please verify.">
            <AlertTriangle size={11} />
            Review
          </span>
        )}
      </span>
    </div>
  );
}

export default function BrandKitLivePreview({ data = {}, confidenceMap = {} }) {
  const sampleCaption = buildSampleCaption(data);

  return (
    <div className="bk-live-preview">
      <div className="bk-preview-card">
        <h3 className="bk-preview-card-title">Your Brand Kit</h3>
        <div className="bk-preview-fields">
          <PreviewField label="Brand Name" value={data.brand_name} confidence={confidenceMap.brand_name} />
          <PreviewField label="Industry" value={data.industry} confidence={confidenceMap.industry} />
          <PreviewField label="Target Audience" value={data.target_audience} confidence={confidenceMap.target_audience} />
          <PreviewField label="Brand Voice" value={data.brand_voice} confidence={confidenceMap.brand_voice} />
          <PreviewField
            label="Visual Style"
            value={Array.isArray(data.visual_style_keywords) ? data.visual_style_keywords.join(', ') : ''}
            confidence={confidenceMap.visual_style_keywords}
          />
          {Array.isArray(data.color_palette) && data.color_palette.length > 0 && (
            <div className="bk-preview-field">
              <span className="bk-preview-field-label">Color Palette</span>
              <div className="bk-preview-palette">
                {data.color_palette.slice(0, 5).map((color, index) => (
                  <span
                    key={`${color.hex || ''}-${index}`}
                    className="bk-preview-swatch"
                    style={{ background: color.hex || '#111420' }}
                    title={color.name || color.hex || 'Color'}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {sampleCaption && (
        <div className="bk-preview-caption-card">
          <p className="bk-preview-caption-label">Sample caption preview</p>
          <p className="bk-preview-caption-text">{sampleCaption}</p>
        </div>
      )}
    </div>
  );
}
