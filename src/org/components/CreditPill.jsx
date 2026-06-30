import React from 'react';

function getTone(remaining, total) {
  if (!total) return 'medium';
  const pct = remaining / total;
  if (pct <= 0.3) return 'low';
  if (pct <= 0.6) return 'medium';
  return 'high';
}

export default function CreditPill({
  used = 0,
  total = 0,
  onClick = () => {},
}) {
  const remaining = Math.max(0, Number(total || 0) - Number(used || 0));
  const tone = getTone(remaining, total);

  return (
    <button type="button" className={`org-credit-pill tone-${tone}`} onClick={onClick}>
      <span className="org-credit-pill-dot" />
      <span>{remaining} credits</span>
    </button>
  );
}
