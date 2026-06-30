import React, { useState, useMemo } from 'react';
import { Calendar, Save, Send } from 'lucide-react';

/* Platform registry */
const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#E1306C', limit: 2200 },
  { id: 'linkedin',  label: 'LinkedIn',  icon: '💼', color: '#0A66C2', limit: 3000 },
  { id: 'tiktok',    label: 'TikTok',    icon: '🎵', color: '#010101', limit: 150  },
  { id: 'twitter',   label: 'X',         icon: '𝕏',  color: '#14171A', limit: 280  },
  { id: 'facebook',  label: 'Facebook',  icon: '👥', color: '#1877F2', limit: 63206 },
  { id: 'youtube',   label: 'YouTube',   icon: '▶',  color: '#FF0000', limit: 5000 },
];

function truncateCaption(caption, limit) {
  if (!caption) return '';
  if (caption.length <= limit) return caption;
  return caption.slice(0, limit - 3) + '…';
}

function CharCount({ text, limit }) {
  const len  = (text || '').length;
  const over = len > limit * 0.9;
  return (
    <span className={`spub-cap-count${over ? ' spub-cap-count--warn' : ''}`}>
      {len}/{limit > 9999 ? `${Math.round(limit / 1000)}k` : limit}
    </span>
  );
}

export default function StudioPublishPanel({
  selectedGeneration,
  postProduction,
  publishing,
  onSaveDraft,
  onPublish,
  onSchedule,
}) {
  const [activePlats, setActivePlats] = useState(new Set(['instagram', 'linkedin', 'tiktok']));
  const [captions,    setCaptions]    = useState({});

  const baseCaption  = postProduction?.caption || '';
  const baseHashtags = (postProduction?.hashtags || []).join(' ');

  function togglePlat(id) {
    setActivePlats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function getCaption(platId) {
    if (captions[platId] !== undefined) return captions[platId];
    const plat = PLATFORMS.find((p) => p.id === platId);
    return truncateCaption(baseCaption, plat?.limit ?? 2200);
  }

  function setCaption(platId, val) {
    setCaptions((prev) => ({ ...prev, [platId]: val }));
  }

  const activePlatList = useMemo(
    () => PLATFORMS.filter((p) => activePlats.has(p.id)),
    [activePlats],
  );

  const thumbUrl = selectedGeneration?.thumbnail_url || selectedGeneration?.output_url;
  const assetMode = selectedGeneration?.metadata?.content_type === 'video' ? 'Video' : 'Image';
  const assetRatio = selectedGeneration?.metadata?.aspect_ratio || '4:5';

  return (
    <div className="spub">
      {/* Header */}
      <div className="spub-head">
        <span className="spub-title">Publish</span>
        <span className="spub-demo-badge">Simulated publish</span>
      </div>

      <div className="spub-body">
        {/* Asset preview strip */}
        {thumbUrl && (
          <div className="spub-asset">
            <img className="spub-asset-thumb" src={thumbUrl} alt="Selected asset" />
            <div className="spub-asset-info">
              <div className="spub-asset-title">
                {selectedGeneration?.prompt?.slice(0, 42) || 'Selected generation'}
                {selectedGeneration?.prompt?.length > 42 ? '…' : ''}
              </div>
              <div className="spub-asset-meta">{assetMode} · {assetRatio} · AI generated</div>
            </div>
          </div>
        )}

        {/* Platform selector */}
        <div className="spub-section-label">Publish to</div>
        <div className="spub-plats">
          {PLATFORMS.map((p) => {
            const on = activePlats.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`spub-plat${on ? ' spub-plat--on' : ''}`}
                style={on ? { borderColor: p.color, background: p.color } : undefined}
                onClick={() => togglePlat(p.id)}
                title={p.label}
              >
                <span className="spub-plat-icon">{p.icon}</span>
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Per-platform caption cards */}
        {activePlatList.length > 0 && (
          <>
            <div className="spub-section-label">Captions</div>
            <div className="spub-captions">
              {activePlatList.map((plat) => {
                const cap   = getCaption(plat.id);
                const full  = cap + (baseHashtags ? '\n\n' + baseHashtags : '');
                return (
                  <div key={plat.id} className="spub-cap-card">
                    <div className="spub-cap-head">
                      <span className="spub-cap-plat">
                        <span className="spub-cap-dot" style={{ background: plat.color }} />
                        {plat.label}
                      </span>
                      <CharCount text={full} limit={plat.limit} />
                    </div>
                    <div className="spub-cap-body">
                      <p className="spub-cap-text">{cap || <em style={{ opacity: 0.4 }}>Generating caption…</em>}</p>
                      {baseHashtags && (
                        <p className="spub-cap-tags">{baseHashtags}</p>
                      )}
                      <div className="spub-cap-actions">
                        <button
                          type="button"
                          className="spub-cap-action"
                          onClick={() => {
                            const edited = window.prompt('Edit caption:', cap);
                            if (edited !== null) setCaption(plat.id, edited);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="spub-cap-action"
                          onClick={() => setCaption(plat.id, truncateCaption(baseCaption, plat.limit))}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="spub-foot">
        <div className="spub-foot-row">
          <button
            type="button"
            className="spub-foot-btn spub-foot-btn--secondary"
            onClick={onSaveDraft}
            disabled={publishing}
          >
            <Save size={13} />
            Save draft
          </button>
          <button
            type="button"
            className="spub-foot-btn spub-foot-btn--secondary"
            onClick={onSchedule}
            disabled={publishing}
          >
            <Calendar size={13} />
            Schedule
          </button>
        </div>
        <div className="spub-foot-row">
          <button
            type="button"
            className="spub-foot-btn spub-foot-btn--primary"
            onClick={() => onPublish?.(Array.from(activePlats))}
            disabled={publishing || activePlats.size === 0}
          >
            <Send size={13} />
            {publishing
              ? 'Publishing…'
              : `Publish to ${activePlats.size} platform${activePlats.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
