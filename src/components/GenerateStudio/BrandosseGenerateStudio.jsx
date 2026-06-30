"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import toast from 'react-hot-toast';
import useSessionStore from '../../stores/SessionStore';
import useBrandKitStore from '../../stores/BrandKitStore';
import { useAuth } from '../../Context/AuthContext';
import {
  MAGNIFIC_CONTENT_TYPES,
  estimateMagnificCost,
  getMagnificModelsForMode,
} from '../../config/magnificModels';

import StudioTopbar         from './StudioTopbar';
import StudioFlowSpine      from './StudioFlowSpine';
import StudioComposer       from './StudioComposer';
import StudioBriefSidebar   from './StudioBriefSidebar';
import StudioGeneratingView from './StudioGeneratingView';
import StudioDirectPanel    from './StudioDirectPanel';
import StudioPublishPanel   from './StudioPublishPanel';
import StudioPublishedPanel from './StudioPublishedPanel';
import StudioCanvas         from './StudioCanvas';
import StudioPromptBar      from './promptbar/StudioPromptBar';
import StudioAdvancedSheet  from './promptbar/StudioAdvancedSheet';
import StudioLightbox       from './lightbox/StudioLightbox';
import PostProductionSheet  from './postproduction/PostProductionSheet';

import useConnectedAccounts from './hooks/useConnectedAccounts';
import useStudioCredits     from './hooks/useStudioCredits';

import { PLATFORM_DEFAULT_RATIO, PROMPT_LIMIT } from './shared/constants';
import { getAssetMetadata, isSeoLocked, normalizeCredits } from './shared/helpers';

import '../../styles/BrandosseGenerateStudio.css';

/* ─────────────────────────────────────────────────────────────────────────────
   BrandosseGenerateStudio — thin orchestrator.
   Stage machine: brief → generating → results → publish
   ───────────────────────────────────────────────────────────────────────────── */
export default function BrandosseGenerateStudio({
  postPanelOpen,
  onClosePostPanel,
  onCreateSession,
}) {
  const { profile } = useAuth();
  const brandKit    = useBrandKitStore((s) => s.brandKit);

  const {
    activeSession,
    activeGenerations,
    selectedGeneration,
    selectedGenerationId,
    isGenerating,
    generationProgress,
    progressLabel,
    error,
    settings,
    postProduction,
    updateSettings,
    startGeneration,
    startCarouselGeneration,
    startEditGeneration,
    enhancePrompt,
    selectGeneration,
    hydratePostProductionFromGeneration,
    regeneratePostMetadata,
    optimizeSeo,
    updatePostProduction,
    saveDraft,
    publishContent,
  } = useSessionStore();

  /* ── Local state ─────────────────────────────────────────────────────────── */
  const [prompt,           setPrompt]           = useState('');
  const [sourceImageUrl,   setSourceImageUrl]   = useState('');
  const [enhancing,        setEnhancing]        = useState(false);
  const [localError,       setLocalError]       = useState('');
  const [publishing,          setPublishing]          = useState(false);
  const [publishedPlatforms,  setPublishedPlatforms]  = useState([]);
  const [previewAccountId,    setPreviewAccountId]    = useState(null);

  /* Flow stage: 'brief' | 'generating' | 'results' | 'publish' */
  const [studioStage, setStudioStage] = useState('brief');

  /* Legacy state (chip popovers, advanced drawer, lightbox, post drawer) */
  const [activeChip,    setActiveChip]    = useState(null);
  const [advancedOpen,  setAdvancedOpen]  = useState(false);
  const [lightboxOpen,  setLightboxOpen]  = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [postDrawerOpen, setPostDrawerOpen] = useState(false);
  const [tagValue,       setTagValue]       = useState('');

  const promptRef        = useRef(null);
  const automationRunRef = useRef(new Set());

  /* ── Hooks ───────────────────────────────────────────────────────────────── */
  const { accounts, accountsLoading } = useConnectedAccounts();
  const { credits }                   = useStudioCredits(profile);

  /* ── Derived ─────────────────────────────────────────────────────────────── */
  const selectedMode = useMemo(() => {
    if (settings.mediaType === 'image-to-video') return 'image-to-video';
    if (settings.mediaType === 'edit')           return 'edit';
    if (settings.mediaType === 'video')          return 'video';
    if (settings.contentType === 'carousel')     return 'carousel';
    return 'image';
  }, [settings.mediaType, settings.contentType]);

  const cost             = useMemo(() => estimateMagnificCost(settings), [settings]);
  const availableCredits = useMemo(() => normalizeCredits(credits, profile), [credits, profile]);
  const canAfford        = availableCredits >= cost;
  const seoLocked        = isSeoLocked(postProduction);
  const aspectRatioCss   = (settings.aspectRatio || '1:1').replace(':', ' / ');

  const completedGenerations = useMemo(
    () => activeGenerations.filter((g) => g.status === 'completed'),
    [activeGenerations],
  );

  const lightboxGeneration = completedGenerations[lightboxIndex] || null;
  const lightboxMeta       = lightboxGeneration ? getAssetMetadata(lightboxGeneration) : {};
  const lightboxPrev       = lightboxIndex > 0;
  const lightboxNext       = lightboxIndex < completedGenerations.length - 1;

  const selectedAccounts = useMemo(
    () => accounts.filter((a) => postProduction.selectedPlatforms.includes(a.id)),
    [accounts, postProduction.selectedPlatforms],
  );
  const previewAccount = selectedAccounts.find((a) => a.id === previewAccountId) || selectedAccounts[0] || null;

  const shimmerCount = useMemo(() => {
    if (!isGenerating) return 0;
    if (selectedMode === 'carousel') return settings.slideCount === 'auto' ? 6 : Number(settings.slideCount || 6);
    if (selectedMode === 'image')    return Number(settings.batchSize || 1);
    return 1;
  }, [isGenerating, selectedMode, settings.slideCount, settings.batchSize]);

  const topPickGeneration = completedGenerations[0] || null;

  /* ── Stage transitions ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (isGenerating) setStudioStage('generating');
  }, [isGenerating]);

  useEffect(() => {
    if (!isGenerating && completedGenerations.length > 0 && studioStage === 'generating') {
      setStudioStage('results');
    }
  }, [isGenerating, completedGenerations.length, studioStage]);

  /* ── External events ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const onSeedPrompt = (e) => {
      const p = String(e?.detail?.prompt || '').trim();
      if (p) { setPrompt(p.slice(0, PROMPT_LIMIT)); setStudioStage('brief'); }
    };
    const onEdit = (e) => {
      const d = e?.detail || {};
      if (d.sourceImageUrl) setSourceImageUrl(d.sourceImageUrl);
      if (d.prompt) setPrompt(String(d.prompt).slice(0, PROMPT_LIMIT));
      updateSettings({ mediaType: 'edit', contentType: 'single', referenceImageUrl: d.sourceImageUrl || '', model: 'seedream-v4-5-edit' });
      setStudioStage('brief');
    };
    window.addEventListener('socialai:seed-prompt', onSeedPrompt);
    window.addEventListener('socialai:activate-generation-edit', onEdit);
    return () => {
      window.removeEventListener('socialai:seed-prompt', onSeedPrompt);
      window.removeEventListener('socialai:activate-generation-edit', onEdit);
    };
  }, [updateSettings]);

  /* Legacy: postPanelOpen prop opens the old drawer */
  useEffect(() => {
    if (postPanelOpen && selectedGeneration) setPostDrawerOpen(true);
  }, [postPanelOpen, selectedGeneration?.id]);

  /* Post-production automation for the old drawer */
  useEffect(() => {
    if (!postDrawerOpen || !selectedGeneration?.id) return;
    if (automationRunRef.current.has(selectedGeneration.id)) return;
    automationRunRef.current.add(selectedGeneration.id);
    let cancelled = false;
    (async () => {
      try {
        const draft = await hydratePostProductionFromGeneration(selectedGeneration.id);
        const pp = useSessionStore.getState().postProduction;
        const metaMissing = !String(pp.title || '').trim()
          || !String(pp.caption || '').trim()
          || !Array.isArray(pp.hashtags) || pp.hashtags.length === 0
          || pp.metadataStatus !== 'completed';
        if (metaMissing || !draft) await regeneratePostMetadata(['title', 'caption', 'hashtags']);
        if (!cancelled) await optimizeSeo();
      } catch (err) {
        if (!cancelled) toast.error(err?.message || 'Post preparation failed.');
      }
    })();
    return () => { cancelled = true; };
  }, [postDrawerOpen, selectedGeneration?.id, hydratePostProductionFromGeneration, regeneratePostMetadata, optimizeSeo]);

  /* Auto-hydrate captions when entering publish stage */
  useEffect(() => {
    if (studioStage !== 'publish' || !selectedGeneration?.id) return;
    if (automationRunRef.current.has(`pub_${selectedGeneration.id}`)) return;
    automationRunRef.current.add(`pub_${selectedGeneration.id}`);
    (async () => {
      try {
        await hydratePostProductionFromGeneration(selectedGeneration.id);
        const pp = useSessionStore.getState().postProduction;
        if (!String(pp.caption || '').trim()) {
          await regeneratePostMetadata(['title', 'caption', 'hashtags']);
        }
      } catch { /* silent — captions are optional */ }
    })();
  }, [studioStage, selectedGeneration?.id, hydratePostProductionFromGeneration, regeneratePostMetadata]);

  /* Keyboard: lightbox navigation */
  useEffect(() => {
    if (!lightboxOpen) return;
    const handle = (e) => {
      if (e.key === 'Escape')     { e.preventDefault(); setLightboxOpen(false); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); setLightboxIndex((i) => Math.max(0, i - 1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setLightboxIndex((i) => Math.min(completedGenerations.length - 1, i + 1)); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [lightboxOpen, completedGenerations.length]);

  /* ── Handlers ────────────────────────────────────────────────────────────── */
  const handleModeChange = useCallback((mode) => {
    const next      = MAGNIFIC_CONTENT_TYPES.find((t) => t.id === mode) || MAGNIFIC_CONTENT_TYPES[0];
    const nextModel = getMagnificModelsForMode(next.id)[0]?.id || 'realism';
    const isVid     = next.mediaType === 'video' || next.mediaType === 'image-to-video';
    updateSettings({
      mediaType:    next.mediaType,
      contentType:  next.contentType,
      model:        nextModel,
      batchSize:    next.id === 'image' ? Math.max(1, Number(settings.batchSize) || 1) : 1,
      slideCount:   next.id === 'carousel' ? (settings.slideCount || 6) : 'auto',
      resolution:   isVid ? '1080p' : '2k',
      duration:     isVid ? (nextModel === 'kling-v2-6-pro' ? 5 : 6) : settings.duration,
      referenceImageUrl: sourceImageUrl,
    });
    setActiveChip(null);
  }, [settings, sourceImageUrl, updateSettings]);

  const handleEnhance = useCallback(async () => {
    const src = prompt.trim();
    if (!src) return;
    setEnhancing(true);
    try {
      const result = await enhancePrompt(src);
      if (result?.enhanced) setPrompt(result.enhanced.slice(0, PROMPT_LIMIT));
    } catch (err) {
      toast.error(err?.message || 'Could not enhance prompt.');
    } finally {
      setEnhancing(false);
    }
  }, [prompt, enhancePrompt]);

  const validatePreflight = useCallback(() => {
    if (!prompt.trim())                                                                     return 'Prompt is required.';
    if (prompt.length > PROMPT_LIMIT)                                                       return `Prompt must be under ${PROMPT_LIMIT} characters.`;
    if ((selectedMode === 'edit' || selectedMode === 'image-to-video') && !sourceImageUrl.trim()) return 'A source image URL is required for this mode.';
    if (!canAfford)                                                                         return `This needs ${cost} credits. You have ${availableCredits}.`;
    return '';
  }, [prompt, selectedMode, sourceImageUrl, canAfford, cost, availableCredits]);

  const handleGenerate = useCallback(async () => {
    const err = validatePreflight();
    if (err) { setLocalError(err); toast.error(err); return; }
    setLocalError('');
    updateSettings({ referenceImageUrl: sourceImageUrl.trim() });
    try {
      if (selectedMode === 'carousel')       await startCarouselGeneration(prompt.trim(), settings.slideCount || 6);
      else if (selectedMode === 'edit')      await startEditGeneration(sourceImageUrl.trim(), prompt.trim());
      else if (selectedMode === 'video' || selectedMode === 'image-to-video') {
        const store = useSessionStore.getState();
        if (store.startVideoGeneration) await store.startVideoGeneration(prompt.trim());
        else await startGeneration(prompt.trim());
      } else {
        await startGeneration(prompt.trim());
      }
    } catch (genErr) {
      const msg = genErr?.message || 'Generation failed.';
      setLocalError(msg);
      toast.error(msg);
    }
  }, [validatePreflight, selectedMode, prompt, sourceImageUrl, settings, updateSettings, startGeneration, startCarouselGeneration, startEditGeneration]);

  /* Direct panel regeneration: prepend nudge to existing prompt */
  const handleDirectRegenerate = useCallback(async (nudge) => {
    const next = nudge
      ? `${prompt.trim()}. ${nudge}`.slice(0, PROMPT_LIMIT)
      : prompt;
    setPrompt(next);
    const err = validatePreflight();
    if (err) { toast.error(err); return; }
    setLocalError('');
    updateSettings({ referenceImageUrl: sourceImageUrl.trim() });
    try {
      await startGeneration(next);
    } catch (genErr) {
      toast.error(genErr?.message || 'Generation failed.');
    }
  }, [prompt, validatePreflight, sourceImageUrl, updateSettings, startGeneration]);

  /* Flow stage navigation */
  const handleStageClick = useCallback((stageId) => {
    setStudioStage(stageId);
  }, []);

  const handleGoToPublish = useCallback((gen) => {
    if (gen) selectGeneration(gen);
    setStudioStage('publish');
  }, [selectGeneration]);

  const openLightbox = useCallback((generation) => {
    selectGeneration(generation);
    const idx = completedGenerations.findIndex((g) => g.id === generation.id);
    setLightboxIndex(Math.max(0, idx));
    setLightboxOpen(true);
  }, [selectGeneration, completedGenerations]);

  const handleUseForPost = useCallback((generation) => {
    const gen = generation || lightboxGeneration || selectedGeneration;
    if (gen) selectGeneration(gen);
    setLightboxOpen(false);
    handleGoToPublish(gen);
  }, [lightboxGeneration, selectedGeneration, selectGeneration, handleGoToPublish]);

  const handleClosePostDrawer = useCallback(() => {
    setPostDrawerOpen(false);
    if (onClosePostPanel) onClosePostPanel();
  }, [onClosePostPanel]);

  const handleRegenerate = useCallback((generation) => {
    const src = generation?.prompt || selectedGeneration?.prompt || prompt;
    if (src) setPrompt(String(src).slice(0, PROMPT_LIMIT));
    setLightboxOpen(false);
    setStudioStage('brief');
    toast('Settings restored. Edit and generate again.');
  }, [selectedGeneration, prompt]);

  const addHashtag = useCallback(() => {
    const t = tagValue.trim();
    if (!t) return;
    const tag = t.startsWith('#') ? t : `#${t}`;
    updatePostProduction({ hashtags: [...postProduction.hashtags, tag] });
    setTagValue('');
  }, [tagValue, postProduction.hashtags, updatePostProduction]);

  const removeHashtag = useCallback((idx) => {
    updatePostProduction({ hashtags: postProduction.hashtags.filter((_, i) => i !== idx) });
  }, [postProduction.hashtags, updatePostProduction]);

  const addHashtagSuggestion = useCallback((tag) => {
    if (!postProduction.hashtags.includes(tag)) {
      updatePostProduction({ hashtags: [...postProduction.hashtags, tag] });
    }
  }, [postProduction.hashtags, updatePostProduction]);

  const toggleAccount = useCallback((id) => {
    const cur = postProduction.selectedPlatforms;
    updatePostProduction({ selectedPlatforms: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
    setPreviewAccountId(id);
  }, [postProduction.selectedPlatforms, updatePostProduction]);

  const handleSaveDraft = useCallback(async () => {
    setPublishing(true);
    try {
      const result = await saveDraft();
      toast.success(result?.message || 'Saved as draft.');
      setStudioStage('brief');
    } catch (err) {
      toast.error(err?.message || 'Could not save draft.');
    } finally {
      setPublishing(false);
    }
  }, [saveDraft]);

  const handlePublish = useCallback(async (activePlatforms = []) => {
    setPublishing(true);
    try {
      const result = await publishContent();
      setPublishedPlatforms(activePlatforms);
      toast.success(result?.message || 'Post queued (simulated).');
      setStudioStage('published');
    } catch (err) {
      toast.error(err?.message || 'Could not publish post.');
    } finally {
      setPublishing(false);
    }
  }, [publishContent]);

  /* Auto-resize textarea */
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [prompt]);

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <>
      {/* ══ ROOT SHELL (grid: topbar | spine | center + right) ══════════════ */}
      <div className={`studio-shell studio-shell--${studioStage}`}>

        {/* Ambient background orbs */}
        <div className="studio-ambient-bg" aria-hidden="true">
          <div className="studio-ambient-orb studio-ambient-orb--1" />
          <div className="studio-ambient-orb studio-ambient-orb--2" />
          <div className="studio-ambient-orb studio-ambient-orb--3" />
          <div className="studio-ambient-orb studio-ambient-orb--4" />
          <div className="studio-ambient-orb studio-ambient-orb--5" />
          <div className="studio-ambient-streak studio-ambient-streak--1" />
          <div className="studio-ambient-streak studio-ambient-streak--2" />
        </div>

        {/* ── Row 1: Topbar ──────────────────────────────────────────────── */}
        <StudioTopbar
          brandKit={brandKit}
          availableCredits={availableCredits}
        />

        {/* ── Row 2: Flow spine ──────────────────────────────────────────── */}
        <StudioFlowSpine
          currentStage={studioStage}
          onStageClick={handleStageClick}
        />

        {/* ── Row 3 Col 1: Center content ────────────────────────────────── */}
        <div className="studio-center">

          {/* Error bar (always visible if present) */}
          {(localError || error) && (
            <div className="studio-error-bar" role="alert">
              <span>{localError || error}</span>
              <button type="button" onClick={() => setLocalError('')} aria-label="Dismiss">✕</button>
            </div>
          )}

          {/* BRIEF: composer + past results */}
          {studioStage === 'brief' && (
            <>
              <StudioComposer
                selectedMode={selectedMode}
                onModeChange={handleModeChange}
                prompt={prompt}
                setPrompt={setPrompt}
                promptRef={promptRef}
                settings={settings}
                updateSettings={updateSettings}
                cost={cost}
                availableCredits={availableCredits}
                canAfford={canAfford}
                onEnhance={handleEnhance}
                enhancing={enhancing}
                isGenerating={isGenerating}
                onGenerate={handleGenerate}
              />
              {/* Show past results below composer if any */}
              {completedGenerations.length > 0 && (
                <StudioCanvas
                  localError=""
                  error=""
                  onDismissError={() => {}}
                  isGenerating={false}
                  generationProgress={0}
                  progressLabel=""
                  settings={settings}
                  showIntentCard={false}
                  intentDone={true}
                  selectedMode={selectedMode}
                  activeGenerations={completedGenerations}
                  onSelectSuggestion={(s) => setPrompt(s.slice(0, PROMPT_LIMIT))}
                  shimmerCount={0}
                  aspectRatioCss={aspectRatioCss}
                  selectedGenerationId={selectedGenerationId}
                  onOpenCard={openLightbox}
                  onUseForPost={handleGoToPublish}
                />
              )}
            </>
          )}

          {/* GENERATING: full-screen centered loading */}
          {studioStage === 'generating' && (
            <StudioGeneratingView
              selectedMode={selectedMode}
              settings={settings}
              shimmerCount={shimmerCount}
              generationProgress={generationProgress}
              progressLabel={progressLabel}
              prompt={prompt}
            />
          )}

          {/* RESULTS: result grid */}
          {studioStage === 'results' && (
            <StudioCanvas
              localError=""
              error=""
              onDismissError={() => {}}
              isGenerating={false}
              generationProgress={0}
              progressLabel=""
              settings={settings}
              showIntentCard={false}
              intentDone={true}
              selectedMode={selectedMode}
              activeGenerations={activeGenerations}
              onSelectSuggestion={(s) => setPrompt(s.slice(0, PROMPT_LIMIT))}
              shimmerCount={0}
              aspectRatioCss={aspectRatioCss}
              selectedGenerationId={selectedGenerationId}
              onOpenCard={openLightbox}
              onUseForPost={handleGoToPublish}
            />
          )}

          {/* PUBLISH / PUBLISHED: show asset preview on the left */}
          {(studioStage === 'publish' || studioStage === 'published') && selectedGeneration && (
            <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(selectedGeneration.output_url || selectedGeneration.thumbnail_url) && (
                <img
                  src={selectedGeneration.output_url || selectedGeneration.thumbnail_url}
                  alt="Selected generation"
                  style={{
                    borderRadius: 16,
                    maxWidth: '100%',
                    maxHeight: 480,
                    objectFit: 'contain',
                    border: '1.5px solid var(--bgs-border)',
                    background: 'var(--bgs-panel-2)',
                  }}
                />
              )}
              {/* Thumbnail strip for other results */}
              {completedGenerations.length > 1 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {completedGenerations.map((g, i) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => selectGeneration(g)}
                      style={{
                        width: 56, height: 56, borderRadius: 10, overflow: 'hidden',
                        border: `2px solid ${selectedGenerationId === g.id ? 'var(--bgs-primary)' : 'var(--bgs-border)'}`,
                        padding: 0, cursor: 'pointer', background: 'var(--bgs-panel-2)',
                      }}
                    >
                      {(g.thumbnail_url || g.output_url) && (
                        <img
                          src={g.thumbnail_url || g.output_url}
                          alt={`Take ${i + 1}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
        {/* ── End Col 1 ────────────────────────────────────────────────────── */}

        {/* ── Row 3 Col 2: Right panel — stage-aware ─────────────────────── */}
        <div className="studio-right-panel">

          {studioStage === 'brief' && (
            <StudioBriefSidebar
              brandKit={brandKit}
              completedGenerations={completedGenerations}
              onSelectRecipe={(p) => setPrompt(p.slice(0, PROMPT_LIMIT))}
            />
          )}

          {studioStage === 'results' && (
            <StudioDirectPanel
              topPickGeneration={topPickGeneration}
              cost={cost}
              availableCredits={availableCredits}
              canAfford={canAfford}
              onRegenerate={handleDirectRegenerate}
              isGenerating={isGenerating}
            />
          )}

          {studioStage === 'publish' && (
            <StudioPublishPanel
              selectedGeneration={selectedGeneration || topPickGeneration}
              postProduction={postProduction}
              publishing={publishing}
              onSaveDraft={handleSaveDraft}
              onPublish={handlePublish}
              onSchedule={() => toast('Calendar scheduling coming soon.')}
            />
          )}

          {studioStage === 'published' && (
            <StudioPublishedPanel
              selectedGeneration={selectedGeneration || topPickGeneration}
              postProduction={postProduction}
              platforms={publishedPlatforms}
              onGenerateAnother={() => { setPublishedPlatforms([]); setStudioStage('brief'); }}
            />
          )}

        </div>
        {/* ── End Col 2 ────────────────────────────────────────────────────── */}

      </div>
      {/* ══ End shell ════════════════════════════════════════════════════════ */}


      {/* ══ MOBILE PROMPT BAR (hidden on desktop via CSS) ════════════════════ */}
      <StudioPromptBar
        selectedMode={selectedMode}
        settings={settings}
        activeChip={activeChip}
        setActiveChip={setActiveChip}
        advancedOpen={advancedOpen}
        setAdvancedOpen={setAdvancedOpen}
        onModeChange={handleModeChange}
        updateSettings={updateSettings}
        prompt={prompt}
        setPrompt={setPrompt}
        promptRef={promptRef}
        onGenerate={handleGenerate}
        onEnhance={handleEnhance}
        enhancing={enhancing}
        isGenerating={isGenerating}
        canAfford={canAfford}
        cost={cost}
        sourceImageUrl={sourceImageUrl}
        setSourceImageUrl={setSourceImageUrl}
      />

      {/* ══ MOBILE ADVANCED SHEET ════════════════════════════════════════════ */}
      <StudioAdvancedSheet
        advancedOpen={advancedOpen}
        setAdvancedOpen={setAdvancedOpen}
        selectedMode={selectedMode}
        settings={settings}
        updateSettings={updateSettings}
        cost={cost}
        availableCredits={availableCredits}
      />

      {/* ══ LIGHTBOX ════════════════════════════════════════════════════════ */}
      {lightboxOpen && lightboxGeneration && (
        <StudioLightbox
          lightboxGeneration={lightboxGeneration}
          lightboxMeta={lightboxMeta}
          lightboxIndex={lightboxIndex}
          lightboxPrev={lightboxPrev}
          lightboxNext={lightboxNext}
          completedGenerationsCount={completedGenerations.length}
          onClose={() => setLightboxOpen(false)}
          onPrev={() => setLightboxIndex((i) => Math.max(0, i - 1))}
          onNext={() => setLightboxIndex((i) => Math.min(completedGenerations.length - 1, i + 1))}
          onRegenerate={handleRegenerate}
          onUseForPost={handleUseForPost}
        />
      )}

      {/* ══ LEGACY POST DRAWER (opened via lightbox "Use for post") ═════════ */}
      <PostProductionSheet
        postDrawerOpen={postDrawerOpen}
        onClose={handleClosePostDrawer}
        selectedGeneration={selectedGeneration}
        postProduction={postProduction}
        seoLocked={seoLocked}
        updatePostProduction={updatePostProduction}
        tagValue={tagValue}
        setTagValue={setTagValue}
        addHashtag={addHashtag}
        removeHashtag={removeHashtag}
        addHashtagSuggestion={addHashtagSuggestion}
        optimizeSeo={optimizeSeo}
        accounts={accounts}
        accountsLoading={accountsLoading}
        toggleAccount={toggleAccount}
        selectedAccounts={selectedAccounts}
        previewAccount={previewAccount}
        setPreviewAccountId={setPreviewAccountId}
        publishing={publishing}
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
      />
    </>
  );
}
