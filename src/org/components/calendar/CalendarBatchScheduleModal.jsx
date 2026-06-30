import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Sparkles, X } from 'lucide-react';
import toast from 'react-hot-toast';
import OrgSelect from '../OrgSelect';
import { generateCaption, optimizeForSEO } from '../../../services/ApiService';
import { generateImageCaptionSuggestions, normalizeHashtagInput } from '../../../services/mediaCaptionSuggestions';

const MODES = [
  { value: 'fill_next_open_slots', label: 'Fill Next Open Slots', description: 'Use the earliest open slots across the selected range.' },
  { value: 'spread_evenly', label: 'Spread Evenly Across Range', description: 'Distribute selected items across the chosen window.' },
  { value: 'one_per_day', label: 'One Per Day / Max 1', description: 'Place one selected item on each day in sequence.' },
  { value: 'best_times', label: 'Use Suggested Best Times', description: 'Use platform-weighted best-time defaults when available.' },
];

const MAX_HASHTAGS = 10;

function toDateInputValue(date) {
  const nextDate = new Date(date);
  if (Number.isNaN(nextDate.getTime())) return '';
  return nextDate.toISOString().slice(0, 10);
}

function toTimeInputValue(date) {
  const nextDate = new Date(date);
  if (Number.isNaN(nextDate.getTime())) return '';
  const hours = String(nextDate.getHours()).padStart(2, '0');
  const minutes = String(nextDate.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function buildLocalIso(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const parsed = new Date(`${dateValue}T${timeValue}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getMediaPreviewUrl(record) {
  return record?.mediaPreviewUrl || record?.thumbnailUrl || null;
}

function normalizePlanEntry(entry) {
  const scheduledAt = entry?.scheduledAt || new Date().toISOString();
  return {
    id: entry.record.id,
    record: entry.record,
    scheduleDate: toDateInputValue(scheduledAt),
    scheduleTime: toTimeInputValue(scheduledAt) || '10:00',
    caption: String(entry.caption || '').trim(),
    hashtagsInput: (Array.isArray(entry.hashtags) ? entry.hashtags : []).join(' '),
    mediaPreviewUrl: entry.mediaPreviewUrl || getMediaPreviewUrl(entry.record),
  };
}

function getValidationState(row, existingRecords = [], draftRows = []) {
  const isoValue = buildLocalIso(row.scheduleDate, row.scheduleTime);
  if (!isoValue) {
    return { ok: false, message: 'Choose a valid date and time.' };
  }

  const scheduledAt = new Date(isoValue);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const scheduleDay = new Date(scheduledAt);
  scheduleDay.setHours(0, 0, 0, 0);

  if (scheduleDay < today) {
    return { ok: false, message: 'Past dates are locked.' };
  }

  const roundedTarget = new Date(isoValue).toISOString().slice(0, 16);
  const existingConflict = existingRecords.some((record) => (
    record.id !== row.record.id
    && record.scheduledAt
    && new Date(record.scheduledAt).toISOString().slice(0, 16) === roundedTarget
  ));

  const draftConflict = draftRows.some((entry) => (
    entry.id !== row.id
    && buildLocalIso(entry.scheduleDate, entry.scheduleTime)
    && new Date(buildLocalIso(entry.scheduleDate, entry.scheduleTime)).toISOString().slice(0, 16) === roundedTarget
  ));

  if (existingConflict || draftConflict) {
    return { ok: true, warning: 'This slot already has scheduled content. Review before confirming.' };
  }

  return { ok: true, warning: '' };
}

function normalizePlatform(platform) {
  const value = String(platform || '').trim().toLowerCase();
  if (!value) return 'instagram';
  if (value === 'x') return 'twitter';
  return value;
}

export default function CalendarBatchScheduleModal({
  open = false,
  records = [],
  existingRecords = [],
  onClose,
  onPreview,
  onExecute,
}) {
  const [mode, setMode] = useState('fill_next_open_slots');
  const [rangeStart, setRangeStart] = useState(() => toDateInputValue(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => toDateInputValue(new Date(Date.now() + (6 * 24 * 60 * 60 * 1000))));
  const [executing, setExecuting] = useState(false);
  const [optimizingId, setOptimizingId] = useState(null);
  const [rows, setRows] = useState([]);

  const preview = useMemo(() => onPreview?.({
    records,
    existingRecords,
    mode,
    rangeStart,
    rangeEnd,
  }) || { plan: [], skipped: [] }, [existingRecords, mode, onPreview, rangeEnd, rangeStart, records]);

  useEffect(() => {
    if (!open) return;
    setRows(preview.plan.map(normalizePlanEntry));
  }, [open, preview.plan]);

  const rowsWithValidation = useMemo(() => rows.map((row) => ({
    ...row,
    validation: getValidationState(row, existingRecords, rows),
  })), [existingRecords, rows]);

  const invalidCount = rowsWithValidation.filter((row) => !row.validation.ok).length;

  if (!open) return null;

  const updateRow = (rowId, patch) => {
    setRows((current) => current.map((row) => (
      row.id === rowId
        ? { ...row, ...patch }
        : row
    )));
  };

  const handleOptimize = async (row) => {
    setOptimizingId(row.id);
    try {
      const platform = normalizePlatform(row.record.platform);
      const normalizedTags = normalizeHashtagInput(row.hashtagsInput, MAX_HASHTAGS);

      if (row.caption.trim()) {
        const optimized = await optimizeForSEO(row.caption.trim(), normalizedTags);
        updateRow(row.id, {
          caption: String(optimized.optimizedCaption || row.caption).trim(),
          hashtagsInput: normalizeHashtagInput(optimized.optimizedHashtags || normalizedTags, MAX_HASHTAGS).join(' '),
        });
      } else if (row.mediaPreviewUrl) {
        const suggestions = await generateImageCaptionSuggestions({
          imageUrl: row.mediaPreviewUrl,
          platforms: [platform],
          count: 1,
          maxHashtags: MAX_HASHTAGS,
        });
        const first = suggestions[0];
        if (first) {
          updateRow(row.id, {
            caption: first.caption,
            hashtagsInput: normalizeHashtagInput(first.hashtags || [], MAX_HASHTAGS).join(' '),
          });
        }
      } else {
        const generated = await generateCaption(row.record.previewText || row.record.title || 'New post', platform);
        updateRow(row.id, {
          caption: String(generated.caption || row.caption).trim(),
          hashtagsInput: normalizeHashtagInput(generated.hashtags || [], MAX_HASHTAGS).join(' '),
        });
      }
    } catch (error) {
      toast.error(error?.message || 'Could not optimize this item.');
    } finally {
      setOptimizingId(null);
    }
  };

  const handleExecute = async () => {
    const invalidRows = rowsWithValidation.filter((row) => !row.validation.ok);
    if (invalidRows.length > 0) {
      toast.error('Resolve the invalid scheduling rows before continuing.');
      return;
    }

    setExecuting(true);
    try {
      await onExecute?.({
        plan: rowsWithValidation.map((row) => ({
          record: row.record,
          scheduledAt: buildLocalIso(row.scheduleDate, row.scheduleTime),
          caption: row.caption.trim(),
          hashtags: normalizeHashtagInput(row.hashtagsInput, MAX_HASHTAGS),
        })),
      });
      onClose?.();
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="org-calendar-modal-shell" role="dialog" aria-modal="true" aria-label="Batch schedule content">
      <button type="button" className="org-calendar-modal-backdrop" onClick={onClose} aria-label="Close batch scheduling" />

      <section className="org-calendar-modal-surface batch-editor">
        <header className="org-calendar-modal-header">
          <div>
            <span className="org-calendar-saved-kicker">Batch Scheduling</span>
            <h3>Schedule Selected Content</h3>
            <p>{records.length} selected items are ready for scheduling. Review each row before confirming.</p>
          </div>
          <button type="button" className="org-close-button" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="org-calendar-modal-grid batch-editor">
          <div className="org-calendar-modal-panel">
            <label className="org-calendar-input-block">
              <span>Scheduling Mode</span>
              <OrgSelect
                value={mode}
                options={MODES.map((item) => ({
                  value: item.value,
                  label: item.label,
                  description: item.description,
                }))}
                onChange={setMode}
              />
            </label>

            <div className="org-calendar-modal-range">
              <label className="org-calendar-input-block">
                <span>Start Date</span>
                <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
              </label>

              <label className="org-calendar-input-block">
                <span>End Date</span>
                <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
              </label>
            </div>

            <div className="org-calendar-batch-hint">
              <CalendarClock size={15} />
              <span>{MODES.find((item) => item.value === mode)?.description}</span>
            </div>

            {preview.skipped.length > 0 ? (
              <div className="org-calendar-modal-section">
                <strong>Skipped</strong>
                <div className="org-calendar-batch-preview-list">
                  {preview.skipped.map((entry) => (
                    <div key={entry.id} className="org-calendar-batch-preview-item muted">
                      <strong>{entry.title}</strong>
                      <span>{entry.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="org-calendar-modal-panel batch-rows">
            <div className="org-calendar-modal-section">
              <strong>Item Editor</strong>
              <span>{rowsWithValidation.length} rows ready for final review.</span>
            </div>

            {rowsWithValidation.length === 0 ? (
              <div className="org-calendar-empty-inline">No valid schedule could be created for the current selection.</div>
            ) : (
              <div className="org-calendar-batch-editor-list">
                {rowsWithValidation.map((row) => (
                  <article key={row.id} className={`org-calendar-batch-editor-card ${row.validation.ok ? '' : 'invalid'}`.trim()}>
                    <div className="org-calendar-batch-editor-media">
                      {row.mediaPreviewUrl ? (
                        <img src={row.mediaPreviewUrl} alt={row.record.title} />
                      ) : (
                        <div className="org-calendar-batch-editor-fallback">{String(row.record.platformLabel || 'Post').slice(0, 2)}</div>
                      )}
                    </div>

                    <div className="org-calendar-batch-editor-main">
                      <div className="org-calendar-batch-editor-top">
                        <div>
                          <strong>{row.record.title}</strong>
                          <span>{row.record.platformLabel} | {row.record.statusLabel}</span>
                        </div>
                        <button
                          type="button"
                          className="org-text-button"
                          onClick={() => handleOptimize(row)}
                          disabled={optimizingId === row.id}
                        >
                          <Sparkles size={14} />
                          {optimizingId === row.id ? 'Optimizing...' : 'Optimize'}
                        </button>
                      </div>

                      <div className="org-calendar-batch-editor-schedule">
                        <label className="org-calendar-input-block">
                          <span>Date</span>
                          <input
                            type="date"
                            value={row.scheduleDate}
                            onChange={(event) => updateRow(row.id, { scheduleDate: event.target.value })}
                          />
                        </label>
                        <label className="org-calendar-input-block">
                          <span>Time</span>
                          <input
                            type="time"
                            value={row.scheduleTime}
                            onChange={(event) => updateRow(row.id, { scheduleTime: event.target.value })}
                          />
                        </label>
                      </div>

                      <label className="org-calendar-input-block">
                        <span>Caption</span>
                        <textarea
                          value={row.caption}
                          rows={3}
                          onChange={(event) => updateRow(row.id, { caption: event.target.value })}
                          placeholder="Write or optimize a caption for this scheduled post."
                        />
                      </label>

                      <label className="org-calendar-input-block">
                        <span>Hashtags</span>
                        <input
                          type="text"
                          value={row.hashtagsInput}
                          onChange={(event) => updateRow(row.id, { hashtagsInput: event.target.value })}
                          placeholder="#launch #content #brand"
                        />
                      </label>

                      <div className={`org-calendar-batch-editor-validation ${row.validation.ok ? 'ok' : 'error'}`.trim()}>
                        {row.validation.warning || row.validation.message || 'Ready to schedule.'}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="org-calendar-modal-actions">
          <button type="button" className="org-text-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="org-primary-button"
            disabled={executing || rowsWithValidation.length === 0 || invalidCount > 0}
            onClick={handleExecute}
          >
            {executing ? 'Scheduling...' : `Schedule ${rowsWithValidation.length} Items`}
          </button>
        </footer>
      </section>
    </div>
  );
}
