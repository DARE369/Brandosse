import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, FileText, PenLine, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { getHealthScore, getMissingTier1Fields } from '../../utils/brandKitValidation';

const ACCEPTED_DOC_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const HEALTH_FIELDS = [
  'brand_name',
  'industry',
  'tagline',
  'target_audience',
  'brand_voice',
  'tone_descriptors',
  'writing_style_notes',
  'forbidden_phrases',
  'content_restrictions',
  'visual_style_keywords',
  'color_palette',
  'photo_style_notes',
  'legal_disclaimers',
  'competitor_names',
];

function healthClass(score) {
  if (score < 50) return 'danger';
  if (score < 75) return 'warning';
  if (score < 90) return 'warning';
  return 'good';
}

export default function BrandKitDashboard({
  brandKit,
  assetsCount = 0,
  onEditSection,
  onOpenManualEdit,
  onUploadUpdatedDocument,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const updateInputRef = useRef(null);

  const healthScore = useMemo(
    () => getHealthScore(brandKit || {}, HEALTH_FIELDS),
    [brandKit],
  );
  const missingTier1 = useMemo(
    () => getMissingTier1Fields(brandKit || {}),
    [brandKit],
  );

  const handleUpdateFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setMenuOpen(false);
    if (!file) return;

    if (!ACCEPTED_DOC_MIME.includes(file.type)) {
      toast.error('Please upload a PDF or Word document (.pdf, .doc, .docx).');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('File must be under 20MB.');
      return;
    }

    onUploadUpdatedDocument?.(file);
  };

  const safePalette = Array.isArray(brandKit?.color_palette) ? brandKit.color_palette : [];

  return (
    <div className="bk-dashboard">
      <div className="bk-dashboard-header">
        <h1 className="bk-dashboard-title">Brand Kit</h1>

        <div className="bk-update-menu-wrap">
          <button
            className="bk-btn-secondary"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <RefreshCw size={14} />
            Update Kit
            <ChevronDown size={14} />
          </button>

          {menuOpen && (
            <div className="bk-update-menu">
              <button
                className="bk-update-menu-item"
                type="button"
                onClick={() => updateInputRef.current?.click()}
              >
                <FileText size={14} />
                <span>
                  <strong>Upload updated brand document</strong>
                  <small>AI extracts and compares updates</small>
                </span>
              </button>

              <button
                className="bk-update-menu-item"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenManualEdit?.();
                }}
              >
                <PenLine size={14} />
                <span>
                  <strong>Edit manually</strong>
                  <small>Open the full review form</small>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <input
        ref={updateInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="bk-visually-hidden"
        onChange={handleUpdateFile}
      />

      <div className="bk-dashboard-grid">
        <div className="bk-kit-summary-card">
          <h2 className="bk-kit-brand-name">{brandKit?.brand_name || 'Unnamed brand'}</h2>
          <p className="bk-kit-brand-industry">{brandKit?.industry || 'Industry not set'}</p>

          <div className="bk-kit-meta-row">
            <p className="bk-kit-meta-item">
              <strong>Voice:</strong> {brandKit?.brand_voice || 'Not set'}
            </p>
            <p className="bk-kit-meta-item">
              <strong>Audience:</strong> {brandKit?.target_audience || 'Not set'}
            </p>
          </div>

          <div className="bk-kit-palette">
            {safePalette.slice(0, 6).map((color, index) => (
              <span
                key={`${color?.hex || ''}-${index}`}
                className="bk-kit-swatch"
                style={{ background: color?.hex || '#111420' }}
                title={color?.name || color?.hex || 'Color'}
              />
            ))}
            {safePalette.length === 0 && <span className="bk-hint">No colors configured yet</span>}
          </div>

          <div className="bk-kit-health">
            <div className="bk-kit-health-header">
              <span className="bk-kit-health-label">Kit health</span>
              <span className="bk-kit-health-pct">{healthScore}%</span>
            </div>
            <div className="bk-kit-health-track">
              <div
                className={`bk-kit-health-fill ${healthClass(healthScore)}`}
                style={{ width: `${healthScore}%` }}
              />
            </div>
            {missingTier1.length > 0 && (
              <p className="bk-kit-health-note">
                {missingTier1.length} critical field{missingTier1.length > 1 ? 's' : ''} need attention.
              </p>
            )}
          </div>
        </div>

        <aside className="bk-quick-edit-card">
          <h3 className="bk-quick-edit-title">Quick edit</h3>
          {['Basics', 'Voice', 'Guardrails', 'Visual Style', 'Assets'].map((section) => (
            <button
              key={section}
              className="bk-quick-edit-item"
              type="button"
              onClick={() => onEditSection?.(section)}
            >
              {section}
              <span>&gt;</span>
            </button>
          ))}

          <div className="bk-quick-edit-assets">
            <small>{assetsCount} asset{assetsCount === 1 ? '' : 's'} uploaded</small>
          </div>
        </aside>
      </div>
    </div>
  );
}
