/**
 * @file SocialMediaTile.jsx
 * @description Displays a connected social media platform with key metrics and API status.
 */

import React from "react";
export default function SocialMediaTile(props) {
  const account = props.account || {
    platform: props.platform,
    followers_count: props.followers_count,
    engagement_rate: props.engagement_rate,
    api_status: props.api_status || (props.status === "connected" ? "green" : "yellow"),
  };

  const statusTone = ["green", "yellow", "red"].includes(account.api_status)
    ? account.api_status
    : "neutral";

  return (
    <div className="social-media-tile">
      <h4>{account.platform}</h4>
      <p>Followers: {account.followers_count || 0}</p>
      <p>Engagement: {account.engagement_rate || 0}%</p>
      <span
        className={`api-status-dot api-status-dot-${statusTone}`}
        aria-label={`API status: ${account.api_status || "unknown"}`}
      />
    </div>
  );
}

