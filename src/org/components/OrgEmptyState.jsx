import React from 'react';
import { UiEmptyState } from '../../components/Shared/ui';

export default function OrgEmptyState({
  eyebrow = 'Workspace',
  title = 'Nothing here yet',
  description = 'This area will populate as your organization starts collaborating.',
  action = null,
}) {
  return (
    <UiEmptyState
      className="org-empty-state"
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={action}
    />
  );
}
