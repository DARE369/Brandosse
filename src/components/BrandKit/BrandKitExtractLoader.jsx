import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import useBrandKitStore from '../../stores/BrandKitStore';
import { Button } from '../../ui-v2';
import styles from './BrandKit.module.css';

// ── Why there are no percentages here any more ──────────────────────────────
//
// This used to show a determinate bar driven by setTimeout: "Reading your site"
// completed after 500ms and "Extracting brand fields" after 1800ms, whatever the
// server was actually doing. The bar then sat frozen at 30% for the entire real
// duration — measured at 22.8s against a live site — under the words "This
// usually takes ~30 seconds". A founder reported it as "stuck for ages"; it had
// in fact succeeded.
//
// A percentage the client cannot know is a lie, and a stalled bar is a worse
// lie than no bar: it reads as a hang. There is ONE network call here and no
// progress stream, so the only things genuinely known are "the request is in
// flight" and "it came back".
//
// So: stages reflect real transitions only, the bar is indeterminate while
// waiting, and the number shown is ELAPSED TIME, which is true by construction
// and tells the user the thing they actually want — is it still going.
function buildStages(hasFile) {
  const stages = [];
  if (hasFile) stages.push({ id: 'uploading', label: 'Uploading document' });
  stages.push({ id: 'reading', label: hasFile ? 'Reading your document' : 'Reading your site' });
  stages.push({ id: 'drafting', label: 'Building your kit' });
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
  // Elapsed seconds. The only honest number available on this screen.
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [stageStatuses, setStageStatuses] = useState(
    STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? 'active' : 'pending' })),
  );
  const cancelledRef = useRef(false);
  // The in-flight extraction, keyed by its input.
  //
  // StrictMode mounts every effect twice, and this effect makes a PAID call:
  // a live run against lordswayenergy.com showed two 200s from extractBrandKit
  // for one click — two site crawls and two LLM calls, billed, for one import.
  // Holding the promise here means the second mount attaches to the first
  // request instead of starting another. Keyed by input so a genuinely
  // different file or URL still starts fresh.
  const inFlightRef = useRef(null);
  const timerRefs = useRef([]);
  const setExtractedDraft = useBrandKitStore((state) => state.setExtractedDraft);

  // A real clock, started when the request goes out and stopped when it lands.
  useEffect(() => {
    if (!file && !websiteUrl) return undefined;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (!cancelledRef.current) setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [file, websiteUrl]);

  const clearTimers = () => {
    timerRefs.current.forEach((timer) => clearTimeout(timer));
    timerRefs.current = [];
  };

  const advanceStage = (index) => {
    if (cancelledRef.current) return;
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

    // MUST be reset here, not just set in the cleanup.
    //
    // The cleanup sets cancelledRef.current = true, and nothing ever set it
    // back. React StrictMode (reactStrictMode: true in next.config.mjs) mounts
    // every effect, tears it down, and mounts it again — so by the second mount
    // the flag was permanently true. The extraction then ran, the server did
    // the work and charged for it, the response came back, and
    // `if (cancelledRef.current) return` threw it away without completing.
    //
    // The screen sat on "Reading your site" forever. It looked like a hang and
    // was reported as one; the request had in fact succeeded in ~23 seconds.
    cancelledRef.current = false;

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

        // The request is the long part, and nothing reports back from inside it.
        // The "reading" stage therefore stays ACTIVE for its real duration
        // instead of being marked done by a timer that knows nothing.
        const readingIdx = hasFile ? 1 : 0;
        // One request per input, however many times this effect runs.
        const requestKey = hasFile
          ? `file:${file.name}:${file.size}:${file.lastModified}`
          : `url:${websiteUrl}`;
        if (!inFlightRef.current || inFlightRef.current.key !== requestKey) {
          inFlightRef.current = {
            key: requestKey,
            promise: supabase.functions.invoke('extractBrandKit', { body: invokeBody }),
          };
        }
        const { data, error: fnErr } = await inFlightRef.current.promise;

        clearTimers();
        if (cancelledRef.current) return;
        if (fnErr) throw fnErr;

        // Only now is reading genuinely finished.
        markStageDone(readingIdx);
        advanceStage(readingIdx + 1);
        setStageStatuses((prev) => prev.map((stage) => ({ ...stage, status: 'done' })));

        const extracted = data?.brandKit || {};
        const confidence = data?.confidenceMap || {};
        const missingTier1Fields = data?.missingTier1Fields || [];
        // The design layer and its provenance only exist on the website path;
        // document and conversation imports have no CSS to measure.
        const design = data?.design || null;
        if (design?.extraction_evidence) {
          extracted.extraction_evidence = design.extraction_evidence;
        }
        setExtractedDraft(extracted, confidence, missingTier1Fields, design);

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

      {/* Indeterminate on purpose: there is no progress stream to report, and a
          bar frozen at a number reads as a hang. This one keeps moving for as
          long as the work is genuinely still running. */}
      <div
        className={styles.extractProgressTrack}
        role="progressbar"
        aria-valuetext={`Working — ${elapsed} seconds elapsed`}
        aria-label="Extraction progress"
      >
        <div className={styles.extractProgressIndeterminate} />
      </div>

      <span className={styles.extractPct}>{elapsed}s</span>

      {/* Says something different once it runs long, so a slow site never looks
          the same as a stuck one. Thresholds are set from a measured run:
          22.8s against a real multi-page site. */}
      <p className={styles.extractEta}>
        {elapsed < 30 && (hasFile
          ? 'Reading your document. This usually takes under a minute.'
          : 'Reading your site, a few pages at a time. Usually 20–40 seconds.')}
        {elapsed >= 30 && elapsed < 75 && (hasFile
          ? 'Still going — longer documents take a little more.'
          : 'Still going. Sites with more pages take longer to read.')}
        {elapsed >= 75 && 'Taking longer than usual. It is still running — you can wait, or cancel and use guided setup.'}
      </p>

      <Button variant="ghost" size="sm" onClick={handleCancel}>
        <X size={14} />
        Cancel
      </Button>
    </div>
  );
}
