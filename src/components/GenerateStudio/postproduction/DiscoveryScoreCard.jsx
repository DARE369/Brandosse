import React from 'react';
import { TrendingUp } from 'lucide-react';
import { SOCIAL_SEO_DIMENSIONS } from '../shared/constants';
import { scoreColorClass, scoreGrade } from '../shared/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
   DiscoveryScoreCard
   ───────────────────────────────────────────────────────────────────────────── */
export default function DiscoveryScoreCard({ score, breakdown, suggestions, loading }) {
  const cls   = scoreColorClass(score);
  const grade = scoreGrade(score);
  const circumference = 2 * Math.PI * 18; // r=18

  return (
    <div className={`studio-score ${loading ? 'is-loading' : ''}`}>
      <div className="studio-score__header">
        <div>
          <div className={`studio-score__number studio-score__number--${cls}`}>
            {score}<span>/100</span>
          </div>
          <div className={`studio-score__grade studio-score__grade--${cls}`}>{grade}</div>
        </div>
        <svg className="studio-score__ring" width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--bgs-border)" strokeWidth="3" />
          <circle
            cx="22" cy="22" r="18"
            fill="none"
            stroke={cls === 'success' ? 'var(--bgs-success)' : cls === 'warning' ? 'var(--bgs-warning)' : 'var(--bgs-danger)'}
            strokeWidth="3"
            strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
            strokeLinecap="round"
            transform="rotate(-90 22 22)"
            style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.16,1,0.3,1)' }}
          />
        </svg>
      </div>

      <div className="studio-score__bars">
        {SOCIAL_SEO_DIMENSIONS.map(([key, label]) => {
          const val = Math.max(0, Math.min(100, Number(breakdown?.[key] || 0)));
          return (
            <div key={key} className="studio-score__bar">
              <span className="studio-score__bar-label">{label}</span>
              <div className="studio-score__bar-track">
                <div className="studio-score__bar-fill" style={{ width: `${val}%` }} />
              </div>
              <span className="studio-score__bar-value">{val}</span>
            </div>
          );
        })}
      </div>

      {suggestions?.length > 0 && (
        <div className="studio-score__suggestions">
          {suggestions.map((s, i) => (
            <div key={i} className="studio-score__suggestion">
              <TrendingUp size={12} />
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
