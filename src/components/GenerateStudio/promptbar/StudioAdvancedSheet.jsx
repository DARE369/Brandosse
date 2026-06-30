import React from 'react';
import {
  MAGNIFIC_VIDEO_FPS,
  getVideoDurationsForModel,
} from '../../../config/magnificModels';

/* ─────────────────────────────────────────────────────────────────────────────
   StudioAdvancedSheet — advanced settings drawer (backdrop + panel)
   ───────────────────────────────────────────────────────────────────────────── */
export default function StudioAdvancedSheet({
  advancedOpen,
  setAdvancedOpen,
  selectedMode,
  settings,
  updateSettings,
  cost,
  availableCredits,
}) {
  return (
    <>
      {advancedOpen && <div className="studio-advanced-backdrop" onClick={() => setAdvancedOpen(false)} />}
      <div className={`studio-advanced ${advancedOpen ? 'is-open' : ''}`}>
        <div className="studio-advanced__inner">
          {(selectedMode === 'video' || selectedMode === 'image-to-video') && (
            <>
              <div className="studio-advanced__row">
                <span>Duration</span>
                <div className="studio-advanced__options">
                  {getVideoDurationsForModel(settings.model).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`studio-advanced__opt ${settings.duration === d ? 'is-active' : ''}`}
                      onClick={() => updateSettings({ duration: d })}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
              <div className="studio-advanced__row">
                <span>FPS</span>
                <div className="studio-advanced__options">
                  {MAGNIFIC_VIDEO_FPS.map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      className={`studio-advanced__opt ${settings.fps === fps ? 'is-active' : ''}`}
                      onClick={() => updateSettings({ fps })}
                    >
                      {fps}
                    </button>
                  ))}
                </div>
              </div>
              <div className="studio-advanced__row">
                <span>Audio</span>
                <label className="studio-advanced__toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.generateAudio)}
                    onChange={(e) => updateSettings({ generateAudio: e.target.checked })}
                  />
                  <span>{settings.generateAudio ? 'On' : 'Off'}</span>
                </label>
              </div>
            </>
          )}
          {selectedMode === 'image' && (
            <div className="studio-advanced__row">
              <span>Seed mode</span>
              <label className="studio-advanced__toggle">
                <input
                  type="checkbox"
                  checked={Boolean(settings.useSeed)}
                  onChange={(e) => updateSettings({ useSeed: e.target.checked, seed: e.target.checked ? (settings.seed || Math.floor(Math.random() * 99999)) : undefined })}
                />
                <span>{settings.useSeed ? `Seed: ${settings.seed || '—'}` : 'Off'}</span>
              </label>
            </div>
          )}
          {(selectedMode === 'image' || selectedMode === 'carousel') && (
            <div className="studio-advanced__row">
              <span>Style strength</span>
              <div className="studio-advanced__options">
                {['subtle', 'balanced', 'strong'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`studio-advanced__opt ${(settings.styleStrength || 'balanced') === s ? 'is-active' : ''}`}
                    onClick={() => updateSettings({ styleStrength: s })}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="studio-advanced__cost">
            <span>Estimated cost</span>
            <strong>{cost} credits</strong>
            <span className="studio-advanced__balance">{availableCredits.toLocaleString()} available</span>
          </div>
        </div>
      </div>
    </>
  );
}
