// ============================================================================
// API SERVICE LAYER - POLLINATIONS AI + GROQ
//
// Images/Videos: Pollinations AI (FREE, no API key needed)
// Text: Groq (fast Llama 3.3 — server-side via edge functions)
// Provider API keys must stay server-side. Browser text generation falls back
// to mock responses unless routed through a trusted API/Edge Function.
// ============================================================================

const API_KEYS = {
  groq: '',
};

// ============================================================================
// 🖼️ IMAGE GENERATION (Pollinations AI - FREE)
// ============================================================================

/**
 * Generate images using Pollinations AI
 * FREE, unlimited generations, no API key needed!
 * 
 * @param {Object} params
 * @param {string} params.prompt - The generation prompt
 * @param {string} params.aspectRatio - "1:1", "16:9", "9:16", "4:5"
 * @param {number} params.numImages - Number of images (1-4)
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<Array>} Array of {url, width, height}
 */
export async function generateImages({ 
  prompt, 
  aspectRatio = '1:1', 
  numImages = 1, 
  onProgress 
}) {
  try {
    // Clean and validate prompt
    const cleanPrompt = cleanPromptText(prompt);
    
    if (!cleanPrompt) {
      throw new Error('Invalid prompt: prompt cannot be empty');
    }

    console.log('🎨 Generating with Pollinations AI...', { 
      prompt: cleanPrompt.slice(0, 50) + '...', 
      aspectRatio, 
      numImages 
    });
    
    // Map aspect ratios to dimensions (optimized for Pollinations)
    const dimensionMap = {
      '1:1': { width: 1024, height: 1024 },
      '16:9': { width: 1456, height: 816 },   // HD landscape
      '9:16': { width: 816, height: 1456 },   // HD portrait
      '4:5': { width: 1024, height: 1280 },   // Instagram portrait
    };
    
    const dimensions = dimensionMap[aspectRatio] || dimensionMap['1:1'];
    const images = [];
    
    // Generate each image with unique seed
    for (let i = 0; i < numImages; i++) {
      const seed = generateUniqueSeed();
      const imageUrl = buildPollinationsUrl(cleanPrompt, dimensions, seed);
      
      console.log(`📸 Image ${i + 1}/${numImages}: ${imageUrl.slice(0, 100)}...`);
      
      // Update progress
      if (onProgress) {
        onProgress(((i + 1) / numImages) * 100);
      }
      
      images.push({
        url: imageUrl,
        width: dimensions.width,
        height: dimensions.height,
        seed: seed,
      });
      
      // Small delay between images to ensure unique seeds
      await delay(10);
    }
    
    console.log(`✅ Successfully generated ${images.length} image(s)`);
    return images;
    
  } catch (error) {
    console.error('❌ Pollinations Image Generation Error:', error);
    throw error;
  }
}

/**
 * Build optimized Pollinations AI URL
 * @private
 */
function buildPollinationsUrl(prompt, dimensions, seed) {
  const baseUrl = 'https://image.pollinations.ai/prompt';
  
  // Build query parameters
  const params = new URLSearchParams({
    width: dimensions.width.toString(),
    height: dimensions.height.toString(),
    seed: seed.toString(),
    nologo: 'true',           // Remove watermark
    model: 'flux',            // Best model
    enhance: 'true',          // Auto-enhance prompt
    nofeed: 'true',           // Don't add to public feed
  });
  
  // Construct final URL with encoded prompt
  return `${baseUrl}/${encodeURIComponent(prompt)}?${params.toString()}`;
}

/**
 * Generate unique seed for image variation
 * @private
 */
function generateUniqueSeed() {
  return Math.floor(Math.random() * 1000000) + Date.now() % 1000;
}

/**
 * Clean and validate prompt text
 * @private
 */
function cleanPromptText(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }
  
  return prompt
    .trim()
    .replace(/^["']+|["']+$/g, '')  // Remove leading/trailing quotes
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .replace(/\n+/g, ' ')            // Remove newlines
    .slice(0, 1000);                 // Limit length
}

/**
 * Simple delay utility
 * @private
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Best-effort reachability check for provider URLs.
 * Returns false on DNS/network errors and true otherwise.
 * @private
 */
async function canReachUrl(url, timeoutMs = 3500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// 🎥 VIDEO GENERATION (Pollinations AI - Experimental)
// ============================================================================

/**
 * Generate video using Pollinations AI
 * Note: Video generation is experimental and may be slow
 * 
 * @param {Object} params
 * @param {string} params.prompt - The generation prompt
 * @param {string} params.aspectRatio - "16:9", "9:16", "1:1"
 * @param {number} params.duration - Duration in seconds (not used yet)
 * @returns {Promise<Object>} {url, width, height, duration}
 */
export async function generateVideo({ 
  prompt, 
  aspectRatio = '16:9', 
  duration = 4 
}) {
  try {
    const cleanPrompt = cleanPromptText(prompt);
    
    console.log('🎥 Generating video with Pollinations AI...', { 
      prompt: cleanPrompt.slice(0, 50) + '...', 
      aspectRatio 
    });
    
    // Map aspect ratios
    const dimensionMap = {
      '16:9': { width: 1280, height: 720 },
      '9:16': { width: 720, height: 1280 },
      '1:1': { width: 1024, height: 1024 },
    };
    
    const dimensions = dimensionMap[aspectRatio] || dimensionMap['16:9'];
    const seed = generateUniqueSeed();
    
    // Build Pollinations video URL (experimental endpoint)
    const videoUrl = `https://video.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=${dimensions.width}&height=${dimensions.height}&seed=${seed}`;

    // If provider host is unreachable (DNS/network), fall back immediately
    // so the UI does not keep rendering broken media URLs.
    const reachable = await canReachUrl(videoUrl);
    if (!reachable) {
      console.warn('Video provider unreachable. Falling back to placeholder video');
      return mockVideoResponse();
    }
    
    return {
      url: videoUrl,
      width: dimensions.width,
      height: dimensions.height,
      duration: duration,
      seed: seed,
    };
    
  } catch (error) {
    console.error('❌ Video Generation Error:', error);
    
    // Fallback to placeholder
    console.warn('⚠️ Falling back to placeholder video');
    return mockVideoResponse();
  }
}

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

function mockVideoResponse() {
  return {
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    width: 1920,
    height: 1080,
    duration: 4,
  };
}

function mockTextResponse() {
  return 'This is a mock AI response. Please add your Groq API key to .env to enable real text generation.';
}

// ============================================================================
// 📊 API HEALTH CHECK
// ============================================================================

/**
 * Check which APIs are configured and working
 * @returns {Object} Status of each API provider
 */
export function checkApiStatus() {
  return {
    images: {
      provider: 'Pollinations AI',
      configured: true, // Always available (no key needed)
      status: 'Ready - FREE & Unlimited',
      url: 'https://pollinations.ai',
    },
    videos: {
      provider: 'Pollinations AI (Experimental)',
      configured: true,
      status: 'Ready - FREE (Beta)',
      url: 'https://pollinations.ai',
    },
    text: {
      provider: 'Groq',
      configured: Boolean(API_KEYS.groq),
      status: API_KEYS.groq ? 'Ready - FREE' : 'Missing API Key',
      url: 'https://groq.com',
    },
  };
}

// ============================================================================
// 💰 COST ESTIMATION (All FREE with current setup!)
// ============================================================================

/**
 * Estimate generation cost
 * @param {string} type - 'image' or 'video'
 * @param {number} count - Number of generations
 * @returns {number} Estimated cost in credits (0 for free tier)
 */
export function estimateCost(type, count = 1) {
  const costs = {
    image: 0,  // FREE with Pollinations
    video: 0,  // FREE with Pollinations (experimental)
    text: 0,   // FREE with Groq
  };
  
  return (costs[type] || 0) * count;
}

// ============================================================================
// 🔄 PROVIDER SWITCHING (For future use)
// ============================================================================

/**
 * Switch image provider (for when you want to use paid services)
 * @param {string} provider - 'pollinations', 'fal', 'dalle', etc.
 */
export function setImageProvider(provider) {
  console.log(`🔄 Switching image provider to: ${provider}`);
  // This can be implemented when you add more providers
  // For now, always using Pollinations
}

export function setTextProvider(provider) {
  console.log(`🔄 Text provider: ${provider}`);
}
