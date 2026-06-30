import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Pencil,
  Sparkles,
  Video,
} from 'lucide-react';
import toast from 'react-hot-toast';
import useSessionStore from '../../stores/SessionStore';
import useBrandKitStore from '../../stores/BrandKitStore';
import { useAuth } from '../../Context/AuthContext';
import { BRAND_KIT_STATUS } from '../../constants/statusEnums';
import { GENERATION_STATUS } from '../../constants/statuses';
import BatchGenerationGrid from './BatchGenerationGrid';
import IntentClarificationPanel from './IntentClarificationPanel';
import GenerationPromptBar from './GenerationPromptBar';
import EditImageModal from './EditImageModal';
import { checkIntentAmbiguity } from '../../services/intentExtractor';
import { getSuggestedPrompts } from '../../services/suggestedPrompts';
import { computeBrandKitHash } from '../../utils/brandKitHash';

const VIDEO_MODES = new Set(['text-to-video', 'frames-to-video']);

const CANVAS_TABS = [
  { id: 'image',    label: 'Image',    icon: <ImageIcon size={18} aria-hidden="true" />, mode: 'create-image',    contentType: 'single' },
  { id: 'carousel', label: 'Carousel', icon: <Layers    size={18} aria-hidden="true" />, mode: 'create-image',    contentType: 'carousel' },
  { id: 'video',    label: 'Video',    icon: <Video     size={18} aria-hidden="true" />, mode: 'text-to-video',   contentType: 'single' },
  { id: 'frames',   label: 'Frames',   icon: <Film      size={18} aria-hidden="true" />, mode: 'frames-to-video', contentType: 'single' },
  { id: 'edit',     label: 'Edit',     icon: <Pencil    size={18} aria-hidden="true" />, mode: 'edit-image',      contentType: 'single' },
];

const FLOW_STEPS = [
  { key: 'prompt',  label: 'Prompt' },
  { key: 'results', label: 'Results' },
  { key: 'select',  label: 'Select' },
  { key: 'publish', label: 'Publish' },
];

function normalizeStatus(status) {
  return String(status || '').toLowerCase();
}

function getModeFromMediaType(mediaType) {
  if (mediaType === 'video') return 'text-to-video';
  if (mediaType === 'edit') return 'edit-image';
  return 'create-image';
}

function getMediaTypeFromMode(mode) {
  if (mode === 'edit-image') return 'edit';
  if (VIDEO_MODES.has(mode)) return 'video';
  return 'image';
}

function getTabIdFromMode(mode, contentType) {
  if (mode === 'edit-image') return 'edit';
  if (mode === 'frames-to-video') return 'frames';
  if (mode === 'text-to-video') return 'video';
  if (contentType === 'carousel') return 'carousel';
  return 'image';
}

export default function GenerationCanvas({
  settingsPath = '/app/settings/brand-kit',
  onOpenSettings = null,
  postPanelOpen = false,
}) {
  const {
    activeSession,
    activeGenerations,
    selectedGeneration,
    isGenerating,
    generationProgress,
    progressLabel,
    settings,
    error,
    updateSettings,
    startGeneration,
    startCarouselGeneration,
    startEditGeneration,
    startVideoGeneration,
    enhancePrompt,
    clearError,
    setClarifications,
    clearClarifications,
    selectGeneration,
  } = useSessionStore();
  const { user } = useAuth();

  const brandKit = useBrandKitStore((state) => state.brandKit);
  const brandKitStatus = useBrandKitStore((state) => state.status);

  const [showClarification, setShowClarification] = useState(false);
  const [clarificationQuestions, setClarificationQuestions] = useState([]);
  const [pendingInput, setPendingInput] = useState('');
  const [currentMode, setCurrentMode] = useState(getModeFromMediaType(settings.mediaType));
  const [activeContentType, setActiveContentType] = useState('single');
  const [promptValue, setPromptValue] = useState('');
  const [referenceImageUrl, setReferenceImageUrl] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  const promptBarRef = useRef(null);
  const scrollAnchorRef = useRef(null);
  const brandKitHash = useMemo(() => computeBrandKitHash(brandKit), [brandKit]);

  const activeTabId = getTabIdFromMode(currentMode, activeContentType);

  useEffect(() => {
    if (!error) return;
    const lower = error.toLowerCase();
    if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429')) {
      toast.error(
        <span>
          Media generation quota reached.{' '}
          <a href="/app/settings" target="_blank" rel="noopener noreferrer">Review settings</a>
        </span>,
        { id: 'store-error', duration: 8000 },
      );
    } else {
      toast.error(error, { id: 'store-error' });
    }
    clearError();
  }, [clearError, error]);

  useEffect(() => {
    if (activeGenerations.length === 0) return;
    setTimeout(() => {
      scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
  }, [activeGenerations.length, isGenerating]);

  useEffect(() => {
    if (!settings.mediaType) return;
    const modeFromSettings = getModeFromMediaType(settings.mediaType);
    if (settings.mediaType === 'video' && !VIDEO_MODES.has(currentMode)) {
      setCurrentMode(modeFromSettings);
      return;
    }
    if (settings.mediaType === 'edit' && currentMode !== 'edit-image') {
      setCurrentMode(modeFromSettings);
      return;
    }
    if (settings.mediaType === 'image' && currentMode === 'edit-image') {
      setCurrentMode(modeFromSettings);
    }
  }, [currentMode, settings.mediaType]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const loadSuggestions = async () => {
      const prompts = await getSuggestedPrompts(user.id, brandKit, { mode: currentMode });
      if (!cancelled) setSuggestions(prompts);
    };
    loadSuggestions();
    return () => { cancelled = true; };
  }, [user?.id, brandKitHash, currentMode, brandKit]);

  useEffect(() => {
    const handleSeedPrompt = (event) => {
      const seededPrompt = String(event?.detail?.prompt || '').trim();
      if (!seededPrompt) return;
      setPromptValue(seededPrompt);
      setTimeout(() => promptBarRef.current?.focus?.(), 0);
    };
    window.addEventListener('socialai:seed-prompt', handleSeedPrompt);
    return () => window.removeEventListener('socialai:seed-prompt', handleSeedPrompt);
  }, []);

  useEffect(() => {
    const handleActivateGenerationEdit = (event) => {
      const sourceImageUrl = String(event?.detail?.sourceImageUrl || '').trim();
      const seededPrompt = String(event?.detail?.prompt || '').trim();

      setCurrentMode('edit-image');
      setActiveContentType('single');
      updateSettings({
        mediaType: 'edit',
        batchSize: 1,
        contentType: 'single',
        slideCount: 'auto',
      });

      if (seededPrompt) {
        setPromptValue(seededPrompt);
      }

      if (sourceImageUrl) {
        setReferenceImageUrl(null);
        window.setTimeout(() => {
          setReferenceImageUrl(sourceImageUrl);
          promptBarRef.current?.focus?.();
        }, 0);
      } else {
        window.setTimeout(() => promptBarRef.current?.focus?.(), 0);
      }
    };

    window.addEventListener('socialai:activate-generation-edit', handleActivateGenerationEdit);
    return () => window.removeEventListener('socialai:activate-generation-edit', handleActivateGenerationEdit);
  }, [updateSettings]);


  const batches = useMemo(
    () =>
      activeGenerations.reduce((accumulator, generation) => {
        const key = generation.batch_id || generation.id;
        if (!accumulator[key]) accumulator[key] = [];
        accumulator[key].push(generation);
        return accumulator;
      }, {}),
    [activeGenerations],
  );

  const batchEntries = useMemo(
    () =>
      Object.entries(batches).map(([batchId, generations]) => ({
        batchId,
        generations: [...generations].sort((a, b) => (a.batch_index || 0) - (b.batch_index || 0)),
      })),
    [batches],
  );

  const hasGenerations = batchEntries.length > 0;

  const completedGenerationCount = useMemo(
    () =>
      activeGenerations.filter(
        (item) => normalizeStatus(item?.status) === GENERATION_STATUS.COMPLETED,
      ).length,
    [activeGenerations],
  );

  const pendingCount = settings.mediaType === 'video'
    ? 1
    : settings.contentType === 'carousel'
      ? (settings.slideCount === 'auto' ? 4 : Math.max(2, Number(settings.slideCount) || 2))
      : Math.max(1, Number(settings.batchSize) || 1);

  const recentCompletedImages = useMemo(
    () =>
      activeGenerations
        .filter(
          (item) =>
            item?.media_type === 'image'
            && normalizeStatus(item?.status) === GENERATION_STATUS.COMPLETED
            && item?.storage_path,
        )
        .slice()
        .reverse(),
    [activeGenerations],
  );

  const handleTabChange = useCallback((tab) => {
    setCurrentMode(tab.mode);
    setActiveContentType(tab.contentType);
    const mediaType = getMediaTypeFromMode(tab.mode);
    if (mediaType === 'video' || mediaType === 'edit') {
      updateSettings({ mediaType, batchSize: 1, contentType: 'single', slideCount: 'auto' });
    } else if (tab.contentType === 'carousel') {
      updateSettings({ mediaType: 'image', contentType: 'carousel' });
    } else {
      updateSettings({ mediaType: 'image', contentType: 'single' });
    }
  }, [updateSettings]);

  const handleGenerateRequest = useCallback(
    async (userInput) => {
      const brandKitObj = brandKit
        ? { configured: brandKitStatus === BRAND_KIT_STATUS.CONFIGURED, raw: brandKit }
        : { configured: false };
      const { ambiguous, questions } = checkIntentAmbiguity(userInput, brandKitObj);
      if (ambiguous) {
        setPendingInput(userInput);
        setClarificationQuestions(questions);
        setShowClarification(true);
        return;
      }
      clearClarifications();
      await startGeneration(userInput);
    },
    [brandKit, brandKitStatus, clearClarifications, startGeneration],
  );

  const handleClarificationSubmit = async (answers) => {
    setClarifications(answers);
    setShowClarification(false);
    await startGeneration(pendingInput);
    setPendingInput('');
  };

  const handleClarificationSkip = async () => {
    clearClarifications();
    setShowClarification(false);
    await startGeneration(pendingInput);
    setPendingInput('');
  };

  const applyModeSettings = useCallback(
    ({ mode, aspectRatio, outputCount, model, outputStructure, slideCount }) => {
      const mediaType = getMediaTypeFromMode(mode);
      const nextStructure = outputStructure || activeContentType || 'single';
      const updates = {
        mediaType,
        aspectRatio: aspectRatio || settings.aspectRatio,
        model: model || settings.model,
      };
      if (mediaType === 'video' || mediaType === 'edit') {
        updates.batchSize = 1;
        updates.contentType = 'single';
        updates.slideCount = 'auto';
      } else {
        updates.batchSize = Math.max(1, Math.min(Number(outputCount) || 1, 4));
        updates.contentType = nextStructure;
        if (nextStructure === 'carousel') {
          updates.batchSize = 1;
          updates.slideCount = slideCount === 'auto'
            ? 'auto'
            : Math.max(2, Number(slideCount) || 2);
        }
      }
      updateSettings(updates);
      return updates;
    },
    [activeContentType, settings.aspectRatio, settings.model, updateSettings],
  );

  const handleGenerate = useCallback(
    async ({
      prompt,
      mode,
      aspectRatio,
      outputCount,
      model,
      outputStructure,
      slideCount,
      referenceImages,
    }) => {
      const normalizedPrompt = String(prompt || '').trim();
      if (!normalizedPrompt || isGenerating) return;

      const resolvedMode = mode || currentMode;
      // Canvas-level activeContentType takes precedence
      const resolvedOutputStructure = activeContentType !== 'single'
        ? activeContentType
        : (outputStructure || 'single');

      const resolvedSettings = applyModeSettings({
        mode: resolvedMode,
        aspectRatio,
        outputCount,
        model,
        outputStructure: resolvedOutputStructure,
        slideCount,
      });
      const mediaType = resolvedSettings.mediaType;
      setCurrentMode(resolvedMode);

      try {
        if (mediaType === 'edit') {
          const sourceImageUrl = Array.isArray(referenceImages) ? referenceImages[0] : null;
          if (!sourceImageUrl) {
            toast.error('Attach a source image or use the card Edit button.');
            return;
          }
          if (String(sourceImageUrl).startsWith('blob:')) {
            toast.error('Use an existing generated image when editing from the prompt bar.');
            return;
          }
          await startEditGeneration(sourceImageUrl, normalizedPrompt);
          setPromptValue('');
          return;
        }
        if (mediaType === 'video') {
          await startVideoGeneration(normalizedPrompt);
          setPromptValue('');
          return;
        }
        if (resolvedSettings.contentType === 'carousel') {
          await startCarouselGeneration(normalizedPrompt, resolvedSettings.slideCount);
          setPromptValue('');
          return;
        }
        await handleGenerateRequest(normalizedPrompt);
        setPromptValue('');
      } catch (_error) {
        // Store + toast layer handles visible errors.
      }
    },
    [
      activeContentType,
      applyModeSettings,
      currentMode,
      handleGenerateRequest,
      isGenerating,
      startCarouselGeneration,
      startEditGeneration,
      startVideoGeneration,
    ],
  );

  const handleModeChange = useCallback((mode) => {
    setCurrentMode(mode);
    const mediaType = getMediaTypeFromMode(mode);
    if (mediaType === 'video' || mediaType === 'edit') {
      setActiveContentType('single');
      updateSettings({ mediaType, batchSize: 1, contentType: 'single', slideCount: 'auto' });
      return;
    }
    updateSettings({ mediaType: 'image' });
  }, [updateSettings]);

  const handleRetryGeneration = async (generation) => {
    if (!generation?.prompt || isGenerating) return;
    const toastId = toast.loading('Retrying generation...');
    try {
      const sourceImageUrl = generation.metadata?.source_image_url;
      const isEditRetry = Boolean(generation.metadata?.edit_mode && sourceImageUrl);
      if (generation.media_type === 'video') {
        setCurrentMode('text-to-video');
        updateSettings({ mediaType: 'video', batchSize: 1, contentType: 'single', slideCount: 'auto' });
        await startVideoGeneration(generation.prompt);
      } else if (isEditRetry) {
        setCurrentMode('edit-image');
        updateSettings({ mediaType: 'edit', batchSize: 1, contentType: 'single', slideCount: 'auto' });
        await startEditGeneration(sourceImageUrl, generation.prompt);
      } else {
        setCurrentMode('create-image');
        updateSettings({ mediaType: 'image' });
        await startGeneration(generation.prompt);
      }
      toast.success('Retry started', { id: toastId });
    } catch (retryError) {
      toast.error(retryError.message || 'Retry failed', { id: toastId });
    }
  };

  const handleApplyModalEdit = useCallback(
    async ({ imageUrl, instruction }) => {
      const returnedUrl = await startEditGeneration(imageUrl, instruction);
      if (returnedUrl) return returnedUrl;
      const latestEdit = [...useSessionStore.getState().activeGenerations]
        .reverse()
        .find(
          (item) =>
            item?.media_type === 'image'
            && item?.storage_path
            && normalizeStatus(item?.status) === GENERATION_STATUS.COMPLETED
            && item?.metadata?.edit_mode,
        );
      if (latestEdit?.storage_path) return latestEdit.storage_path;
      throw new Error('Edit completed but no result URL was found.');
    },
    [startEditGeneration],
  );

  const handleOpenBrandKit = useCallback(() => {
    if (typeof onOpenSettings === 'function') {
      onOpenSettings(settingsPath);
      return;
    }
    if (typeof window !== 'undefined') window.location.assign(settingsPath);
  }, [onOpenSettings, settingsPath]);

  // Flow step active states
  const flowActive = {
    prompt: true,
    results: hasGenerations,
    select: Boolean(selectedGeneration),
    publish: postPanelOpen,
  };

  return (
    <main className="generation-canvas">

      {/* ── Slim session header ──────────────────────────────────────── */}
      <header className="gc-slim-header">
        <div className="gc-slim-left">
          <Sparkles size={11} className="gc-slim-icon" aria-hidden="true" />
          <span className="gc-slim-studio">AI Studio</span>
          {activeSession?.title && (
            <>
              <span className="gc-slim-sep" aria-hidden="true">›</span>
              <span className="gc-slim-session">{activeSession.title}</span>
            </>
          )}
        </div>

        <nav className="gc-slim-flow" aria-label="Creation progress">
          {FLOW_STEPS.map((step, index) => (
            <React.Fragment key={step.key}>
              <span
                className={`gc-flow-step${flowActive[step.key] ? ' active' : ''}`}
                aria-current={flowActive[step.key] ? 'step' : undefined}
              >
                {step.label}
              </span>
              {index < FLOW_STEPS.length - 1 && (
                <span className="gc-flow-arrow" aria-hidden="true">→</span>
              )}
            </React.Fragment>
          ))}
        </nav>

        <div className="gc-slim-right">
          {hasGenerations && (
            <span className="gc-slim-count">{completedGenerationCount} generated</span>
          )}
          {brandKitStatus === BRAND_KIT_STATUS.CONFIGURED ? (
            <button
              className="gc-brand-pill active"
              onClick={handleOpenBrandKit}
              type="button"
              aria-label="Brand Kit active — click to edit"
            >
              <span className="gc-brand-dot" aria-hidden="true" />
              {brandKit?.brand_name ? `${brandKit.brand_name} Brand Kit` : 'Brand Kit Active'}
            </button>
          ) : (
            <button
              className="gc-brand-pill missing"
              onClick={handleOpenBrandKit}
              type="button"
              aria-label="Set up Brand Kit for smarter generation"
            >
              Set up Brand Kit
            </button>
          )}
        </div>
      </header>

      {showClarification && (
        <IntentClarificationPanel
          questions={clarificationQuestions}
          onSubmit={handleClarificationSubmit}
          onSkip={handleClarificationSkip}
        />
      )}

      {/* ── Canvas scroll area ───────────────────────────────────────── */}
      <div className="canvas-messages">
        {!hasGenerations && !isGenerating && (
          <div className="gc-suggestions-wrapper">
            <div className="gc-hero">
              <div className="gc-hero-icon" aria-hidden="true">
                <Sparkles size={28} />
              </div>
              <h2 className="gc-hero-title">Start creating</h2>
              <p className="gc-hero-subtitle">
                Describe your vision below, or pick a quick-start prompt.
              </p>
            </div>

            {suggestions.length > 0 && (
              <div className="suggestion-chips" role="list" aria-label="Suggested prompts">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={`${index}-${suggestion}`}
                    className="suggestion-chip"
                    onClick={() => {
                      setPromptValue(suggestion);
                      promptBarRef.current?.focus();
                    }}
                    role="listitem"
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {hasGenerations && (
          <div className="generation-history" aria-live="polite" aria-label="Generation history">
            {batchEntries.map(({ batchId, generations }) => (
              <div key={batchId} className="generation-message">
                <div className="prompt-bubble">
                  <div className="prompt-bubble-body">
                    <p>{generations[0].prompt}</p>
                  </div>
                  <div className="prompt-bubble-avatar" aria-hidden="true">You</div>
                </div>

                <BatchGenerationGrid
                  generations={generations}
                  onRetry={handleRetryGeneration}
                  onEdit={(generation) => {
                    if (!generation?.storage_path) return;
                    setEditTarget({ url: generation.storage_path, id: generation.id });
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {isGenerating && settings.mediaType !== 'video' && (
          <div className="generation-message" aria-label="Generating...">
            <div className="prompt-bubble generating">
              <div className="prompt-bubble-body">
                <div className="bubble-generating-indicator">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                  Generating...
                </div>
              </div>
              <div className="prompt-bubble-avatar" aria-hidden="true">You</div>
            </div>

            <div
              className={`generation-results-grid count-${pendingCount}`}
              aria-label={`Generating ${pendingCount} image${pendingCount > 1 ? 's' : ''}`}
            >
              {Array.from({ length: pendingCount }).map((_, index) => (
                <div key={index} className="result-card processing loading-shimmer" aria-hidden="true">
                  <div className="result-media-container">
                    <div className="processing-overlay">
                      <div className="processing-spinner" />
                      {pendingCount > 1 && (
                        <span className="processing-text">{index + 1} of {pendingCount}</span>
                      )}
                      <div className="processing-progress">
                        <div
                          className="processing-progress-fill"
                          style={{ width: `${generationProgress}%` }}
                        />
                      </div>
                      <span className="progress-percentage">{generationProgress}%</span>
                      <span className="progress-label">{progressLabel || 'Generating...'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}


        <div ref={scrollAnchorRef} className="scroll-anchor" aria-hidden="true" />
      </div>

      {/* ── Input dock: unified prompt bar with built-in mode tabs ──── */}
      <div className="canvas-input-dock">
        <div className="gc-prompt-bar-sticky">
          <GenerationPromptBar
            ref={promptBarRef}
            onGenerate={handleGenerate}
            onModeChange={handleModeChange}
            onEnhancePrompt={enhancePrompt}
            value={promptValue}
            onPromptChange={setPromptValue}
            referenceImageUrl={referenceImageUrl}
            mode={currentMode}
            contentType={activeContentType}
            isGenerating={isGenerating}
            tabs={CANVAS_TABS}
            activeTabId={activeTabId}
            onTabChange={handleTabChange}
          />
        </div>
      </div>

      {editTarget && (
        <EditImageModal
          isOpen={Boolean(editTarget)}
          onClose={() => setEditTarget(null)}
          initialImage={editTarget}
          libraryImages={recentCompletedImages.map((item) => ({
            url: item.storage_path,
            id: item.id,
          }))}
          onApplyEdit={handleApplyModalEdit}
        />
      )}
    </main>
  );
}
