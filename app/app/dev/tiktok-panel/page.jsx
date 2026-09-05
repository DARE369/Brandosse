"use client";

/**
 * /app/dev/tiktok-panel — design preview for the TikTok Direct Post panel.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The panel renders from live creator_info, which needs a connected TikTok
 * account, which needs a sandbox, which needs an approved app. So until the
 * review clears there is no way to look at the thing the review depends on.
 *
 * This page supplies a stubbed creator_info payload so the design can be
 * reviewed and corrected now. Every compliance rule still applies to what
 * renders — only the source of the data changes.
 *
 * ── This is NOT the demo video ──────────────────────────────────────────────
 * TikTok requires the video to show the real integration on the real domain,
 * recorded against a sandbox. Filming this page would be recording a mock, and
 * the guidelines call that out. This is for design review only.
 */

import { useState } from 'react';
import TikTokOptionsPanel from '../../../../src/components/Publishing/TikTokOptionsPanel';

/** Shapes match the creator_info route's response exactly. */
const SCENARIOS = {
  public: {
    label: 'Public account',
    note: 'All three privacy levels offered. Nothing restricted.',
    data: {
      creatorNickname: 'Dare Ojomo',
      creatorUsername: 'dareojomo',
      creatorAvatarUrl: null,
      privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      maxVideoPostDurationSec: 600,
    },
  },
  private: {
    label: 'Private account',
    note: 'A different option set — PUBLIC_TO_EVERYONE is absent. This is why the list is never hardcoded.',
    data: {
      creatorNickname: 'Dare Ojomo',
      creatorUsername: 'dareojomo',
      creatorAvatarUrl: null,
      privacyLevelOptions: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      commentDisabled: false,
      duetDisabled: true,
      stitchDisabled: true,
      maxVideoPostDurationSec: 180,
    },
  },
  restricted: {
    label: 'Interactions switched off',
    note: 'Creator disabled comments, duet and stitch in TikTok. All three must show greyed out with a reason.',
    data: {
      creatorNickname: 'Dare Ojomo',
      creatorUsername: 'dareojomo',
      creatorAvatarUrl: null,
      privacyLevelOptions: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      commentDisabled: true,
      duetDisabled: true,
      stitchDisabled: true,
      maxVideoPostDurationSec: 60,
    },
  },
};

export default function TikTokPanelPreview() {
  const [scenario, setScenario] = useState('public');
  const [mediaType, setMediaType] = useState('video');
  const [durationSec, setDurationSec] = useState(45);
  const [settings, setSettings] = useState(null);
  const [valid, setValid] = useState(false);

  const current = SCENARIOS[scenario];

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--uiv2-bg, #0E0F11)',
      color: 'var(--uiv2-text-primary, #F5F5F4)', padding: 24,
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 20 }}>

        <header>
          <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>TikTok Direct Post panel — design preview</h1>
          <p style={{ fontSize: 13, color: 'var(--uiv2-text-secondary, #8B8D93)', margin: 0, maxWidth: '70ch' }}>
            Rendered against stubbed <code>creator_info</code> so it can be reviewed before a
            sandbox account exists. <strong>Not for the demo video</strong> — TikTok requires
            that to show the real integration.
          </p>
        </header>

        {/* Controls */}
        <div style={{
          display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end',
          padding: 14, border: '1px solid var(--uiv2-border, #26282C)', borderRadius: 10,
          background: 'var(--uiv2-surface-2, #141518)',
        }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--uiv2-text-secondary, #8B8D93)' }}>Account state</span>
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              style={selectStyle}
            >
              {Object.entries(SCENARIOS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--uiv2-text-secondary, #8B8D93)' }}>Media type</span>
            <select value={mediaType} onChange={(e) => setMediaType(e.target.value)} style={selectStyle}>
              <option value="video">Video</option>
              <option value="photo">Photo</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--uiv2-text-secondary, #8B8D93)' }}>
              Video length: {durationSec}s
            </span>
            <input
              type="range" min="5" max="900" step="5"
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
              style={{ width: 220 }}
            />
          </label>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--uiv2-text-secondary, #8B8D93)', margin: 0 }}>
          {current.note}
        </p>

        {/* The panel itself. `key` forces a clean remount per scenario so the
            mandated defaults are re-proved rather than carried over. */}
        <div style={{ maxWidth: 520 }}>
          <TikTokOptionsPanel
            key={`${scenario}-${mediaType}`}
            accountId="preview"
            mediaType={mediaType}
            mediaDurationSec={durationSec}
            previewCreatorInfo={current.data}
            onChange={setSettings}
            onValidityChange={setValid}
          />
        </div>

        {/* What the composer would receive — makes the contract visible. */}
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--uiv2-text-tertiary, #5A5C61)',
          }}>
            Payload sent to the composer
            <span style={{
              padding: '2px 7px', borderRadius: 4, letterSpacing: 0,
              textTransform: 'none', fontSize: 11,
              color: valid ? '#5BB98B' : '#FFB224',
              border: `1px solid ${valid ? 'rgba(91,185,139,.4)' : 'rgba(255,178,36,.4)'}`,
            }}>
              {valid ? 'publish enabled' : 'publish blocked'}
            </span>
          </div>
          <pre style={{
            margin: 0, padding: 14, borderRadius: 10, fontSize: 12, lineHeight: 1.6,
            background: 'var(--uiv2-surface-2, #141518)',
            border: '1px solid var(--uiv2-border, #26282C)',
            color: 'var(--uiv2-text-secondary, #8B8D93)', overflowX: 'auto',
          }}>
{JSON.stringify(settings, null, 2) || 'null'}
          </pre>
          <p style={{ fontSize: 11.5, color: 'var(--uiv2-text-tertiary, #5A5C61)', marginTop: 8 }}>
            Publish stays blocked until a privacy level is actively chosen — that is the
            requirement TikTok rejects apps over, so it is visible here on purpose.
          </p>
        </div>
      </div>
    </div>
  );
}

const selectStyle = {
  minHeight: 36,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--uiv2-border, #26282C)',
  background: 'var(--uiv2-surface, #17181B)',
  color: 'var(--uiv2-text-primary, #F5F5F4)',
  fontSize: 13,
  fontFamily: 'inherit',
};
