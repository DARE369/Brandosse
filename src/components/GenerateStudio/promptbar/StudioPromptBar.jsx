import React from 'react';
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Settings2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  MAGNIFIC_ASPECT_RATIOS,
  MAGNIFIC_CONTENT_TYPES,
  MAGNIFIC_IMAGE_RESOLUTIONS,
  MAGNIFIC_VIDEO_RESOLUTIONS,
  getMagnificModelLabel,
  getMagnificModelsForMode,
} from '../../../config/magnificModels';
import RatioIcon from '../shared/RatioIcon';
import ModeIcon from '../shared/ModeIcon';
import { PROMPT_LIMIT } from '../shared/constants';

/* ─────────────────────────────────────────────────────────────────────────────
   StudioPromptBar — fixed prompt bar: config chips, textarea + actions,
   source-image row, advanced trigger, and chip backdrop.
   ───────────────────────────────────────────────────────────────────────────── */
export default function StudioPromptBar({
  selectedMode,
  settings,
  activeChip,
  setActiveChip,
  advancedOpen,
  setAdvancedOpen,
  onModeChange,
  updateSettings,
  prompt,
  setPrompt,
  promptRef,
  onGenerate,
  onEnhance,
  enhancing,
  isGenerating,
  canAfford,
  cost,
  sourceImageUrl,
  setSourceImageUrl,
}) {
  return (
    <div className="studio-bar">
      <div className="studio-bar__inner">

        {/* Config chips row */}
        <div className="studio-bar__chips">

          {/* Mode chip */}
          <div className="studio-chip-wrapper">
            <button
              type="button"
              className={`studio-chip ${activeChip === 'mode' ? 'is-open' : ''}`}
              onClick={() => setActiveChip(activeChip === 'mode' ? null : 'mode')}
            >
              <ModeIcon mode={selectedMode} size={12} />
              {MAGNIFIC_CONTENT_TYPES.find((t) => t.id === selectedMode)?.label || 'Image'}
              <ChevronDown size={11} />
            </button>
            {activeChip === 'mode' && (
              <div className="studio-chip-popover">
                {MAGNIFIC_CONTENT_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={`studio-chip-option ${selectedMode === type.id ? 'is-selected' : ''}`}
                    onClick={() => onModeChange(type.id)}
                  >
                    <ModeIcon mode={type.id} size={14} />
                    <div className="studio-chip-option__texts">
                      <span className="studio-chip-option__label">{type.label}</span>
                      <span className="studio-chip-option__desc">{type.description}</span>
                    </div>
                    {selectedMode === type.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model chip */}
          <div className="studio-chip-wrapper">
            <button
              type="button"
              className={`studio-chip ${activeChip === 'model' ? 'is-open' : ''}`}
              onClick={() => setActiveChip(activeChip === 'model' ? null : 'model')}
            >
              {getMagnificModelLabel(settings.model)}
              <ChevronDown size={11} />
            </button>
            {activeChip === 'model' && (
              <div className="studio-chip-popover studio-chip-popover--wide">
                {getMagnificModelsForMode(selectedMode).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`studio-chip-option ${settings.model === m.id ? 'is-selected' : ''}`}
                    onClick={() => { updateSettings({ model: m.id, ...(m.id === 'kling-v2-6-pro' ? { duration: 5 } : {}) }); setActiveChip(null); }}
                  >
                    <div className="studio-chip-option__texts">
                      <span className="studio-chip-option__label">{m.label}</span>
                      <span className="studio-chip-option__desc">{m.hint}</span>
                    </div>
                    {settings.model === m.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Aspect ratio chip */}
          <div className="studio-chip-wrapper">
            <button
              type="button"
              className={`studio-chip ${activeChip === 'ratio' ? 'is-open' : ''}`}
              onClick={() => setActiveChip(activeChip === 'ratio' ? null : 'ratio')}
            >
              <RatioIcon ratio={settings.aspectRatio} size={12} />
              {settings.aspectRatio}
              <ChevronDown size={11} />
            </button>
            {activeChip === 'ratio' && (
              <div className="studio-chip-popover">
                {MAGNIFIC_ASPECT_RATIOS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`studio-chip-option ${settings.aspectRatio === r.id ? 'is-selected' : ''}`}
                    onClick={() => { updateSettings({ aspectRatio: r.id }); setActiveChip(null); }}
                  >
                    <RatioIcon ratio={r.id} size={15} />
                    <div className="studio-chip-option__texts">
                      <span className="studio-chip-option__label">{r.label}</span>
                      <span className="studio-chip-option__desc">{r.hint}</span>
                    </div>
                    {settings.aspectRatio === r.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Resolution chip */}
          <div className="studio-chip-wrapper">
            <button
              type="button"
              className={`studio-chip ${activeChip === 'resolution' ? 'is-open' : ''}`}
              onClick={() => setActiveChip(activeChip === 'resolution' ? null : 'resolution')}
            >
              {(settings.resolution || '2K').toUpperCase()}
              <ChevronDown size={11} />
            </button>
            {activeChip === 'resolution' && (
              <div className="studio-chip-popover">
                {(selectedMode === 'video' || selectedMode === 'image-to-video'
                  ? MAGNIFIC_VIDEO_RESOLUTIONS
                  : MAGNIFIC_IMAGE_RESOLUTIONS
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`studio-chip-option ${settings.resolution === r.id ? 'is-selected' : ''}`}
                    onClick={() => { updateSettings({ resolution: r.id }); setActiveChip(null); }}
                  >
                    <span className="studio-chip-option__label">{r.label}</span>
                    {settings.resolution === r.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Batch count chip (image only) */}
          {selectedMode === 'image' && (
            <div className="studio-chip-wrapper">
              <button
                type="button"
                className={`studio-chip ${activeChip === 'batch' ? 'is-open' : ''}`}
                onClick={() => setActiveChip(activeChip === 'batch' ? null : 'batch')}
              >
                ×{settings.batchSize || 1}
                <ChevronDown size={11} />
              </button>
              {activeChip === 'batch' && (
                <div className="studio-chip-popover">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`studio-chip-option ${(settings.batchSize || 1) === n ? 'is-selected' : ''}`}
                      onClick={() => { updateSettings({ batchSize: n }); setActiveChip(null); }}
                    >
                      <span className="studio-chip-option__label">{n} {n === 1 ? 'variant' : 'variants'}</span>
                      {(settings.batchSize || 1) === n && <Check size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Slide count chip (carousel only) */}
          {selectedMode === 'carousel' && (
            <div className="studio-chip-wrapper">
              <button
                type="button"
                className={`studio-chip ${activeChip === 'slides' ? 'is-open' : ''}`}
                onClick={() => setActiveChip(activeChip === 'slides' ? null : 'slides')}
              >
                {settings.slideCount === 'auto' ? '6' : settings.slideCount} slides
                <ChevronDown size={11} />
              </button>
              {activeChip === 'slides' && (
                <div className="studio-chip-popover">
                  {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => {
                    const cur = settings.slideCount === 'auto' ? 6 : Number(settings.slideCount || 6);
                    return (
                      <button
                        key={n}
                        type="button"
                        className={`studio-chip-option ${cur === n ? 'is-selected' : ''}`}
                        onClick={() => { updateSettings({ slideCount: n }); setActiveChip(null); }}
                      >
                        <span className="studio-chip-option__label">{n} slides</span>
                        {cur === n && <Check size={13} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="studio-chip-separator" />

          {/* Advanced / More chip */}
          <button
            type="button"
            className={`studio-chip studio-chip--more ${advancedOpen ? 'is-open' : ''}`}
            onClick={() => { setAdvancedOpen((v) => !v); setActiveChip(null); }}
          >
            <Settings2 size={12} />
            More
          </button>
        </div>

        {/* Divider */}
        <div className="studio-bar__divider" />

        {/* Textarea + actions */}
        <div className="studio-bar__input-row">
          <textarea
            ref={promptRef}
            className="studio-bar__textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onGenerate(); }
            }}
            placeholder="Describe what you want to create… (⌘+Enter to generate)"
            rows={1}
            maxLength={PROMPT_LIMIT}
          />
          <div className="studio-bar__actions">
            <span className="studio-bar__charcount">{prompt.length}/{PROMPT_LIMIT}</span>
            <button
              type="button"
              className="studio-bar__enhance"
              onClick={onEnhance}
              disabled={enhancing || !prompt.trim()}
              title="Enhance prompt"
            >
              {enhancing ? <Loader2 size={14} className="studio-spin" /> : <Wand2 size={14} />}
            </button>
            <button
              type="button"
              className="studio-bar__generate"
              onClick={onGenerate}
              disabled={isGenerating || !prompt.trim() || !canAfford}
            >
              {isGenerating
                ? <><Loader2 size={13} className="studio-spin" /> Generating</>
                : <><Sparkles size={13} /> Generate · {cost}cr</>}
            </button>
          </div>
        </div>

        {/* Source image row (edit / image-to-video) */}
        {(selectedMode === 'edit' || selectedMode === 'image-to-video') && (
          <div className="studio-bar__source-row">
            <ImageIcon size={13} />
            <input
              className="studio-bar__source"
              value={sourceImageUrl}
              onChange={(e) => { setSourceImageUrl(e.target.value); updateSettings({ referenceImageUrl: e.target.value }); }}
              placeholder={selectedMode === 'image-to-video' ? 'First-frame image URL…' : 'Source image URL…'}
            />
          </div>
        )}
      </div>

      {/* Chip popover backdrop */}
      {activeChip && <div className="studio-chip-backdrop" onClick={() => setActiveChip(null)} />}
    </div>
  );
}
