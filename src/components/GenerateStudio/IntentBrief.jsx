import React, { useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import PlatformIcon from '../Shared/PlatformIcon';
import { INTENT_GOALS, INTENT_PLATFORMS, INTENT_TONES } from './shared/constants';

/* ─────────────────────────────────────────────────────────────────────────────
   IntentBrief (formerly IntentCard) — empty-state brief builder
   ───────────────────────────────────────────────────────────────────────────── */
export default function IntentBrief({ onBuildBrief, onSkip }) {
  const [goal, setGoal]           = useState('');
  const [platforms, setPlatforms] = useState(new Set(['Instagram']));
  const [tone, setTone]           = useState('Aspirational');
  const [building, setBuilding]   = useState(false);

  const togglePlatform = (p) => {
    setPlatforms(prev => {
      const next = new Set(prev);
      if (next.has(p)) {
        if (next.size > 1) next.delete(p);
      } else {
        next.add(p);
      }
      return next;
    });
  };

  const handleBuild = async () => {
    if (!goal) return;
    setBuilding(true);
    try {
      const primaryPlatform = [...platforms][0];
      await onBuildBrief({ goal, platform: primaryPlatform.toLowerCase(), tone: tone.toLowerCase() });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="studio-intent">
      <div className="studio-intent__card">
        <span className="studio-intent__eyebrow">New session</span>
        <h2 className="studio-intent__heading">What are you creating today?</h2>

        {/* Goal cards — 6-column grid (3+2 rows) */}
        <div className="studio-intent__goal-grid">
          {INTENT_GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              data-color={g.color}
              className={`studio-intent__goal-card ${goal === g.id ? 'is-selected' : ''}`}
              onClick={() => setGoal(g.id)}
            >
              <div className="studio-intent__goal-card-bg" />
              <div className="studio-intent__goal-card-top">
                <div className="studio-intent__goal-icon-wrap">{g.icon}</div>
                <div className="studio-intent__goal-check"><Check size={9} /></div>
              </div>
              <div>
                <div className="studio-intent__goal-title">{g.label}</div>
                <div className="studio-intent__goal-sub">{g.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Platform chips */}
        <div className="studio-intent__chip-section">
          <div className="studio-intent__chip-label">Platform</div>
          <div className="studio-intent__chips">
            {INTENT_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className={`studio-intent__chip ${platforms.has(p) ? 'is-active' : ''}`}
                onClick={() => togglePlatform(p)}
              >
                <PlatformIcon platform={p.toLowerCase()} size="xs" />
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Tone chips */}
        <div className="studio-intent__chip-section">
          <div className="studio-intent__chip-label">Tone</div>
          <div className="studio-intent__chips">
            {INTENT_TONES.map((t) => (
              <button
                key={t}
                type="button"
                className={`studio-intent__chip ${tone === t ? 'is-active' : ''}`}
                onClick={() => setTone(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-intent__divider" />

        <div className="studio-intent__footer">
          <button
            type="button"
            className="studio-intent__generate"
            onClick={handleBuild}
            disabled={!goal || building}
          >
            {building ? (
              <><Loader2 size={14} className="studio-spin" /> Building brief…</>
            ) : (
              <><Sparkles size={14} /> Generate Content</>
            )}
          </button>
          <button type="button" className="studio-intent__skip" onClick={onSkip}>
            Skip — I'll write my own
          </button>
        </div>
      </div>
    </div>
  );
}
