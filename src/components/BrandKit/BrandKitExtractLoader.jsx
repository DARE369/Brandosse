import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import useBrandKitStore from '../../stores/BrandKitStore';

const STAGES = [
  { id: 'uploading', label: 'Uploading document', pct: 10 },
  { id: 'reading', label: 'Reading document structure', pct: 20 },
  { id: 'identity', label: 'Extracting brand identity', pct: 40 },
  { id: 'voice', label: 'Extracting voice and tone', pct: 55 },
  { id: 'visual', label: 'Identifying visual style', pct: 70 },
  { id: 'guardrails', label: 'Checking guardrails', pct: 82 },
  { id: 'building', label: 'Building your Brand Kit', pct: 95 },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BrandKitExtractLoader({
  file,
  onComplete,
  onFallbackToConversational,
  onCancel,
  mode = 'setup',
}) {
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
    if (!file) return undefined;

    const runExtraction = async () => {
      try {
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
        await delay(650);
        markStageDone(1);
        advanceStage(2);

        timerRefs.current = [
          setTimeout(() => advanceStage(3), 1700),
          setTimeout(() => advanceStage(4), 3400),
          setTimeout(() => advanceStage(5), 5200),
          setTimeout(() => advanceStage(6), 6800),
        ];

        const { data, error: fnErr } = await supabase.functions.invoke('extractBrandKit', {
          body: { storagePath, fileName: file.name, mimeType: file.type },
        });

        clearTimers();
        if (cancelledRef.current) return;
        if (fnErr) throw fnErr;

        advanceStage(6);
        await delay(300);
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
  }, [file, mode, onComplete, onFallbackToConversational, setExtractedDraft]);

  const handleCancel = () => {
    cancelledRef.current = true;
    clearTimers();
    if (onCancel) onCancel();
  };

  if (error) {
    return (
      <div className="bk-extract-loader">
        <div className="bk-extract-error">
          <AlertCircle size={32} color="var(--bk-danger)" />
          <h2>Extraction failed</h2>
          <p>{error}</p>
          <p className="bk-text-2">
            Scanned or image-only documents can fail. You can continue with guided setup.
          </p>
          <button
            className="bk-btn-primary"
            onClick={() => onFallbackToConversational?.([], {})}
            type="button"
          >
            Guide me with AI instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bk-extract-loader">
      <div className="bk-extract-bg-glow" aria-hidden="true" />

      <h2 className="bk-extract-title">Reading your document...</h2>

      <div className="bk-extract-stages">
        {stageStatuses.map((stage) => (
          <div key={stage.id} className={`bk-extract-stage ${stage.status}`}>
            <div className="bk-extract-stage-icon">
              {stage.status === 'done' && <Check size={14} />}
              {stage.status === 'active' && <Loader2 size={14} className="bk-spin" />}
            </div>
            <span className="bk-extract-stage-label">{stage.label}</span>
            {stage.status === 'active' && <span className="bk-extract-stage-status">Active...</span>}
            {stage.status === 'done' && <span className="bk-extract-stage-status done">Done</span>}
          </div>
        ))}
      </div>

      <div
        className="bk-extract-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Extraction progress"
      >
        <div className="bk-extract-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="bk-extract-pct">{progress}%</span>
      <p className="bk-extract-eta">This usually takes 15-30 seconds.</p>

      <button className="bk-btn-ghost bk-extract-cancel" onClick={handleCancel} type="button">
        <X size={14} />
        Cancel
      </button>
    </div>
  );
}
