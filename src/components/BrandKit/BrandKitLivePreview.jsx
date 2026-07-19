import React from 'react';
import { AlertTriangle } from 'lucide-react';
import styles from './BrandKit.module.css';

function PreviewField({ label, value, confidence }) {
  const isEmpty = !value;
  const isLow = confidence === 'low' || confidence === 'inferred';

  return (
    <div className={styles.previewField}>
      <span className={styles.previewFieldLabel}>{label}</span>
      <span className={styles.previewFieldValue}>
        {isEmpty ? (
          <span className={styles.previewFieldEmpty}>Not extracted yet</span>
        ) : (
          value
        )}
        {isLow && !isEmpty && (
          <span className={styles.confidenceFlag} title="AI inferred this field. Please verify.">
            <AlertTriangle size={10} />
            Review
          </span>
        )}
      </span>
    </div>
  );
}

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

export default function BrandKitLivePreview({ data = {}, confidenceMap = {} }) {
  const sampleCaption = buildSampleCaption(data);

  return (
    <div className={styles.previewPanel}>
      <div className={styles.previewCard}>
        <h3 className={styles.previewCardTitle}>Your Brand Kit</h3>
        <div className={styles.previewFields}>
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
            <div className={styles.previewField}>
              <span className={styles.previewFieldLabel}>Color Palette</span>
              <div className={styles.previewPalette}>
                {data.color_palette.slice(0, 5).map((color, index) => (
                  <span
                    key={`${color.hex || ''}-${index}`}
                    className={styles.previewSwatch}
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
        <div className={styles.previewCaptionCard}>
          <p className={styles.previewCaptionLabel}>Sample caption preview</p>
          <p className={styles.previewCaptionText}>{sampleCaption}</p>
        </div>
      )}
    </div>
  );
}
