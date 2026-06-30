import React from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   RatioIcon — small SVG rect representing an aspect ratio
   ───────────────────────────────────────────────────────────────────────────── */
export default function RatioIcon({ ratio, size = 12 }) {
  const map = { '1:1': [1, 1], '4:5': [0.8, 1], '9:16': [0.56, 1], '16:9': [1, 0.56] };
  const [rx, ry] = map[ratio] || [1, 1];
  const W = Math.round(size * rx);
  const H = Math.round(size * ry);
  return (
    <svg className="studio-ratio-icon" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x="0.75" y="0.75" width={W - 1.5} height={H - 1.5} rx="1.5"
        fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
