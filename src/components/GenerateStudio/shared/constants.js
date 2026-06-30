import React from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   Constants — extracted verbatim from BrandosseGenerateStudio.jsx
   ───────────────────────────────────────────────────────────────────────────── */
export const PROMPT_LIMIT = 2000;

export const SOCIAL_SEO_DIMENSIONS = [
  ['readability', 'Readability'],
  ['keywordRelevance', 'Keyword relevance'],
  ['hashtagQuality', 'Hashtag quality'],
  ['hookStrength', 'Hook strength'],
  ['ctaStrength', 'CTA strength'],
  ['platformFit', 'Platform fit'],
  ['brandConsistency', 'Brand consistency'],
  ['visualCaptionAlignment', 'Visual alignment'],
  ['recommendationPotential', 'Discovery potential'],
];

export const PLATFORM_CAPTION_HINTS = {
  instagram: '5–12 hashtags · strong first line · niche + broad mix',
  tiktok: '3–5 search hashtags · concise hook · trending phrases',
  youtube: 'Searchable title required · description-style caption',
  facebook: 'Conversational · 2–5 hashtags',
  linkedin: 'Professional keywords in opening sentence',
  x: 'Short copy · 0–2 hashtags',
  twitter: 'Short copy · 0–2 hashtags',
};

export const INTENT_GOALS = [
  {
    id: 'promote',
    label: 'Promote a Product',
    sub: 'Drive sales with compelling ads',
    color: 'violet',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/>
        <path d="M16 10a4 4 0 01-8 0"/>
      </svg>
    ),
  },
  {
    id: 'awareness',
    label: 'Brand Awareness',
    sub: 'Build recognition at scale',
    color: 'amber',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="2"/>
        <path d="M16.24 7.76a6 6 0 010 8.49M7.76 7.76a6 6 0 000 8.49M20.49 3.51a14 14 0 010 16.98M3.51 3.51a14 14 0 000 16.98"/>
      </svg>
    ),
  },
  {
    id: 'educate',
    label: 'Educate & Teach',
    sub: 'Share knowledge that builds authority',
    color: 'emerald',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
      </svg>
    ),
  },
  {
    id: 'engage',
    label: 'Drive Engagement',
    sub: 'Spark saves, shares & comments',
    color: 'rose',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    id: 'explore',
    label: 'Just Explore',
    sub: 'Free-form creation, no constraints',
    color: 'sky',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="10"/>
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
      </svg>
    ),
  },
];

export const INTENT_PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'LinkedIn', 'X'];
export const INTENT_TONES     = ['Aspirational', 'Professional', 'Playful', 'Educational', 'Bold & Direct', 'Luxury'];

export const PLATFORM_DEFAULT_RATIO = {
  instagram: '4:5',
  tiktok:    '9:16',
  youtube:   '16:9',
  facebook:  '1:1',
  linkedin:  '16:9',
  x:         '16:9',
};

export const PROMPT_SUGGESTIONS = {
  image: [
    'A serene morning café scene with golden light and fresh coffee on a marble surface',
    'Bold product close-up on a clean white background with dramatic shadow detail',
    'Vibrant lifestyle moment — someone using the product outdoors in natural sunlight',
    'Minimalist flat lay with seasonal props and a precise on-brand color palette',
  ],
  carousel: [
    '5-slide series: "3 Ways to Transform Your Morning Routine" with clean typography',
    'Product benefit breakdown — before and after with consistent typographic slides',
    'Step-by-step tutorial with numbered slides and a unified visual style',
    'Brand story carousel — founding moment, mission statement, and call to action',
  ],
  video: [
    'Dynamic product reveal with a slow cinematic camera pan and warm color grade',
    'Upbeat lifestyle montage showing the product in three everyday scenarios',
    'Slow-motion close-up of product detail with atmospheric depth-of-field',
    'Bold text-on-screen announcement with brand typography and punchy music sync',
  ],
  edit: [
    'Remove the background and place the subject on a clean white studio surface',
    'Add warm sunset glow and soft bokeh lighting to the existing image',
    'Recolor all accent elements to match our brand primary color palette',
    'Apply subtle analog film grain and a warm shadow lift for editorial mood',
  ],
  'image-to-video': [
    'Gentle forward camera push into the scene with a soft light drift',
    'Product slowly rotates 360° with floating dust motes in the background',
    'Hero motion: leaves sway naturally, steam rises slowly from the coffee cup',
    'Camera orbit around the subject with a cinematic depth-of-field shift',
  ],
};
