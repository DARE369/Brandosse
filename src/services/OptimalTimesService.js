// ============================================================================
// OPTIMAL TIMES SERVICE - AI-Powered Posting Time Analysis
// Uses Groq (Llama 3.3) to analyze user's posting performance and trends
// ============================================================================

import { generateText } from './ApiService';
import { supabase } from './supabaseClient';

// ============================================================================
// CORE ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Analyze user's post performance and update optimal_posting_times table
 * This should run daily via Supabase pg_cron
 * 
 * @param {string} userId - User ID
 * @param {string} platform - 'instagram', 'tiktok', 'youtube', 'facebook'
 * @returns {Promise<Object>} Analysis results
 */
export async function analyzeOptimalTimes(userId, platform) {
  try {
    console.log(`🔍 Analyzing optimal times for ${platform}...`);

    // 1. Fetch user's published posts with analytics
    const { data: posts, error } = await supabase
      .from('posts')
      .select(`
        *,
        platform_analytics (*)
      `)
      .eq('user_id', userId)
      .eq('status', 'published')
      .not('scheduled_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(100); // Analyze last 100 posts

    if (error) throw error;

    if (!posts || posts.length === 0) {
      console.warn('No published posts found for analysis');
      return { success: false, message: 'Not enough data' };
    }

    // 2. Filter posts for specific platform
    const platformPosts = posts.filter(p => 
      p.connected_accounts?.platform === platform || p.platform === platform
    );

    if (platformPosts.length < 5) {
      console.warn(`Not enough ${platform} posts for analysis (need at least 5)`);
      return { success: false, message: 'Need at least 5 posts' };
    }

    // 3. Group posts by day/hour and calculate engagement
    const timeSlotData = groupPostsByTimeSlot(platformPosts);

    // 4. Use Groq to analyze patterns
    const aiAnalysis = await analyzeWithAI(timeSlotData, platform);

    // 5. Update database with recommendations
    await saveOptimalTimes(userId, platform, aiAnalysis);

    console.log('✅ Analysis complete:', aiAnalysis.topTimes.length, 'optimal times found');

    return {
      success: true,
      platform,
      topTimes: aiAnalysis.topTimes,
      insights: aiAnalysis.insights,
    };

  } catch (error) {
    console.error('❌ Optimal times analysis failed:', error);
    throw error;
  }
}

/**
 * Get optimal posting time recommendation for a specific date
 * 
 * @param {string} userId - User ID
 * @param {string} platform - Platform name
 * @param {Date} targetDate - Target date
 * @returns {Promise<Date>} Recommended posting time
 */
export async function getRecommendedTime(userId, platform, targetDate) {
  try {
    const dayOfWeek = targetDate.getDay();
    
    // Query optimal times for this day/platform
    const { data: optimalTimes, error } = await supabase
      .from('optimal_posting_times')
      .select('*')
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('day_of_week', dayOfWeek)
      .gte('sample_size', 3) // Need at least 3 data points
      .order('score', { ascending: false })
      .limit(3);

    if (error) throw error;

    if (optimalTimes && optimalTimes.length > 0) {
      // Return top recommended hour
      const bestHour = optimalTimes[0].hour_of_day;
      const recommendedTime = new Date(targetDate);
      recommendedTime.setHours(bestHour, 0, 0, 0);
      
      return {
        time: recommendedTime,
        score: optimalTimes[0].score,
        reasoning: `Based on ${optimalTimes[0].sample_size} previous posts, ${bestHour}:00 shows ${Math.round(optimalTimes[0].score)}% better engagement`,
        alternatives: optimalTimes.slice(1).map(t => ({
          hour: t.hour_of_day,
          score: t.score,
        })),
      };
    } else {
      // Fallback to platform default best times
      return getDefaultBestTime(platform, targetDate);
    }

  } catch (error) {
    console.error('Failed to get recommended time:', error);
    return getDefaultBestTime(platform, targetDate);
  }
}

/**
 * Batch analyze all platforms for a user
 * Should be called daily
 */
export async function analyzeAllPlatforms(userId) {
  const platforms = ['instagram', 'tiktok', 'youtube', 'facebook'];
  const results = [];

  for (const platform of platforms) {
    try {
      const result = await analyzeOptimalTimes(userId, platform);
      results.push({ platform, ...result });
    } catch (error) {
      console.error(`Failed to analyze ${platform}:`, error);
      results.push({ platform, success: false, error: error.message });
    }
  }

  return results;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Group posts by day of week and hour, calculate average engagement
 */
function groupPostsByTimeSlot(posts) {
  const slots = {};

  posts.forEach(post => {
    const postDate = new Date(post.scheduled_at);
    const dayOfWeek = postDate.getDay(); // 0-6
    const hour = postDate.getHours(); // 0-23
    const key = `${dayOfWeek}-${hour}`;

    if (!slots[key]) {
      slots[key] = {
        day_of_week: dayOfWeek,
        hour_of_day: hour,
        posts: [],
        total_engagement: 0,
        avg_engagement: 0,
      };
    }

    // Calculate engagement rate from analytics
    const analytics = post.platform_analytics?.[0];
    const engagement = analytics ? 
      calculateEngagementScore(analytics) : 0;

    slots[key].posts.push({
      id: post.id,
      engagement,
      views: analytics?.views || 0,
      likes: analytics?.likes || 0,
      comments: analytics?.comments || 0,
      shares: analytics?.shares || 0,
    });

    slots[key].total_engagement += engagement;
  });

  // Calculate averages
  Object.values(slots).forEach(slot => {
    slot.avg_engagement = slot.total_engagement / slot.posts.length;
    slot.sample_size = slot.posts.length;
  });

  return Object.values(slots).sort((a, b) => b.avg_engagement - a.avg_engagement);
}

/**
 * Calculate engagement score (0-100) from analytics data
 */
function calculateEngagementScore(analytics) {
  const { views, likes, comments, shares } = analytics;
  
  if (views === 0) return 0;

  // Weighted engagement: likes (1x), comments (2x), shares (3x)
  const engagementPoints = likes + (comments * 2) + (shares * 3);
  const rate = (engagementPoints / views) * 100;

  // Normalize to 0-100 scale (cap at 20% engagement rate = 100 score)
  return Math.min(Math.round(rate * 5), 100);
}

/**
 * Use Groq AI to analyze posting patterns and provide insights
 */
async function analyzeWithAI(timeSlotData, platform) {
  const systemPrompt = `You are a social media analytics expert. Analyze posting time data and provide insights.

Rules:
- Identify the top 3-5 time slots with best engagement
- Consider sample size (need at least 3 posts per slot)
- Look for patterns (e.g., weekday vs weekend, morning vs evening)
- Provide actionable insights

Return ONLY JSON (no markdown):
{
  "topTimes": [
    {"day": 0-6, "hour": 0-23, "score": 0-100, "reasoning": "why this time works"}
  ],
  "insights": [
    "Insight 1: Your audience is most active on weekday evenings",
    "Insight 2: Weekend mornings show lower engagement"
  ],
  "recommendations": "Overall posting strategy recommendation"
}`;

  // Format data for AI
  const topSlots = timeSlotData
    .filter(slot => slot.sample_size >= 3)
    .slice(0, 10)
    .map(slot => ({
      day_of_week: getDayName(slot.day_of_week),
      hour: `${slot.hour_of_day}:00`,
      engagement_score: Math.round(slot.avg_engagement),
      sample_size: slot.sample_size,
    }));

  const prompt = `Analyze this ${platform} posting data:

${JSON.stringify(topSlots, null, 2)}

Identify the best posting times and provide insights.`;

  try {
    const response = await generateText({
      prompt,
      systemPrompt,
      maxTokens: 600,
      provider: 'groq', // Use Groq for speed
    });

    const cleanResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const analysis = JSON.parse(cleanResponse);

    // Validate and normalize scores
    analysis.topTimes = analysis.topTimes.map(time => ({
      ...time,
      day: typeof time.day === 'string' ? parseDayName(time.day) : time.day,
      score: Math.min(Math.max(time.score || 0, 0), 100),
    }));

    return analysis;

  } catch (error) {
    console.error('AI analysis failed, using fallback:', error);

    // Fallback: return top slots without AI insights
    return {
      topTimes: topSlots.slice(0, 5).map(slot => ({
        day: parseDayName(slot.day_of_week),
        hour: parseInt(slot.hour.split(':')[0]),
        score: slot.engagement_score,
        reasoning: `${slot.sample_size} posts with ${slot.engagement_score}% avg engagement`,
      })),
      insights: ['Analysis completed without AI'],
      recommendations: 'Post during high-engagement time slots',
    };
  }
}

/**
 * Save optimal times to database
 */
async function saveOptimalTimes(userId, platform, analysis) {
  const records = analysis.topTimes.map(time => ({
    user_id: userId,
    platform,
    day_of_week: time.day,
    hour_of_day: time.hour,
    score: time.score,
    sample_size: 0, // Will be updated by trigger
    last_analyzed_at: new Date().toISOString(),
  }));

  // Upsert records
  const { error } = await supabase
    .from('optimal_posting_times')
    .upsert(records, {
      onConflict: 'user_id,platform,day_of_week,hour_of_day',
    });

  if (error) throw error;

  return true;
}

/**
 * Get default best posting times per platform
 * Used when no user data is available
 */
function getDefaultBestTime(platform, targetDate) {
  const defaultTimes = {
    'instagram': {
      hours: [11, 14, 19], // 11 AM, 2 PM, 7 PM
      reasoning: 'Industry average: Instagram users are most active during lunch and evening hours',
    },
    'tiktok': {
      hours: [15, 18, 21], // 3 PM, 6 PM, 9 PM
      reasoning: 'Industry average: TikTok peaks after school/work hours',
    },
    'youtube': {
      hours: [14, 17, 20], // 2 PM, 5 PM, 8 PM
      reasoning: 'Industry average: YouTube viewing peaks in afternoon and evening',
    },
    'facebook': {
      hours: [13, 15, 19], // 1 PM, 3 PM, 7 PM
      reasoning: 'Industry average: Facebook users check during breaks and after work',
    },
  };

  const platformDefaults = defaultTimes[platform] || defaultTimes['instagram'];
  const bestHour = platformDefaults.hours[0];
  
  const recommendedTime = new Date(targetDate);
  recommendedTime.setHours(bestHour, 0, 0, 0);

  return {
    time: recommendedTime,
    score: 70, // Default confidence
    reasoning: platformDefaults.reasoning,
    alternatives: platformDefaults.hours.slice(1).map(hour => ({
      hour,
      score: 65,
    })),
    isDefault: true,
  };
}

/**
 * Helper: Convert day number to name
 */
function getDayName(day) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[day];
}

/**
 * Helper: Convert day name to number
 */
function parseDayName(dayName) {
  if (typeof dayName === 'number') return dayName;
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return names.indexOf(dayName.toLowerCase());
}

// ============================================================================
// TREND ANALYSIS
// ============================================================================

/**
 * Fetch and analyze trending topics for ghost slot suggestions
 * Uses Groq to analyze current trends per platform
 * 
 * @param {string} platform - Platform name
 * @returns {Promise<Array>} Array of trending topics
 */
export async function analyzeTrendingTopics(platform) {
  const systemPrompt = `You are a social media trends analyst. Identify current trending topics for ${platform}.

Consider:
- Current events and viral topics
- Seasonal trends
- Platform-specific content styles
- Audience interests

Return ONLY JSON (no markdown):
{
  "trends": [
    {
      "topic": "Topic name",
      "category": "Entertainment|Tech|Lifestyle|etc",
      "score": 0-100,
      "keywords": ["keyword1", "keyword2"],
      "reasoning": "Why this is trending"
    }
  ]
}`;

  const prompt = `What are the top 5 trending topics on ${platform} right now? Current date: ${new Date().toLocaleDateString()}`;

  try {
    const response = await generateText({
      prompt,
      systemPrompt,
      maxTokens: 500,
      provider: 'groq',
    });

    const cleanResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const { trends } = JSON.parse(cleanResponse);

    // Save to database
    const records = trends.map(trend => ({
      platform,
      topic: trend.topic,
      category: trend.category,
      trend_score: trend.score,
      keywords: trend.keywords,
      source: 'groq_analysis',
      valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    }));

    await supabase.from('trending_topics').upsert(records);

    return trends;

  } catch (error) {
    console.error('Failed to analyze trends:', error);
    return [];
  }
}

// ============================================================================
// EXPORT FOR EDGE FUNCTIONS
// ============================================================================

export default {
  analyzeOptimalTimes,
  getRecommendedTime,
  analyzeAllPlatforms,
  analyzeTrendingTopics,
};