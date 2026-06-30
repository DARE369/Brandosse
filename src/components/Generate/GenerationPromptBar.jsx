import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import toast from 'react-hot-toast';
import {
  Paperclip,
  Sparkles,
  X,
} from 'lucide-react';
import { ASPECT_RATIOS } from './AspectRatioIcons';

const MODEL_OPTIONS = [
  { value: 'studio-standard', label: 'Standard' },
  { value: 'studio-quality', label: 'Quality' },
];

const OUTPUT_COUNT_OPTIONS = [1, 2, 3, 4];
const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024;

function supportsStructuredOutputs(mode) {
  return mode === 'create-image';
}

const GenerationPromptBar = forwardRef(function GenerationPromptBar(
  {
    onGenerate,
    onModeChange,
    onEnhancePrompt,
    onPromptChange,
    isGenerating = false,
    referenceImageUrl = null,
    value,
    mode: modeProp,
    // Canvas-controlled content type (single | carousel)
    contentType: contentTypeProp,
    slideCount: slideCountProp,
    // Canvas-level mode tabs
    tabs = [],
    activeTabId = null,
    onTabChange = null,
  },
  ref,
) {
  const isPromptControlled = typeof value === 'string';
  const isModeControlled = typeof modeProp === 'string';

  const [internalPrompt, setInternalPrompt] = useState(value ?? '');
  const [modeState, setModeState] = useState(modeProp ?? 'create-image');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [outputCount, setOutputCount] = useState(2);
  const [model, setModel] = useState('studio-standard');
  const [slideCount, setSlideCount] = useState('auto');
  const [attachedMedia, setAttachedMedia] = useState(null);
  const [showEnhanceMenu, setShowEnhanceMenu] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhanceSuggestions, setEnhanceSuggestions] = useState([]);

  const textareaRef = useRef(null);
  const barRef = useRef(null);
  const enhanceMenuRef = useRef(null);
  const mediaFileRef = useRef(null);

  const prompt = isPromptControlled ? value : internalPrompt;
  const mode = isModeControlled ? modeProp : modeState;
  const contentType = contentTypeProp ?? 'single';

  const setPrompt = useCallback(
    (nextPrompt) => {
      if (!isPromptControlled) setInternalPrompt(nextPrompt);
      onPromptChange?.(nextPrompt);
    },
    [isPromptControlled, onPromptChange],
  );

  const setMode = useCallback(
    (nextMode) => {
      if (!isModeControlled) setModeState(nextMode);
      onModeChange?.(nextMode);
    },
    [isModeControlled, onModeChange],
  );

  const clearAttachedMedia = useCallback(() => {
    setAttachedMedia((previous) => {
      if (previous?.revokeOnDispose && previous.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return null;
    });
    if (mediaFileRef.current) mediaFileRef.current.value = '';
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus(),
      setPrompt: (nextPrompt) => setPrompt(String(nextPrompt ?? '')),
      getPrompt: () => String(prompt ?? ''),
    }),
    [prompt, setPrompt],
  );

  useEffect(() => {
    if (!isModeControlled) return;
    setModeState(modeProp);
  }, [isModeControlled, modeProp]);

  useEffect(() => {
    if (!isPromptControlled) return;
    setInternalPrompt(value);
  }, [isPromptControlled, value]);

  useEffect(() => {
    if (!referenceImageUrl) return;
    setAttachedMedia((previous) => {
      if (previous?.revokeOnDispose && previous.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return {
        file: null,
        previewUrl: referenceImageUrl,
        type: 'image',
        name: 'Reference image',
        revokeOnDispose: false,
      };
    });
  }, [referenceImageUrl]);

  useEffect(
    () => () => {
      if (attachedMedia?.revokeOnDispose && attachedMedia.previewUrl) {
        URL.revokeObjectURL(attachedMedia.previewUrl);
      }
    },
    [attachedMedia],
  );

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (barRef.current && !barRef.current.contains(event.target)) {
        setShowEnhanceMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  const canChooseCount = supportsStructuredOutputs(mode) && contentType !== 'carousel';
  const isCarousel = contentType === 'carousel';

  const handleMediaSelect = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      toast.error('Only image and video files are supported.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      toast.error('File is too large. Maximum size is 50MB.');
      event.target.value = '';
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setAttachedMedia((previous) => {
      if (previous?.revokeOnDispose && previous.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      return { file, previewUrl, type: isImage ? 'image' : 'video', name: file.name, revokeOnDispose: true };
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmedPrompt = String(prompt || '').trim();
    if (!trimmedPrompt || isGenerating) return;

    const imageReference = attachedMedia?.type === 'image' ? attachedMedia.previewUrl : null;
    const imageFile = attachedMedia?.type === 'image' ? attachedMedia.file : null;

    onGenerate?.({
      prompt: trimmedPrompt,
      mode,
      aspectRatio,
      outputCount: canChooseCount ? outputCount : 1,
      model,
      outputStructure: contentType,
      slideCount: slideCountProp ?? slideCount,
      referenceImages: imageReference ? [imageReference] : [],
      referenceImageFiles: imageFile ? [imageFile] : [],
      attachedMedia,
    });
  }, [
    aspectRatio,
    attachedMedia,
    canChooseCount,
    contentType,
    isGenerating,
    mode,
    model,
    onGenerate,
    outputCount,
    prompt,
    slideCount,
    slideCountProp,
  ]);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleEnhance = useCallback(async () => {
    const trimmedPrompt = String(prompt || '').trim();
    if (!trimmedPrompt || isEnhancing || isGenerating) return;
    setIsEnhancing(true);
    try {
      const response = await onEnhancePrompt?.(trimmedPrompt);
      const candidateList = Array.isArray(response?.suggestions)
        ? response.suggestions
        : [response?.enhancedPrompt ?? response];
      const normalized = candidateList
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .filter((entry, index, self) => self.indexOf(entry) === index);
      if (!normalized.length) {
        toast.error('No enhancement suggestions were returned.');
        return;
      }
      setEnhanceSuggestions(normalized);
      setShowEnhanceMenu(true);
    } catch (error) {
      toast.error(error?.message || 'Failed to enhance prompt');
    } finally {
      setIsEnhancing(false);
    }
  }, [isEnhancing, isGenerating, onEnhancePrompt, prompt]);

  const hasPrompt = String(prompt || '').trim().length > 0;

  return (
    <div ref={barRef} className="gpb-wrapper">

      {/* ── Settings row ──────────────────────────────────────────────── */}
      <div className="gpb-quick-settings" role="group" aria-label="Generation settings">

        {/* CREATE section — mode tabs from canvas */}
        {tabs.length > 0 && (
          <>
            <div className="gpb-qs-section gpb-qs-section--create" role="group" aria-label="Content type">
              <span className="gpb-qs-label" aria-hidden="true">Create</span>
              <div className="gpb-create-tabs">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`gpb-create-tab${activeTabId === tab.id ? ' active' : ''}`}
                    onClick={() => onTabChange?.(tab)}
                    aria-pressed={activeTabId === tab.id}
                    aria-label={tab.label}
                    disabled={isGenerating}
                  >
                    <span className="gpb-create-tab-icon" aria-hidden="true">{tab.icon}</span>
                    <span className="gpb-create-tab-label">{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="gpb-qs-divider" aria-hidden="true" />
          </>
        )}

        {/* Aspect ratio */}
        <div className="gpb-qs-section" role="group" aria-label="Aspect ratio">
          <span className="gpb-qs-label" aria-hidden="true">Ratio</span>
          <div className="gpb-qs-pills">
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio.value}
                type="button"
                className={`gpb-qs-pill${aspectRatio === ratio.value ? ' active' : ''}`}
                onClick={() => setAspectRatio(ratio.value)}
                aria-pressed={aspectRatio === ratio.value}
                aria-label={ratio.ariaLabel}
                disabled={isGenerating}
              >
                <span className="gpb-qs-pill-icon" aria-hidden="true">{ratio.icon}</span>
                <span>{ratio.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="gpb-qs-divider" aria-hidden="true" />

        {/* Output count — single image mode only */}
        {canChooseCount && (
          <>
            <div className="gpb-qs-section" role="group" aria-label="Output count">
              <span className="gpb-qs-label" aria-hidden="true">Count</span>
              <div className="gpb-qs-pills">
                {OUTPUT_COUNT_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`gpb-qs-pill gpb-qs-pill--compact${outputCount === count ? ' active' : ''}`}
                    onClick={() => setOutputCount(count)}
                    aria-pressed={outputCount === count}
                    aria-label={`${count} output${count > 1 ? 's' : ''}`}
                    disabled={isGenerating}
                  >
                    ×{count}
                  </button>
                ))}
              </div>
            </div>
            <div className="gpb-qs-divider" aria-hidden="true" />
          </>
        )}

        {/* Carousel slide count */}
        {isCarousel && (
          <>
            <div className="gpb-qs-section" role="group" aria-label="Slide count">
              <span className="gpb-qs-label" aria-hidden="true">Slides</span>
              <div className="gpb-qs-pills">
                {['auto', 3, 4, 5, 6].map((val) => (
                  <button
                    key={val}
                    type="button"
                    className={`gpb-qs-pill gpb-qs-pill--compact${slideCount === val ? ' active' : ''}`}
                    onClick={() => setSlideCount(val)}
                    aria-pressed={slideCount === val}
                    disabled={isGenerating}
                  >
                    {val === 'auto' ? 'Auto' : val}
                  </button>
                ))}
              </div>
            </div>
            <div className="gpb-qs-divider" aria-hidden="true" />
          </>
        )}

        {/* Model */}
        <div className="gpb-qs-section" role="group" aria-label="AI model">
          <span className="gpb-qs-label" aria-hidden="true">Model</span>
          <div className="gpb-qs-pills">
            {MODEL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`gpb-qs-pill${model === option.value ? ' active' : ''}`}
                onClick={() => setModel(option.value)}
                aria-pressed={model === option.value}
                disabled={isGenerating}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* ── Input dock: textarea + generate button ────────────────────── */}
      <div className="gpb-input-dock">

        <div className={`gpb-bar${isGenerating ? ' gpb-bar--generating' : ''}`}>

          {attachedMedia && (
            <div className="gpb-attachment-strip">
              {attachedMedia.type === 'image' ? (
                <img src={attachedMedia.previewUrl} alt="Attached" className="gpb-attachment-thumb" />
              ) : (
                <div className="gpb-attachment-chip">
                  <span className="gpb-attachment-type">VID</span>
                  <span className="gpb-attachment-name">{attachedMedia.name}</span>
                </div>
              )}
              <button
                className="gpb-attachment-clear"
                onClick={clearAttachedMedia}
                aria-label="Remove attachment"
                type="button"
              >
                <X size={12} />
              </button>
            </div>
          )}

          <div className="gpb-input-row">
            <textarea
              ref={textareaRef}
              className="gpb-textarea"
              placeholder="Describe what you want to create…"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isGenerating}
              aria-label="Generation prompt"
            />

            <div className="gpb-inline-actions">
              <button
                className="gpb-attach-btn"
                onClick={() => mediaFileRef.current?.click()}
                aria-label="Attach image or video"
                title="Attach image or video"
                type="button"
                disabled={isGenerating}
              >
                <Paperclip size={15} />
              </button>

              <div className="gpb-enhance-wrapper" ref={enhanceMenuRef}>
                <button
                  className={`gpb-enhance-icon-btn${isEnhancing ? ' loading' : ''}${!hasPrompt ? ' hidden' : ''}`}
                  onClick={handleEnhance}
                  aria-label="Enhance prompt with AI"
                  title="Enhance prompt"
                  type="button"
                  disabled={isGenerating || isEnhancing || !hasPrompt}
                >
                  <Sparkles size={15} aria-hidden="true" />
                </button>

                {showEnhanceMenu && (
                  <div className="prompt-enhance-menu" role="dialog" aria-label="Prompt enhancement suggestions">
                    <div className="prompt-enhance-menu-header">
                      <span>Enhanced suggestions</span>
                      <button
                        type="button"
                        className="prompt-enhance-dismiss"
                        onClick={() => setShowEnhanceMenu(false)}
                      >
                        Dismiss
                      </button>
                    </div>
                    <div className="prompt-enhance-menu-list">
                      {enhanceSuggestions.map((suggestion, index) => (
                        <button
                          key={`${index}-${suggestion}`}
                          type="button"
                          className="prompt-enhance-option"
                          onClick={() => {
                            setPrompt(suggestion);
                            setShowEnhanceMenu(false);
                            textareaRef.current?.focus();
                          }}
                        >
                          <span>{suggestion}</span>
                          <strong>Accept</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Generate button (prominent, outside the textarea) ── */}
        <button
          className={`gpb-send-btn${!hasPrompt || isGenerating ? ' disabled' : ''}`}
          onClick={handleSubmit}
          disabled={!hasPrompt || isGenerating}
          title="Generate (Ctrl+Enter)"
          aria-label="Generate"
          type="button"
        >
          {isGenerating ? (
            <svg className="gpb-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          ) : (
            <>
              <Sparkles size={15} aria-hidden="true" />
              <span>Generate</span>
            </>
          )}
        </button>

      </div>

      <input
        ref={mediaFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime"
        hidden
        onChange={handleMediaSelect}
      />
    </div>
  );
});

export default GenerationPromptBar;
