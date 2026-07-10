// ============================================================================
// API SERVICE LAYER — TEXT HELPERS (Groq)
//
// Image/video generation lives in src/services/media.service.js (fal.ai) —
// this file only covers the text-side helpers still called directly from the
// client: prompt enhancement, caption generation, SEO optimization.
// Provider API keys must stay server-side. Browser text generation falls back
// to mock responses unless routed through a trusted API/Edge Function.
// ============================================================================

const API_KEYS = {
  groq: '',
};

// ============================================================================
// 📝 TEXT GENERATION (Groq - Llama 3.3)
// ============================================================================

export async function generateText({ prompt, systemPrompt = '', maxTokens = 500 }) {
  return generateTextWithGroq({ prompt, systemPrompt, maxTokens });
}

/**
 * Generate text using Groq (Llama 3.3)
 * @private
 */
async function generateTextWithGroq({ prompt, systemPrompt, maxTokens }) {
  try {
    if (!API_KEYS.groq) {
      console.warn('⚠️ Groq API key not found. Using mock response.');
      return mockTextResponse();
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEYS.groq}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Latest model
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful AI assistant.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Groq API request failed');
    }

    const data = await response.json();
    return data.choices[0].message.content;

  } catch (error) {
    console.error('❌ Groq Text Generation Error:', error);
    throw error;
  }
}


// ============================================================================
// 🎨 PROMPT ENHANCEMENT
// ============================================================================

/**
 * Enhance a basic prompt into a detailed, high-quality prompt
 * @param {string} prompt - Basic user prompt
 * @returns {Promise<string>} Enhanced prompt
 */
export async function enhancePrompt(prompt) {
  const systemPrompt = `You are an expert prompt engineer for AI image and video generation.
Transform the user's basic prompt into a detailed, vivid description that will produce stunning results.

Rules:
- Add specific artistic styles, lighting, and composition details
- Include camera angles and cinematography terms for videos
- Keep the core concept but make it more descriptive
- Maximum 150 words
- Return ONLY the enhanced prompt, no explanations or quotes`;

  try {
    const enhanced = await generateText({
      prompt: `Enhance this prompt: "${prompt}"`,
      systemPrompt,
      maxTokens: 200,
    });

    // Clean the response
    return enhanced.trim().replace(/^["']|["']$/g, '');

  } catch (error) {
    console.error('Prompt enhancement failed:', error);
    // Return original prompt on error
    return prompt;
  }
}

// ============================================================================
// 📱 CAPTION GENERATION
// ============================================================================

/**
 * Generate social media captions from a prompt/image description
 * @param {string} context - Image description or generation prompt
 * @param {string} platform - 'instagram', 'linkedin', 'twitter', etc.
 * @returns {Promise<Object>} {caption, hashtags: [...]}
 */
export async function generateCaption(context, platform = 'instagram') {
  const platformGuidelines = {
    instagram: 'Engaging, visual, emoji-friendly, 2-3 sentences',
    linkedin: 'Professional, value-driven, thought-leadership tone',
    twitter: 'Concise, punchy, under 280 characters',
    youtube: 'Descriptive, SEO-friendly, call-to-action',
  };

  const systemPrompt = `You are a social media copywriter. Generate a ${platform} caption based on the content description.

Style: ${platformGuidelines[platform] || 'Engaging and platform-appropriate'}

Return ONLY a JSON object with this exact structure (no markdown, no code blocks):
{
  "caption": "The caption text here",
  "hashtags": ["tag1", "tag2", "tag3"]
}`;

  try {
    const response = await generateText({
      prompt: `Generate a ${platform} caption for: "${context}"`,
      systemPrompt,
      maxTokens: 300,
    });

    // Clean response (remove markdown code blocks if present)
    const cleanResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleanResponse);

    return {
      caption: parsed.caption || '',
      hashtags: parsed.hashtags || [],
    };

  } catch (error) {
    console.error('Caption generation failed:', error);

    // Fallback response
    return {
      caption: `Check out this amazing ${platform} post!`,
      hashtags: ['AI', 'Creative', 'Content', platform],
    };
  }
}

// ============================================================================
// 🔍 SEO OPTIMIZATION
// ============================================================================

/**
 * Optimize caption for search engines
 * @param {string} caption - Original caption
 * @param {Array<string>} hashtags - Original hashtags
 * @returns {Promise<Object>} {optimizedCaption, optimizedHashtags, seoScore}
 */
export async function optimizeForSEO(caption, hashtags) {
  const systemPrompt = `You are an SEO expert. Optimize this social media caption for search visibility while keeping it natural and engaging.

Rules:
- Add relevant keywords naturally
- Improve readability
- Suggest high-traffic hashtags
- Maintain the original tone

Return ONLY JSON (no markdown):
{
  "optimizedCaption": "...",
  "optimizedHashtags": ["tag1", "tag2"],
  "seoScore": 85,
  "improvements": ["Added keyword X", "Improved readability"]
}`;

  try {
    const response = await generateText({
      prompt: `Optimize this caption: "${caption}"\nHashtags: ${hashtags.join(', ')}`,
      systemPrompt,
      maxTokens: 400,
    });

    const cleanResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleanResponse);

  } catch (error) {
    console.error('SEO optimization failed:', error);

    return {
      optimizedCaption: caption,
      optimizedHashtags: hashtags,
      seoScore: 70,
      improvements: ['Original caption maintained'],
    };
  }
}

// ============================================================================
// 🧪 MOCK RESPONSES (For testing without API keys)
// ============================================================================

function mockTextResponse() {
  return 'This is a mock AI response. Please add your Groq API key to .env to enable real text generation.';
}
