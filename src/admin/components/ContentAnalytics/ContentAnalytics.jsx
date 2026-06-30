import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
export default function ContentAnalytics({ data }) {
  const chartData = data || [
    { platform: "Instagram", posts: 45 },
    { platform: "Facebook", posts: 30 },
    { platform: "YouTube", posts: 20 },
    { platform: "TikTok", posts: 55 },
  ];

  return (
    <div className="content-analytics">
      <h3>Content Analytics Overview</h3>
      <p className="analytics-description">
        View post distribution and engagement insights across connected platforms.
      </p>

      <div className="analytics-chart">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <XAxis dataKey="platform" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip />
            <Bar dataKey="posts" fill="#3b82f6" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="analytics-summary">
        {chartData.map((item) => (
          <div key={item.platform} className="summary-card">
            <h4>{item.platform}</h4>
            <p>{item.posts} posts</p>
          </div>
        ))}
      </div>
    </div>
  );
}
