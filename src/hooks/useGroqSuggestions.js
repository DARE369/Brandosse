import { useCallback, useEffect, useMemo, useState } from 'react';
import { callGroqJSON } from '../services/groqClient';

const IMAGE_SUGGESTION_PROMPT = `
You are a creative social media content strategist.
Generate 4 highly specific, real-world image generation prompts that solve actual business problems.
Cover different categories: product photography, event flyers, brand graphics, lifestyle content.

Return ONLY valid JSON in this exact format:
{
  "suggestions": [
    { "category": "PRODUCT", "headline": "Short title max 4 words", "prompt": "Detailed image prompt min 15 words" },
    { "category": "FLYER", "headline": "Short title max 4 words", "prompt": "Detailed image prompt min 15 words" },
    { "category": "BRAND", "headline": "Short title max 4 words", "prompt": "Detailed image prompt min 15 words" },
    { "category": "LIFESTYLE", "headline": "Short title max 4 words", "prompt": "Detailed image prompt min 15 words" }
  ]
}
Be specific and unique each time. Today's date is ${new Date().toDateString()}.
`.trim();

const VIDEO_SUGGESTION_PROMPT = `
You are a creative social media video strategist.
Generate 4 highly specific, real-world video generation prompts that solve actual business problems.
Cover product demos, brand story videos, tutorial content, social ads.

Return ONLY valid JSON in this exact format:
{
  "suggestions": [
    { "category": "PRODUCT DEMO", "headline": "Short title max 4 words", "prompt": "Detailed video prompt min 15 words" },
    { "category": "BRAND STORY", "headline": "Short title max 4 words", "prompt": "Detailed video prompt min 15 words" },
    { "category": "TUTORIAL", "headline": "Short title max 4 words", "prompt": "Detailed video prompt min 15 words" },
    { "category": "SOCIAL AD", "headline": "Short title max 4 words", "prompt": "Detailed video prompt min 15 words" }
  ]
}
Be specific and unique each time. Today's date is ${new Date().toDateString()}.
`.trim();

function getFallbackSuggestions(isVideo) {
  if (isVideo) {
    return [
      {
        category: 'PRODUCT DEMO',
        headline: 'Unboxing Sequence',
        prompt: 'Cinematic unboxing video of premium skincare products on white backdrop with macro texture shots and smooth camera transitions.',
      },
      {
        category: 'BRAND STORY',
        headline: 'Founder Story',
        prompt: 'Documentary style short video showing a founder building an ethical coffee brand with workshop scenes and warm natural light.',
      },
      {
        category: 'TUTORIAL',
        headline: 'Quick How To',
        prompt: 'Vertical how-to tutorial showing three steps to style a minimalist workspace with text overlays and clean desk visuals.',
      },
      {
        category: 'SOCIAL AD',
        headline: 'Launch Teaser',
        prompt: 'High energy social ad for a new reusable bottle with punchy typography, motion blur transitions, and bold brand colors.',
      },
    ];
  }

  return [
    {
      category: 'PRODUCT',
      headline: 'Studio Hero Shot',
      prompt: 'Premium product photograph of a fragrance bottle on textured stone with soft side lighting and editorial composition.',
    },
    {
      category: 'FLYER',
      headline: 'Event Promo Poster',
      prompt: 'Modern flyer for rooftop music night at sunset with bold sans typography, warm gradients, and layered city skyline.',
    },
    {
      category: 'BRAND',
      headline: 'Identity Showcase',
      prompt: 'Brand post for sustainable coffee company using earthy tones, handmade texture accents, and artisan visual storytelling.',
    },
    {
      category: 'LIFESTYLE',
      headline: 'Campaign Moment',
      prompt: 'Lifestyle scene of young professional in bright coworking space with laptop and coffee, candid framing and natural morning light.',
    },
  ];
}

function normalizeSuggestions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      category: String(item?.category || '').trim(),
      headline: String(item?.headline || '').trim(),
      prompt: String(item?.prompt || '').trim(),
    }))
    .filter((item) => item.category && item.headline && item.prompt)
    .slice(0, 4);
}

export function useGroqSuggestions(mode = 'create-image') {
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const isVideoMode = useMemo(
    () => mode === 'text-to-video' || mode === 'frames-to-video',
    [mode],
  );

  const fetchSuggestions = useCallback(async () => {
    setIsLoading(true);
    setSuggestions([]);

    try {
      const prompt = isVideoMode ? VIDEO_SUGGESTION_PROMPT : IMAGE_SUGGESTION_PROMPT;
      const parsed = await callGroqJSON(prompt, {
        model: 'llama-3.3-70b-versatile',
        temperature: 0.95,
        max_tokens: 650,
        system: 'Return only valid JSON in the requested shape.',
      });

      const normalized = normalizeSuggestions(parsed?.suggestions);
      setSuggestions(normalized.length ? normalized : getFallbackSuggestions(isVideoMode));
    } catch (error) {
      console.error('[useGroqSuggestions] Failed:', error);
      setSuggestions(getFallbackSuggestions(isVideoMode));
    } finally {
      setIsLoading(false);
    }
  }, [isVideoMode]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  return {
    suggestions,
    isLoading,
    refresh: fetchSuggestions,
  };
}
