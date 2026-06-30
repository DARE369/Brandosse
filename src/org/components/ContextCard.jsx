import React from 'react';

function getInitials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'WS';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function ContextCard({
  title,
  subtitle,
  badge,
  description,
  primary = false,
  onClick,
  imageUrl = null,
  color = 'var(--org-accent)',
}) {
  return (
    <button
      type="button"
      className={`context-card ${primary ? 'context-card--primary' : ''}`}
      onClick={onClick}
      aria-pressed={primary}
    >
      <div
        className="context-card-avatar"
        style={{ background: `linear-gradient(135deg, ${color}, var(--org-subtle-highlight))` }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={title} />
        ) : (
          <span>{getInitials(title)}</span>
        )}
      </div>
      <strong>{title}</strong>
      {badge ? <span className="context-card-badge">{badge}</span> : null}
      {subtitle ? <span className="context-card-subtitle">{subtitle}</span> : null}
      {description ? <span className="context-card-description">{description}</span> : null}
      {primary ? <span className="context-card-last-used">Continue where you left off</span> : null}
    </button>
  );
}
