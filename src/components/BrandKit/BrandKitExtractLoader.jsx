import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import useBrandKitStore from '../../stores/BrandKitStore';
import { Button } from '../../ui-v2';
import styles from './BrandKit.module.css';

// Mockup shows 4 conceptual stages (not the old build's 7) — reconciled per
// the task brief: keep the real staged-progress mechanism (honest UX layered
// over one real network call) but simplify the label set. Doc-mode has an
// "Uploading" stage that URL-mode skips (no upload step for a live URL).
function buildStages(hasFile) {
  const stages = [];
  if (hasFile) stages.push({ id: 'uploading', label: 'Uploading document', pct: 15 });
  stages.push({ id: 'reading', label: hasFile ? 'Reading document structure' : 'Reading your site', pct: hasFile ? 35 : 30 });
  stages.push({ id: 'extracting', label: 'Extracting brand fields', pct: 70 });
  stages.push({ id: 'drafting', label: 'Drafting your kit for review', pct: 95 });
  return stages;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BrandKitExtractLoader({
  file,
  websiteUrl,
  onComplete,
  onFallbackToConversational,
  onCancel,
  mode = 'setup',
}) {
  const hasFile = Boolean(file);
  const STAGES = useRef(buildStages(hasFile)).current;
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [stageStatuses, setStageStatuses] = useState(
    STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? 'active' : 'pending' })),
  );
  const cancelledRef = useRef(false);
  const timerRefs = useRef([]);
  const setExtractedDraft = useBrandKitStore((state) => state.setExtractedDraft);

  const clearTimers = () => {
    timerRefs.current.forEach((timer) => clearTimeout(timer));
    timerRefs.current = [];
  };

  const advanceStage = (index) => {
    if (cancelledRef.current) return;
    const nextPct = STAGES[index]?.pct ?? 100;
    setProgress(nextPct);
    setStageStatuses((prev) => prev.map((stage, idx) => ({
      ...stage,
      status: idx < index ? 'done' : idx === index ? 'active' : 'pending',
    })));
  };

  const markStageDone = (index) => {
    setStageStatuses((prev) => prev.map((stage, idx) => (
      idx === index ? { ...stage, status: 'done' } : stage
    )));
  };

  useEffect(() => {
    if (!file && !websiteUrl) return undefined;

    const runExtraction = async () => {
      try {
        let invokeBody;

        if (hasFile) {
          advanceStage(0);
          const { data: { user } } = await supabase.auth.getUser();
          if (!user?.id) throw new Error('Not authenticated');

          const storagePath = `${user.id}/brand_docs/${Date.now()}_${file.name}`;
          const { error: uploadErr } = await supabase.storage
            .from('brand_assets')
            .upload(storagePath, file);

          if (uploadErr) throw uploadErr;
          markStageDone(0);
          advanceStage(1);
          invokeBody = { storagePath, fileName: file.name, mimeType: file.type };
        } else {
          advanceStage(0); // "reading" is stage 0 in URL mode
          invokeBody = { websiteUrl };
        }

        await delay(500);
        const readingIdx = hasFile ? 1 : 0;
        markStageDone(readingIdx);
        advanceStage(readingIdx + 1); // "extracting"

        timerRefs.current = [
          setTimeout(() => {
            markStageDone(readingIdx + 1);
            advanceStage(readingIdx + 2); // "drafting"
          }, 1800),
        ];

        const { data, error: fnErr } = await supabase.functions.invoke('extractBrandKit', { body: invokeBody });

        clearTimers();
        if (cancelledRef.current) return;
        if (fnErr) throw fnErr;

        setProgress(100);
        setStageStatuses((prev) => prev.map((stage) => ({ ...stage, status: 'done' })));

        const extracted = data?.brandKit || {};
        const confidence = data?.confidenceMap || {};
        const missingTier1Fields = data?.missingTier1Fields || [];
        setExtractedDraft(extracted, confidence, missingTier1Fields);

        await delay(250);
        if (mode === 'setup' && missingTier1Fields.length >= 2) {
          onFallbackToConversational?.(missingTier1Fields, extracted);
          return;
        }

        onComplete?.(extracted, confidence, missingTier1Fields);
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err?.message || 'Extraction failed');
        }
      }
    };

    runExtraction();

    return () => {
      cancelledRef.current = true;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, websiteUrl, mode]);

  const handleCancel = () => {
    cancelledRef.current = true;
    clearTimers();
    if (onCancel) onCancel();
  };

  const sourceLabel = hasFile ? file.name : (websiteUrl || 'your site');

  if (error) {
    return (
      <div className={styles.extractWrap}>
        <div className={styles.extractError}>
          <AlertCircle size={32} className={styles.extractErrorIcon} />
          <h2 className={styles.extractErrorTitle}>Extraction failed</h2>
          <p className={styles.extractErrorText}>{error}</p>
          <p className={styles.extractErrorHint}>
            {hasFile
              ? 'Scanned or image-only documents can fail. You can continue with guided setup.'
              : "We couldn't read that site. You can continue with guided setup."}
          </p>
          <Button onClick={() => onFallbackToConversational?.([], {})}>Guide me with AI instead</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.extractWrap}>
      <h2 className={styles.extractTitle}>Reading {sourceLabel}…</h2>

      <div className={styles.extractStages}>
        {stageStatuses.map((stage) => (
          <div
            key={stage.id}
            className={[styles.extractStage, stage.status === 'active' ? styles.extractStageActive : '', stage.status === 'done' ? styles.extractStageDone : ''].filter(Boolean).join(' ')}
          >
            <span className={styles.extractStageIcon}>
              {stage.status === 'done' && <Check size={12} />}
              {stage.status === 'active' && <Loader2 size={12} className={styles.spin} />}
            </span>
            <span className={styles.extractStageLabel}>{stage.label}</span>
            {stage.status === 'active' && <span className={styles.extractStageStatus}>Active…</span>}
            {stage.status === 'done' && <span className={[styles.extractStageStatus, styles.extractStageStatusDone].join(' ')}>Done</span>}
          </div>
        ))}
      </div>

      <div
        className={styles.extractProgressTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Extraction progress"
      >
        <div className={styles.extractProgressFill} style={{ width: `${progress}%` }} />
      </div>
      <span className={styles.extractPct}>{progress}%</span>
      <p className={styles.extractEta}>
        {hasFile ? 'This usually takes under a minute.' : 'This usually takes ~30 seconds.'}
      </p>

      <Button variant="ghost" size="sm" onClick={handleCancel}>
        <X size={14} />
        Cancel
      </Button>
    </div>
  );
}
