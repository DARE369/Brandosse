/**
 * mockAnalytics.js
 * Pre-aggregated mock data for AdminAnalyticsPage.
 * Replace with Supabase Edge Function results later.
 */

export const mockKpis = {
  activeAiUsers: { value: 1245, deltaPercent: 12, series: [20, 25, 22, 30, 35, 40] },
  costPerPost: { value: 0.12, deltaPercent: -3, series: [0.15,0.14,0.13,0.12,0.12,0.12] },
  apiFailureRate: { value: 0.8, deltaPercent: 0.2, series: [0.5,0.6,0.7,0.8,0.9,0.8] },
  rejectionRate: { value: 4.0, deltaPercent: -1.0, series: [5,4.8,4.5,4.3,4,4] }
};

// Generations over time (daily for last 14 days)
export const mockGenerationsOverTime = [
  { date: "2025-10-30", count: 120 },
  { date: "2025-10-31", count: 130 },
  { date: "2025-11-01", count: 125 },
  { date: "2025-11-02", count: 160 },
  { date: "2025-11-03", count: 180 },
  { date: "2025-11-04", count: 210 },
  { date: "2025-11-05", count: 190 },
  { date: "2025-11-06", count: 220 },
  { date: "2025-11-07", count: 240 },
  { date: "2025-11-08", count: 260 },
  { date: "2025-11-09", count: 250 },
  { date: "2025-11-10", count: 270 },
  { date: "2025-11-11", count: 290 },
  { date: "2025-11-12", count: 310 }
];

// Platform distribution (part-to-whole)
export const mockPlatformDistribution = [
  { platform: "Instagram", count: 420 },
  { platform: "TikTok", count: 310 },
  { platform: "YouTube", count: 150 },
  { platform: "Facebook", count: 120 }
];

// Example breakdown per-user-platform (simplified)
export const mockUserPlatformStats = [
  { user: "Dare", platform: "Instagram", generated: 120, cost: 14.4 },
  { user: "Daniela", platform: "TikTok", generated: 90, cost: 10.8 },
  { user: "John", platform: "YouTube", generated: 50, cost: 6.0 },
];
