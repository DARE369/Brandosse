// ============================================================================
// SUPABASE EDGE FUNCTION: daily-analysis
// Path: supabase/functions/daily-analysis/index.ts
// 
// Triggered daily by pg_cron to:
// 1. Analyze optimal posting times for all users
// 2. Generate ghost slot suggestions
// 3. Update trending topics
// 
// Setup:
// 1. Create this file in your Supabase project
// 2. Deploy: supabase functions deploy daily-analysis
// 3. Schedule with pg_cron (see SQL below)
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Use service role for admin access
    )

    console.log('🚀 Starting daily analysis...')

    // 1. Get all active users
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select('id')
      .eq('status', 'active')

    if (usersError) throw usersError

    console.log(`📊 Analyzing ${users.length} users...`)

    const results = []

    // 2. For each user, analyze optimal times and generate ghost slots
    for (const user of users) {
      try {
        // Analyze optimal times for each platform
        const analysisResult = await analyzeUserOptimalTimes(supabase, user.id)
        
        // Generate ghost slots if enabled
        const ghostSlotsResult = await generateGhostSlotsForUser(supabase, user.id)

        results.push({
          userId: user.id,
          analysis: analysisResult,
          ghostSlots: ghostSlotsResult,
        })

      } catch (error) {
        console.error(`Failed for user ${user.id}:`, error)
        results.push({
          userId: user.id,
          error: error.message,
        })
      }
    }

    // 3. Update trending topics (once for all platforms)
    await updateTrendingTopics(supabase)

    console.log('✅ Daily analysis complete')

    return new Response(
      JSON.stringify({
        success: true,
        analyzed_users: results.length,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('❌ Daily analysis failed:', error)
    
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})

// ============================================================================
// OPTIMAL TIMES ANALYSIS
// ============================================================================

async function analyzeUserOptimalTimes(supabase, userId) {
  const platforms = ['instagram', 'tiktok', 'youtube', 'facebook']
  const results = []

  for (const platform of platforms) {
    try {
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
        .limit(100)

      if (error) throw error

      if (!posts || posts.length < 5) {
        console.log(`⏭️  Skipping ${platform} for user ${userId} (not enough data)`)
        continue
      }

      // 2. Filter for platform
      const platformPosts = posts.filter(p => 
        (p.connected_accounts?.platform === platform || p.platform === platform) &&
        p.platform_analytics?.length > 0
      )

      if (platformPosts.length < 5) continue

      // 3. Group by time slots
      const timeSlots = groupPostsByTimeSlot(platformPosts)

      // 4. Find top performing times
      const topTimes = timeSlots
        .filter(slot => slot.sample_size >= 3)
        .slice(0, 5)
        .map(slot => ({
          day_of_week: slot.day_of_week,
          hour_of_day: slot.hour_of_day,
          score: Math.round(slot.avg_engagement),
          sample_size: slot.sample_size,
        }))

      // 5. Save to database
      for (const time of topTimes) {
        await supabase
          .from('optimal_posting_times')
          .upsert({
            user_id: userId,
            platform,
            day_of_week: time.day_of_week,
            hour_of_day: time.hour_of_day,
            score: time.score,
            sample_size: time.sample_size,
            last_analyzed_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,platform,day_of_week,hour_of_day'
          })
      }

      results.push({ platform, topTimes: topTimes.length })

    } catch (error) {
      console.error(`Failed to analyze ${platform}:`, error)
    }
  }

  return results
}

function groupPostsByTimeSlot(posts) {
  const slots = {}

  posts.forEach(post => {
    const postDate = new Date(post.scheduled_at)
    const dayOfWeek = postDate.getDay()
    const hour = postDate.getHours()
    const key = `${dayOfWeek}-${hour}`

    if (!slots[key]) {
      slots[key] = {
        day_of_week: dayOfWeek,
        hour_of_day: hour,
        posts: [],
        total_engagement: 0,
        avg_engagement: 0,
      }
    }

    const analytics = post.platform_analytics[0]
    const engagement = calculateEngagementScore(analytics)

    slots[key].posts.push({ engagement })
    slots[key].total_engagement += engagement
  })

  Object.values(slots).forEach(slot => {
    slot.avg_engagement = slot.total_engagement / slot.posts.length
    slot.sample_size = slot.posts.length
  })

  return Object.values(slots).sort((a, b) => b.avg_engagement - a.avg_engagement)
}

function calculateEngagementScore(analytics) {
  const { views, likes, comments, shares } = analytics
  if (views === 0) return 0
  const engagementPoints = (likes || 0) + ((comments || 0) * 2) + ((shares || 0) * 3)
  const rate = (engagementPoints / views) * 100
  return Math.min(Math.round(rate * 5), 100)
}

// ============================================================================
// GHOST SLOTS GENERATION
// ============================================================================

async function generateGhostSlotsForUser(supabase, userId) {
  // 1. Check if ghost slots are enabled
  const { data: settings } = await supabase
    .from('calendar_settings')
    .select('ghost_slots_enabled, preferred_post_frequency')
    .eq('user_id', userId)
    .single()

  if (!settings?.ghost_slots_enabled) {
    console.log(`⏭️  Ghost slots disabled for user ${userId}`)
    return { created: 0 }
  }

  // 2. Get user's content pillars
  const { data: pillars } = await supabase
    .from('content_pillars')
    .select('*')
    .eq('user_id', userId)

  if (!pillars || pillars.length === 0) {
    console.log(`⚠️  No content pillars for user ${userId}`)
    return { created: 0 }
  }

  // 3. Get trending topics
  const { data: trends } = await supabase
    .from('trending_topics')
    .select('*')
    .gte('valid_until', new Date().toISOString())
    .limit(20)

  // 4. Get user's optimal times
  const { data: optimalTimes } = await supabase
    .from('optimal_posting_times')
    .select('*')
    .eq('user_id', userId)
    .gte('sample_size', 3)
    .order('score', { ascending: false })

  // 5. Generate suggestions for next 7 days
  const suggestions = []
  const postsPerWeek = settings.preferred_post_frequency || 7
  const daysToGenerate = 7

  for (let dayOffset = 1; dayOffset <= daysToGenerate; dayOffset++) {
    const targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + dayOffset)
    const dayOfWeek = targetDate.getDay()

    // Select a content pillar (rotate through them)
    const pillar = pillars[dayOffset % pillars.length]

    // Find best time for this day
    const dayOptimalTime = optimalTimes?.find(t => t.day_of_week === dayOfWeek)
    const suggestedHour = dayOptimalTime?.hour_of_day || 12

    targetDate.setHours(suggestedHour, 0, 0, 0)

    // Match trend to pillar keywords
    const matchedTrend = trends?.find(t => 
      pillar.keywords?.some(keyword => 
        t.keywords?.includes(keyword.toLowerCase())
      )
    )

    // Generate suggestion
    suggestions.push({
      user_id: userId,
      suggested_date: targetDate.toISOString(),
      platform: 'instagram', // Default, can be randomized
      content_pillar_id: pillar.id,
      suggested_topic: matchedTrend?.topic || pillar.name,
      suggested_prompt: generatePrompt(pillar, matchedTrend),
      reasoning: `Based on your "${pillar.name}" content strategy${matchedTrend ? ` and trending topic "${matchedTrend.topic}"` : ''}`,
      confidence_score: dayOptimalTime ? 85 : 70,
      status: 'suggested',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
  }

  // 6. Save suggestions (clear old ones first)
  await supabase
    .from('ghost_slots')
    .delete()
    .eq('user_id', userId)
    .eq('status', 'suggested')

  const { error } = await supabase
    .from('ghost_slots')
    .insert(suggestions)

  if (error) throw error

  return { created: suggestions.length }
}

function generatePrompt(pillar, trend) {
  if (trend) {
    return `Create ${pillar.name.toLowerCase()} content about "${trend.topic}"`
  }
  return `Create engaging ${pillar.name.toLowerCase()} content for your audience`
}

// ============================================================================
// TRENDING TOPICS UPDATE
// ============================================================================

async function updateTrendingTopics(supabase) {
  console.log('📈 Updating trending topics...')

  // In production, you'd call actual trend APIs here
  // For now, using mock data or Groq analysis

  const platforms = ['instagram', 'tiktok', 'youtube', 'facebook']
  
  for (const platform of platforms) {
    const mockTrends = [
      {
        platform,
        topic: 'AI Tools',
        category: 'Tech',
        trend_score: 95,
        keywords: ['ai', 'artificial intelligence', 'automation'],
        source: 'manual',
        valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        platform,
        topic: 'Content Creation Tips',
        category: 'Education',
        trend_score: 88,
        keywords: ['content', 'tips', 'tutorial', 'how to'],
        source: 'manual',
        valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    ]

    await supabase.from('trending_topics').upsert(mockTrends)
  }

  console.log('✅ Trending topics updated')
  return true
}

/* ============================================================================
   PG_CRON SETUP SQL
   Run this in Supabase SQL Editor to schedule daily analysis
   ============================================================================

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily analysis at 2 AM UTC
SELECT cron.schedule(
  'daily-calendar-analysis',
  '0 2 * * *', -- Every day at 2 AM
  $$
  SELECT net.http_post(
    url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-analysis',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);

-- View scheduled jobs
SELECT * FROM cron.job;

-- Unschedule (if needed)
-- SELECT cron.unschedule('daily-calendar-analysis');

============================================================================ */