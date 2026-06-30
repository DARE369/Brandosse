// src/admin/mocks/mockStats.js
export const mockStats = {
  cpp: 0.12, // cost per post
  activeAiUsersPct: 8.5,
  promptsPerActiveSeat: 12,
  apiFailureRatePct: 1.4,
  generationVolume: [
    { date: "2025-10-01", count: 120 },
    { date: "2025-10-02", count: 160 }
    // ...
  ],
  platformDistribution: {
    instagram: 46,
    tiktok: 30,
    youtube: 14,
    facebook: 10
  }
};
