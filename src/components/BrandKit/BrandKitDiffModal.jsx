import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const COMPARABLE_FIELDS = [
  { key: 'brand_name', label: 'Brand Name' },
  { key: 'industry', label: 'Industry' },
  { key: 'tagline', label: 'Tagline' },
  { key: 'target_audience', label: 'Target Audience' },
  { key: 'brand_voice', label: 'Brand Voice' },
  { key: 'tone_descriptors', label: 'Tone Descriptors' },
  { key: 'writing_style_notes', label: 'Writing Style' },
  { key: 'forbidden_phrases', label: 'Forbidden Phrases' },
  { key: 'content_restrictions', label: 'Content Restrictions' },
  { key: 'visual_style_keywords', label: 'Visual Style Keywords' },
  { key: 'photo_style_notes', label: 'Photo Style Notes' },
  { key: 'legal_disclaimers', label: 'Legal Disclaimers' },
  { key: 'competitor_names', label: 'Competitor Names' },
];

function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  return !String(value ?? '').trim();
}

function buildDiff(existing, updated) {
  const conflicts = [];
  const additions = [];
  let unchangedCount = 0;

  COMPARABLE_FIELDS.forEach(({ key, label }) => {
    const oldValue = existing?.[key];
    const newValue = updated?.[key];
    const oldEmpty = isEmptyValue(oldValue);
    const newEmpty = isEmptyValue(newValue);

    if (oldEmpty && !newEmpty) {
      additions.push({ key, label, newValue });
      return;
    }

    if (!oldEmpty && !newEmpty && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      conflicts.push({ key, label, currentValue: oldValue, newValue });
      return;
    }

    unchangedCount += 1;
  });

  return { conflicts, additions, unchangedCount };
}

function formatValue(value) {
  if (isEmptyValue(value)) return '-';
  if (Array.isArray(value)) {
    const sliced = value.slice(0, 4).join(', ');
    return value.length > 4 ? `${sliced} +${value.length - 4}` : sliced;
  }
  if (typeof value === 'string') {
    return value.length > 110 ? `${value.slice(0, 110)}...` : value;
  }
  return String(value);
}

export default function BrandKitDiffModal({
  existingKit,
  newKit,
  newConfidenceMap,
  onApply,
  onCancel,
}) {
  const { conflicts, additions, unchangedCount } = useMemo(
    () => buildDiff(existingKit, newKit),
    [existingKit, newKit],
  );

  const [selections, setSelections] = useState(
    () => Object.fromEntries(conflicts.map((conflict) => [conflict.key, 'current'])),
  );
  const [additionSelections, setAdditionSelections] = useState(
    () => Object.fromEntries(additions.map((addition) => [addition.key, true])),
  );
  const [additionsExpanded, setAdditionsExpanded] = useState(false);

  const setAll = (value) => {
    setSelections(Object.fromEntries(conflicts.map((conflict) => [conflict.key, value])));
  };

  const handleApply = () => {
    const merged = { ...(existingKit || {}) };

    conflicts.forEach((conflict) => {
      if (selections[conflict.key] === 'new') {
        merged[conflict.key] = conflict.newValue;
      }
    });

    additions.forEach((addition) => {
      if (additionSelections[addition.key]) {
        merged[addition.key] = addition.newValue;
      }
    });

    onApply?.(merged);
  };

  return (
    <div className="bk-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="bk-diff-title">
      <div className="bk-diff-modal">
        <div className="bk-diff-header">
          <div>
            <h2 id="bk-diff-title" className="bk-diff-title">
              Brand Kit Update - Review Changes
            </h2>
            <p className="bk-diff-subtitle">
              We found {conflicts.length} difference{conflicts.length === 1 ? '' : 's'} from your current Brand Kit.
            </p>
          </div>
          <button className="bk-btn-primary" onClick={handleApply} type="button">
            Apply selection -&gt;
          </button>
        </div>

        {conflicts.length > 0 && (
          <section className="bk-diff-section">
            <div className="bk-diff-section-header">
              <h3 className="bk-diff-section-title">Conflicts - choose the value to keep</h3>
              <div className="bk-diff-bulk-actions">
                <button className="bk-btn-ghost bk-btn-sm" type="button" onClick={() => setAll('current')}>
                  Keep all current
                </button>
                <button className="bk-btn-ghost bk-btn-sm" type="button" onClick={() => setAll('new')}>
                  Use all new
                </button>
              </div>
            </div>

            {conflicts.map((conflict) => (
              <div key={conflict.key} className="bk-diff-row">
                <div className="bk-diff-row-label">{conflict.label}</div>
                <div className="bk-diff-versions">
                  <button
                    className={`bk-diff-version ${selections[conflict.key] === 'current' ? 'selected' : ''}`}
                    type="button"
                    onClick={() => setSelections((prev) => ({ ...prev, [conflict.key]: 'current' }))}
                    aria-pressed={selections[conflict.key] === 'current'}
                  >
                    <span className="bk-diff-version-tag">Current</span>
                    <span className="bk-diff-version-value">{formatValue(conflict.currentValue)}</span>
                  </button>

                  <button
                    className={`bk-diff-version ${selections[conflict.key] === 'new' ? 'selected' : ''}`}
                    type="button"
                    onClick={() => setSelections((prev) => ({ ...prev, [conflict.key]: 'new' }))}
                    aria-pressed={selections[conflict.key] === 'new'}
                  >
                    <span className="bk-diff-version-tag new">
                      New
                      {(newConfidenceMap?.[conflict.key] === 'low' || newConfidenceMap?.[conflict.key] === 'inferred') && (
                        <span className="bk-confidence-badge">Review</span>
                      )}
                    </span>
                    <span className="bk-diff-version-value">{formatValue(conflict.newValue)}</span>
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {additions.length > 0 && (
          <section className="bk-diff-section">
            <button
              className="bk-diff-additions-toggle"
              onClick={() => setAdditionsExpanded((open) => !open)}
              type="button"
            >
              + {additions.length} new field{additions.length === 1 ? '' : 's'} found
              {additionsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {additionsExpanded && (
              <div className="bk-diff-additions">
                {additions.map((addition) => (
                  <label key={addition.key} className="bk-diff-addition-row">
                    <input
                      type="checkbox"
                      checked={Boolean(additionSelections[addition.key])}
                      onChange={(event) => {
                        setAdditionSelections((prev) => ({ ...prev, [addition.key]: event.target.checked }));
                      }}
                    />
                    <span className="bk-diff-addition-label">{addition.label}</span>
                    <span className="bk-diff-addition-value">{formatValue(addition.newValue)}</span>
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        <p className="bk-diff-unchanged">{unchangedCount} fields unchanged and kept as-is.</p>

        <div className="bk-diff-footer">
          <button className="bk-btn-ghost" onClick={onCancel} type="button">Cancel</button>
          <button className="bk-btn-primary" onClick={handleApply} type="button">
            Apply selection -&gt;
          </button>
        </div>
      </div>
    </div>
  );
}
