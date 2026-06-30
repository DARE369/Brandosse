/**
 * mockAnalyticsExtended.js
 * Extended mock analytics used by AdminAnalyticsPage.
 * - per-platform time series for cost
 * - per-user platform breakdown with many rows (for pagination)
 * - daily generations for 90 days
 */

const today = new Date("2025-11-12"); // fix date for reproducibility

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// generate last N days
function generateDays(n) {
  const arr = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    arr.push(formatDate(d));
  }
  return arr;
}

const days90 = generateDays(90);

// mock generations for 90 days (random-ish but smooth)
const mockGenerations90 = days90.map((date, i) => ({
  date,
  count: Math.round(100 + Math.sin(i / 6) * 40 + i * 0.5 + (Math.random() * 30 - 15)),
}));

// per-platform cost-over-time (stacked area input)
const platforms = ["Instagram", "TikTok", "YouTube", "Facebook"];
const mockCostPerPlatformOverTime = days90.map((date, i) => {
  // stable baseline per platform
  const ig = +(5 + Math.sin(i / 8) * 2 + Math.random() * 1.2).toFixed(2);
  const tt = +(3.5 + Math.cos(i / 11) * 1.5 + Math.random() * 1).toFixed(2);
  const yt = +(2 + Math.sin(i / 10) * 1 + Math.random() * 0.6).toFixed(2);
  const fb = +(1.5 + Math.cos(i / 13) * 0.8 + Math.random() * 0.5).toFixed(2);
  return { date, Instagram: ig, TikTok: tt, YouTube: yt, Facebook: fb };
});

// user-platform rows (generate 200 rows to test pagination)
const mockUserPlatformRows = Array.from({ length: 200 }, (_, idx) => {
  const user = `user_${String(idx + 1).padStart(3, "0")}`;
  const platform = platforms[idx % platforms.length];
  const generated = Math.floor(Math.random() * 300);
  const cost = +(generated * (0.03 + (idx % 5) * 0.01)).toFixed(2);
  const team = ["Growth", "Marketing", "Ops", "Support"][idx % 4];
  const segment = ["Free", "Pro", "Enterprise"][idx % 3];
  return { id: idx + 1, user, platform, generated, cost, team, segment, lastActive: days90[(idx * 7) % days90.length] };
});

// KPIs (aggregate)
const mockKpisExtended = {
  activeAiUsers: { value: 1245, deltaPercent: 12, series: [20, 25, 22, 30, 35, 40] },
  costPerPost: { value: 0.12, deltaPercent: -3, series: [0.15, 0.14, 0.13, 0.12, 0.12, 0.12] },
  apiFailureRate: { value: 0.8, deltaPercent: 0.2, series: [0.5, 0.6, 0.7, 0.8, 0.9, 0.8] },
  rejectionRate: { value: 4.0, deltaPercent: -1.0, series: [5, 4.8, 4.5, 4.3, 4, 4] },
};

export {
  mockGenerations90,
  mockCostPerPlatformOverTime,
  mockUserPlatformRows,
  mockKpisExtended,
  platforms,
  days90,
};
