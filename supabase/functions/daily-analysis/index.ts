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
import { requireInvokeSecret } from '../_shared/connectionHelpers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── LOCK L1.7 — service-role only ──────────────────────────────────────────
  //
  // This function had NO auth guard. Supabase accepts any valid project JWT by
  // default, including the anon key — which ships in the client bundle and is
  // public. Verified live 2026-08-21: a POST carrying only the public anon key
  // returned HTTP 200 and disclosed all 12 active user IDs in the response.
  //
  // Two problems, both closed here:
  //   1. Enumeration — user UUIDs are the lookup key for other endpoints, so
  //      handing out the full list is useful material for a follow-on attack.
  //   2. Unauthenticated resource abuse — every call iterates each active
  //      profile with several queries, with no rate limit behind it.
  //
  // This is a scheduled batch job with no legitimate caller other than cron, so
  // the correct audience is machine callers only.
  //
  // The matching cron registration is 20260910120000, which sends
  // X-Invoke-Secret from Vault. Apply that migration BEFORE deploying, or the
  // nightly run will 401 in the gap.
  // Machine callers present FUNCTION_INVOKE_SECRET in the X-Invoke-Secret header.
  // This used to compare Authorization against SUPABASE_SERVICE_ROLE_KEY, which
  // the runtime no longer holds — the project has Supabase's new API key system,
  // so the runtime is injected with an `sb_secret_…` value while Vault still sent
  // the legacy JWT. Every nightly run 401'd in silence.
  try {
    requireInvokeSecret(req)
  } catch (err) {
    const message = (err as Error).message
    // A misconfigured deployment is OUR fault and must not read as a rejected
    // caller. Collapsing the two is what kept this invisible for so long.
    const misconfigured = message === 'function_invoke_secret_not_configured'
    return new Response(
      JSON.stringify({ error: misconfigured ? 'Server misconfigured' : 'Unauthorized' }),
      { status: misconfigured ? 500 : 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
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

/**
 * DISABLED 2026-08-21 — LOCK L1.3 (Completion Lockdown, Wave 1).
 *
 * This function used to write two hardcoded topic strings — "AI Tools" and
 * "Content Creation Tips" — across four platforms, every single day. It had
 * been doing so since roughly 2026-03-24: ~1,200 rows in `trending_topics`,
 * containing exactly two distinct topics in total.
 *
 * That is fabricated market data presented through a table named
 * `trending_topics`. Nothing downstream currently reads it (verified: no UI
 * consumer exists), so no user has been shown it — but it was one wiring
 * change away from presenting invented trends as real market insight, which is
 * a trust problem rather than merely a quality one.
 *
 * It also ran completely unmonitored for ~5 months, because
 * `get_cron_job_status()` filters `cron.job` through a hardcoded three-name
 * allowlist that does not include this job (see LOCK L0.3).
 *
 * WHY THIS IS NOT REPLACED WITH REAL TREND INGESTION HERE:
 * real trend data requires a new third-party integration, which the Completion
 * Lock defers until lockdown lifts (see audit/11-lockdown-plan.md). The correct
 * interim behaviour is to write nothing and say so loudly, rather than to keep
 * fabricating. An empty table is honest; a table of invented trends is not.
 *
 * TO RE-ENABLE: implement a real trend source, then delete this guard. Do not
 * simply restore the previous body.
 */
async function updateTrendingTopics(_supabase) {
  console.warn(
    '[daily-analysis] trending-topics update SKIPPED — the previous implementation ' +
    'fabricated data (2 hardcoded topics x 4 platforms, daily). Disabled under ' +
    'LOCK L1.3. Real trend ingestion is deferred until the completion lockdown lifts. ' +
    'See audit/11-lockdown-plan.md.'
  )

  return { skipped: true, reason: 'fabricated-data-writer-disabled-L1.3' }
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