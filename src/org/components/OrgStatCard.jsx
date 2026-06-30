import React from 'react';
import { UiCard } from '../../components/Shared/ui';

export default function OrgStatCard({
  title,
  value,
  subtitle = '',
  tone = 'default',
  onClick = null,
}) {
  const content = (
    <>
      <span className="org-stat-title">{title}</span>
      <strong className="org-stat-value">{value}</strong>
      {subtitle ? <span className="org-stat-subtitle">{subtitle}</span> : null}
    </>
  );

  if (typeof onClick === 'function') {
    return (
      <UiCard
        as="button"
        type="button"
        className={`org-stat-card tone-${tone}`}
        interactive
        onClick={onClick}
      >
        {content}
      </UiCard>
    );
  }

  return (
    <UiCard as="article" className={`org-stat-card tone-${tone}`}>
      {content}
    </UiCard>
  );
}
