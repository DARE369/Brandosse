/**
 * mockService.js
 * Simulate server-side endpoints (paginated user/platform rows, aggregated queries)
 * Replace with real fetch calls to Supabase Edge Functions later.
 */

import { mockUserPlatformRows, mockGenerations90, mockCostPerPlatformOverTime, mockKpisExtended } from "../utils/mockAnalyticsExtended";

/**
 * Simulate network latency & return data in same shape as a paginated server:
 * { rows: [], total }
 */
export function fetchUserPlatformRows({ page = 1, pageSize = 20, filters = {} } = {}) {
  // shallow clone
  let rows = [...mockUserPlatformRows];

  // apply filters: platform, team, segment, user search
  if (filters.platform && filters.platform !== "All") {
    rows = rows.filter(r => r.platform === filters.platform);
  }
  if (filters.team && filters.team !== "All") {
    rows = rows.filter(r => r.team === filters.team);
  }
  if (filters.segment && filters.segment !== "All") {
    rows = rows.filter(r => r.segment === filters.segment);
  }
  if (filters.q) {
    const q = filters.q.toLowerCase();
    rows = rows.filter(r => r.user.toLowerCase().includes(q));
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageRows = rows.slice(start, end);

  return new Promise((resolve) => {
    setTimeout(() => resolve({ rows: pageRows, total }), 450 + Math.random() * 350);
  });
}

export function fetchGenerations({ days = 30 } = {}) {
  const slice = mockGenerations90.slice(-days);
  return Promise.resolve(slice);
}

export function fetchCostPerPlatform({ days = 30 } = {}) {
  const slice = mockCostPerPlatformOverTime.slice(-days);
  return Promise.resolve(slice);
}

export function fetchKpis() {
  return Promise.resolve(mockKpisExtended);
}


