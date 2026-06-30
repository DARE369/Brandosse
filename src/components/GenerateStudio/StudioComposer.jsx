import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Sliders } from 'lucide-react';
import {
  getMagnificModelLabel,
  getMagnificModelsForMode,
  FAL_IMAGE_MODELS,
} from '../../config/magnificModels';
import { PROMPT_LIMIT } from './shared/constants';

/* ── Coach scorer ────────────────────────────────────────────────────────────── */
const QUALITY_KW = [
  'lighting','light','shadow','mood','style','composition','color','colours','texture',
  'detail','background','foreground','shot','angle','perspective','bokeh','gradient',
  'vibrant','minimal','cinematic','elegant','dramatic','soft','warm','cool','crisp',
  'contrast','depth','natural','professional','editorial',
];

function scorePrompt(text) {
  if (!text.trim()) return { score: 0, label: 'Weak', color: '#f43f5e', tip: 'Add a description to get started' };
  const words = text.toLowerCase().split(/\s+/);
  const hits   = QUALITY_KW.filter((kw) => text.toLowerCase().includes(kw)).length;
  const raw    = Math.min(100, Math.round((hits / Math.max(words.length, 1)) * 260 + (words.length > 6 ? 20 : 0)));
  const score  = Math.min(100, raw);
  if (score < 25) return { score, label: 'Weak',   color: '#f43f5e', tip: 'Describe the subject, mood, or setting' };
  if (score < 50) return { score, label: 'Fair',   color: '#f59e0b', tip: 'Add lighting or composition details' };
  if (score < 75) return { score, label: 'Good',   color: '#10b981', tip: 'Looking great — enhance to polish it' };
  return           { score, label: 'Strong', color: '#7c5cfc', tip: 'Excellent prompt detail' };
}

/* ── Control deck definitions per mode ──────────────────────────────────────── */
const RATIO_OPTS  = ['1:1', '4:5', '9:16', '16:9'];
const QUALITY_OPTS = ['1k', '2k', '4k'];
const BATCH_OPTS  = ['1', '2', '3', '4'];
const SLIDE_OPTS  = ['4', '6', '8', '10'];
const DUR_OPTS    = ['5s', '8s', '15s', '30s'];
const FPS_OPTS    = ['24', '30', '60'];

function getDeckTiles(mode, settings, updateSettings, negativePrompt, setNegativePrompt) {
  const falModelLabel   = FAL_IMAGE_MODELS.find((m) => m.id === (settings.imageModel || 'ideogram'))?.label || 'Ideogram V3';
  const videoModelLabel = getMagnificModelLabel(settings.model) || settings.model || 'Auto';

  function ratioTile() {
    return {
      id: 'ratio', label: 'Format', val: settings.aspectRatio || '1:1',
      opts: RATIO_OPTS,
      onSelect: (v) => updateSettings({ aspectRatio: v }),
    };
  }
  function qualityTile() {
    return {
      id: 'quality', label: 'Quality', val: settings.resolution || '2k',
      opts: QUALITY_OPTS,
      onSelect: (v) => updateSettings({ resolution: v }),
    };
  }
  /* Image-generation model (fal.ai: ideogram / recraft / flux) */
  function imageModelTile() {
    return {
      id: 'image-model', label: 'AI Model', val: falModelLabel,
      opts: FAL_IMAGE_MODELS.map((m) => m.label),
      onSelect: (v) => {
        const found = FAL_IMAGE_MODELS.find((m) => m.label === v);
        if (found) updateSettings({ imageModel: found.id });
      },
    };
  }
  /* Video model selector (Kling, LTX, etc.) */
  function videoModelTile() {
    return {
      id: 'model', label: 'Model', val: videoModelLabel,
      opts: getMagnificModelsForMode(mode).slice(0, 5).map((m) => m.label),
      onSelect: (v) => {
        const found = getMagnificModelsForMode(mode).find((m) => m.label === v);
        if (found) updateSettings({ model: found.id });
      },
    };
  }
  function avoidTile() {
    return {
      id: 'avoid', label: 'Avoid', val: negativePrompt || 'None',
      avoid: true,
      negativePrompt,
      setNegativePrompt,
      onSelect: () => {},
    };
  }

  if (mode === 'image') return [
    ratioTile(),
    qualityTile(),
    { id: 'batch', label: 'Variants', val: `${settings.batchSize || 1} takes`, opts: BATCH_OPTS, onSelect: (v) => updateSettings({ batchSize: Number(v) }) },
    imageModelTile(),
    avoidTile(),
  ];

  if (mode === 'carousel') return [
    ratioTile(),
    { id: 'slides', label: 'Slides', val: `${settings.slideCount || 6} slides`, opts: SLIDE_OPTS, onSelect: (v) => updateSettings({ slideCount: Number(v) }) },
    qualityTile(),
    imageModelTile(),
    avoidTile(),
  ];

  if (mode === 'video' || mode === 'image-to-video') return [
    ratioTile(),
    { id: 'duration', label: 'Duration', val: `${settings.duration || 5}s`, opts: DUR_OPTS, onSelect: (v) => updateSettings({ duration: parseInt(v, 10) }) },
    { id: 'fps',      label: 'FPS',      val: `${settings.fps || 24}`, opts: FPS_OPTS, onSelect: (v) => updateSettings({ fps: Number(v) }) },
    { id: 'quality-vid', label: 'Quality', val: settings.resolution || '1080p', opts: ['720p','1080p','4k'], onSelect: (v) => updateSettings({ resolution: v }) },
    videoModelTile(),
  ];

  return [ratioTile(), qualityTile(), imageModelTile(), avoidTile()];
}

/* ── Tile with popover ───────────────────────────────────────────────────────── */
function DeckTile({ tile, open, onOpen, onClose }) {
  const ref = useRef(null);
  const [avoidDraft, setAvoidDraft] = useState(tile.negativePrompt || '');

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onClose]);

  return (
    <div className="scd-tile-wrap" ref={ref}>
      <button
        type="button"
        className={`scd-tile${open ? ' scd-tile--open' : ''}`}
        onClick={() => open ? onClose() : onOpen()}
        title={tile.label}
      >
        <span className="scd-tile-label">{tile.label}</span>
        <span className="scd-tile-val">{tile.val}</span>
      </button>

      {open && (
        <div className="scd-pop">
          {tile.avoid ? (
            <div className="scd-pop-avoid">
              <input
                className="scd-pop-avoid-input"
                placeholder="e.g. clutter, text, people…"
                value={avoidDraft}
                onChange={(e) => setAvoidDraft(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { tile.setNegativePrompt(avoidDraft); onClose(); }
                }}
              />
              <button
                type="button"
                className="scd-pop-avoid-save"
                onClick={() => { tile.setNegativePrompt(avoidDraft); onClose(); }}
              >
                Save
              </button>
            </div>
          ) : (
            tile.opts?.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`scd-pop-opt${tile.val === opt || tile.val === `${opt} takes` || tile.val === `${opt} slides` || tile.val?.startsWith(opt) ? ' scd-pop-opt--on' : ''}`}
                onClick={() => { tile.onSelect(opt); onClose(); }}
              >
                {opt}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Guided fields ───────────────────────────────────────────────────────────── */
function GuidedFields({ subject, setSubject, setting, setSetting, style, setStyle, mood, setMood }) {
  return (
    <div className="scp-guided">
      <div className="scp-field">
        <label className="scp-flabel">Subject</label>
        <input className="scp-finput" placeholder="e.g. coffee cup on marble" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="scp-field">
        <label className="scp-flabel">Setting</label>
        <input className="scp-finput" placeholder="e.g. sunlit café, outdoors" value={setting} onChange={(e) => setSetting(e.target.value)} />
      </div>
      <div className="scp-field">
        <label className="scp-flabel">Style</label>
        <input className="scp-finput" placeholder="e.g. minimalist, editorial" value={style} onChange={(e) => setStyle(e.target.value)} />
      </div>
      <div className="scp-field">
        <label className="scp-flabel">Mood</label>
        <input className="scp-finput" placeholder="e.g. warm, calm, vibrant" value={mood} onChange={(e) => setMood(e.target.value)} />
      </div>
    </div>
  );
}

/* ── StudioComposer ──────────────────────────────────────────────────────────── */
export default function StudioComposer({
  selectedMode,
  onModeChange,
  prompt,
  setPrompt,
  promptRef,
  settings,
  updateSettings,
  cost,
  availableCredits,
  canAfford,
  onEnhance,
  enhancing,
  isGenerating,
  onGenerate,
}) {
  const [guided,    setGuided]    = useState(false);
  const [subject,   setSubject]   = useState('');
  const [setting,   setSetting]   = useState('');
  const [style,     setStyle]     = useState('');
  const [mood,      setMood]      = useState('');
  const [openTile,  setOpenTile]  = useState(null);
  const [negPrmpt,  setNegPrmpt]  = useState('');

  /* Guided → prompt sync */
  useEffect(() => {
    if (!guided) return;
    const parts = [subject, setting, style, mood].filter(Boolean);
    if (parts.length) setPrompt(parts.join(', ').slice(0, PROMPT_LIMIT));
  }, [guided, subject, setting, style, mood, setPrompt]);

  const coach = scorePrompt(prompt);

  const MODE_TABS = [
    { id: 'image',    label: 'Image',    soon: false },
    { id: 'carousel', label: 'Carousel', soon: false },
    { id: 'video',    label: 'Video',    soon: false },
    { id: 'flyer',    label: 'Flyer',    soon: true  },
  ];

  const tiles = getDeckTiles(selectedMode, settings, updateSettings, negPrmpt, setNegPrmpt);

  const handleGenerate = useCallback(() => {
    if (negPrmpt) updateSettings({ negativePrompt: negPrmpt });
    onGenerate();
  }, [negPrmpt, updateSettings, onGenerate]);

  return (
    <div className="scp">
      {/* Mode bar */}
      <div className="scp-modes">
        {MODE_TABS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={[
              'scp-mode',
              selectedMode === m.id ? 'scp-mode--on' : '',
              m.soon ? 'scp-mode--soon' : '',
            ].join(' ')}
            onClick={() => !m.soon && onModeChange(m.id)}
            disabled={m.soon}
            title={m.soon ? 'Coming soon' : undefined}
          >
            {m.label}
            {m.soon && <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>soon</span>}
          </button>
        ))}
      </div>

      {/* Head: label + guided toggle */}
      <div className="scp-head">
        <span className="scp-label">Prompt</span>
        <button
          type="button"
          className={`scp-toggle${guided ? ' scp-toggle--on' : ''}`}
          onClick={() => setGuided((g) => !g)}
        >
          <span className="scp-toggle-dot" />
          Guided
        </button>
      </div>

      {/* Guided fields OR freeform textarea */}
      {guided ? (
        <GuidedFields
          subject={subject}   setSubject={setSubject}
          setting={setting}   setSetting={setSetting}
          style={style}       setStyle={setStyle}
          mood={mood}         setMood={setMood}
        />
      ) : (
        <textarea
          ref={promptRef}
          className="scp-textarea"
          placeholder="Describe what you want to create…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_LIMIT))}
          rows={3}
        />
      )}

      {/* Prompt coach */}
      {!guided && (
        <div className="scp-coach">
          <span className="scp-coach-lvl" style={{ color: coach.color }}>{coach.label}</span>
          <div className="scp-coach-meter">
            <div
              className="scp-coach-fill"
              style={{ width: `${coach.score}%`, background: coach.color }}
            />
          </div>
          <span className="scp-coach-tip">{coach.tip}</span>
        </div>
      )}

      {/* Control deck */}
      <div className="scd">
        {tiles.map((tile) => (
          <DeckTile
            key={tile.id}
            tile={tile}
            open={openTile === tile.id}
            onOpen={() => setOpenTile(tile.id)}
            onClose={() => setOpenTile(null)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="scp-footer">
        <div className="scp-cost">
          <strong>{cost}</strong> cr
          <span className="scp-balance">· {availableCredits.toLocaleString()} left</span>
        </div>
        <div className="scp-spacer" />
        <button
          type="button"
          className="scp-enhance"
          onClick={onEnhance}
          disabled={enhancing || !prompt.trim() || isGenerating}
          title="AI-enhance your prompt"
        >
          <Sliders size={14} />
          {enhancing ? 'Enhancing…' : 'Enhance'}
        </button>
        <button
          type="button"
          className="scp-generate"
          onClick={handleGenerate}
          disabled={!prompt.trim() || !canAfford || isGenerating}
        >
          <Sparkles size={14} />
          {isGenerating ? 'Generating…' : 'Generate'}
        </button>
      </div>
    </div>
  );
}
