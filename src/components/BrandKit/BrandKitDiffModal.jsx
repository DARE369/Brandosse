import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../../ui-v2';
import { useUiV2ThemeOptional } from '../../ui-v2/ThemeProvider';
import styles from './BrandKit.module.css';

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
  if (isEmptyValue(value)) return '—';
  if (Array.isArray(value)) {
    const sliced = value.slice(0, 4).join(', ');
    return value.length > 4 ? `${sliced} +${value.length - 4}` : sliced;
  }
  if (typeof value === 'string') {
    return value.length > 110 ? `${value.slice(0, 110)}…` : value;
  }
  return String(value);
}

/**
 * Works identically whether triggered by a document re-upload OR a website
 * re-import — receives existingKit/newKit/newConfidenceMap generically via
 * BrandKitStore.openDiffModal, same as before.
 */
export default function BrandKitDiffModal({ existingKit, newKit, newConfidenceMap, onApply, onCancel }) {
  const themeCtx = useUiV2ThemeOptional();
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
      if (selections[conflict.key] === 'new') merged[conflict.key] = conflict.newValue;
    });
    additions.forEach((addition) => {
      if (additionSelections[addition.key]) merged[addition.key] = addition.newValue;
    });
    onApply?.(merged);
  };

  return (
    <div data-uiv2-theme={themeCtx?.theme || 'dark'} className={styles.diffOverlay} role="dialog" aria-modal="true" aria-labelledby="bk-diff-title">
      <div className={styles.diffModal}>
        <div className={styles.diffHeader}>
          <div>
            <h2 id="bk-diff-title" className={styles.diffTitle}>Diff — review updates from re-import</h2>
            <p className={styles.diffSubtitle}>
              We found {conflicts.length} difference{conflicts.length === 1 ? '' : 's'} from your current Brand Kit.
            </p>
          </div>
          <Button onClick={handleApply}>Apply selection →</Button>
        </div>

        {conflicts.length > 0 && (
          <section className={styles.diffSection}>
            <div className={styles.diffSectionHeader}>
              <h3 className={styles.diffSectionTitle}>Conflicts — choose the value to keep</h3>
              <div className={styles.diffBulkActions}>
                <Button variant="ghost" size="sm" onClick={() => setAll('current')}>Keep all current</Button>
                <Button variant="ghost" size="sm" onClick={() => setAll('new')}>Use all new</Button>
              </div>
            </div>

            {conflicts.map((conflict) => (
              <div key={conflict.key} className={styles.diffRow}>
                <div className={styles.diffRowLabel}>{conflict.label}</div>
                <div className={styles.diffVersions}>
                  <button
                    className={[styles.diffVersion, selections[conflict.key] === 'current' ? styles.diffVersionSelected : ''].filter(Boolean).join(' ')}
                    type="button"
                    onClick={() => setSelections((prev) => ({ ...prev, [conflict.key]: 'current' }))}
                    aria-pressed={selections[conflict.key] === 'current'}
                  >
                    <span className={styles.diffVersionTag}>Current</span>
                    <span className={styles.diffVersionValue}>{formatValue(conflict.currentValue)}</span>
                  </button>
                  <button
                    className={[styles.diffVersion, selections[conflict.key] === 'new' ? styles.diffVersionSelected : ''].filter(Boolean).join(' ')}
                    type="button"
                    onClick={() => setSelections((prev) => ({ ...prev, [conflict.key]: 'new' }))}
                    aria-pressed={selections[conflict.key] === 'new'}
                  >
                    <span className={styles.diffVersionTag}>
                      New
                      {(newConfidenceMap?.[conflict.key] === 'low' || newConfidenceMap?.[conflict.key] === 'inferred') && (
                        <span className={styles.confidenceBadge}>Review</span>
                      )}
                    </span>
                    <span className={styles.diffVersionValue}>{formatValue(conflict.newValue)}</span>
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {additions.length > 0 && (
          <section className={styles.diffSection}>
            <button className={styles.diffAdditionsToggle} onClick={() => setAdditionsExpanded((open) => !open)} type="button">
              + {additions.length} new field{additions.length === 1 ? '' : 's'} found
              {additionsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {additionsExpanded && (
              <div className={styles.diffAdditions}>
                {additions.map((addition) => (
                  <label key={addition.key} className={styles.diffAdditionRow}>
                    <input
                      type="checkbox"
                      checked={Boolean(additionSelections[addition.key])}
                      onChange={(event) => setAdditionSelections((prev) => ({ ...prev, [addition.key]: event.target.checked }))}
                    />
                    <span className={styles.diffAdditionLabel}>{addition.label}</span>
                    <span className={styles.diffAdditionValue}>{formatValue(addition.newValue)}</span>
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        <p className={styles.diffUnchanged}>{unchangedCount} fields unchanged and kept as-is.</p>

        <div className={styles.diffFooter}>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleApply}>Apply selection →</Button>
        </div>
      </div>
    </div>
  );
}
