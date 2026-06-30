// src/components/User/TrendsPanel.jsx
import React from "react";

export default function TrendsPanel() {
  return (
    <div className="trends-panel">
      <div className="trend-item">
        <div className="trend-placeholder"></div>
        <div className="trend-info">
          <h4>Post Engagement</h4>
          <p>Engagement has increased by 12% over the past week.</p>
        </div>
      </div>

      <div className="trend-item">
        <div className="trend-placeholder"></div>
        <div className="trend-info">
          <h4>Top Performing Content</h4>
          <p>Your Reels have the highest reach this month.</p>
        </div>
      </div>
    </div>
  );
}
