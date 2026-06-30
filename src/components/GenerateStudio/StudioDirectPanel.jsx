import React, { useState } from 'react';
import { RefreshCw, Star } from 'lucide-react';

const NUDGE_CHIPS = [
  { id: 'brighter',     label: '☀ Brighter' },
  { id: 'tighter',      label: '⊡ Tighter crop' },
  { id: 'remove-props', label: '✕ Remove props' },
  { id: 'on-brand',     label: '✦ More on-brand' },
  { id: 'like-top',     label: '★ More like top pick' },
];

export default function StudioDirectPanel({
  topPickGeneration,
  cost,
  availableCredits,
  canAfford,
  onRegenerate,
  isGenerating,
}) {
  const [selected, setSelected] = useState(new Set());
  const [nudge,    setNudge]    = useState('');

  function toggleChip(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleRegenerate() {
    const chipLabels = NUDGE_CHIPS
      .filter((c) => selected.has(c.id))
      .map((c) => c.label.replace(/^[^\w]+/, '').trim()); // strip icon
    const parts = [...chipLabels, nudge.trim()].filter(Boolean);
    onRegenerate?.(parts.join('. '));
    setSelected(new Set());
    setNudge('');
  }

  const hasAnyNudge = selected.size > 0 || nudge.trim().length > 0;
  const canRegen    = hasAnyNudge && canAfford && !isGenerating;

  return (
    <div className="sdp">
      {/* Header */}
      <div className="sdp-head">
        <div className="sdp-title">Direct the next round</div>
        <div className="sdp-sub">Quick nudges to refine the best take</div>
      </div>

      <div className="sdp-body">
        {/* Top pick preview */}
        {topPickGeneration && (
          <div className="sdp-top-pick">
            <img
              className="sdp-top-pick-thumb"
              src={topPickGeneration.thumbnail_url || topPickGeneration.output_url}
              alt="Top pick"
            />
            <div>
              <div className="sdp-top-pick-label">
                {topPickGeneration.prompt?.slice(0, 30) || 'Latest generation'}
                {topPickGeneration.prompt?.length > 30 ? '…' : ''}
              </div>
              <div className="sdp-top-pick-sub">Based on this result</div>
            </div>
            <span className="sdp-top-pick-badge"><Star size={9} /> Top pick</span>
          </div>
        )}

        {/* Refinement chips */}
        <div className="sdp-chips-label">Quick nudges</div>
        <div className="sdp-chips">
          {NUDGE_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`sdp-chip${selected.has(c.id) ? ' sdp-chip--on' : ''}`}
              onClick={() => toggleChip(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Custom nudge */}
        <div className="sdp-nudge-label">Or describe your change</div>
        <textarea
          className="sdp-nudge"
          placeholder="e.g. Make the background lighter and remove the text overlay…"
          value={nudge}
          onChange={(e) => setNudge(e.target.value)}
          rows={3}
        />
      </div>

      {/* Footer */}
      <div className="sdp-foot">
        <button
          type="button"
          className="sdp-regen"
          onClick={handleRegenerate}
          disabled={!canRegen}
        >
          <RefreshCw size={14} className={isGenerating ? 'studio-spin' : ''} />
          Regenerate · {cost} cr
        </button>
        <div className="sdp-cost-note">
          {availableCredits.toLocaleString()} credits remaining
        </div>
      </div>
    </div>
  );
}
