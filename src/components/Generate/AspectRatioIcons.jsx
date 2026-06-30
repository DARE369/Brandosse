import React from 'react';

export const ASPECT_RATIOS = [
  {
    value: '1:1',
    label: '1:1',
    ariaLabel: 'Square - 1 to 1',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    value: '4:5',
    label: '4:5',
    ariaLabel: 'Portrait - 4 to 5',
    icon: (
      <svg width="13" height="16" viewBox="0 0 13 16" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="11" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    value: '9:16',
    label: '9:16',
    ariaLabel: 'Tall portrait - 9 to 16, story format',
    icon: (
      <svg width="9" height="16" viewBox="0 0 9 16" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="7" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    value: '16:9',
    label: '16:9',
    ariaLabel: 'Landscape - 16 to 9',
    icon: (
      <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="14" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
];
