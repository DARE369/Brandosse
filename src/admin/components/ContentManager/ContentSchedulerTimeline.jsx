// src/components/ContentManager/ContentSchedulerTimeline.jsx
import React, { useState, useEffect } from "react";
export default function ContentSchedulerTimeline({ user, filters }) {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    // Mock posts for timeline
    const mockPosts = [
      {
        id: "1",
        platform: "instagram",
        snippet: "New post about React",
        status: "draft",
        scheduled_at: new Date("2025-11-15T14:00"),
      },
      {
        id: "2",
        platform: "tiktok",
        snippet: "Funny dance video",
        status: "scheduled",
        scheduled_at: new Date("2025-11-16T10:00"),
      },
      {
        id: "3",
        platform: "youtube",
        snippet: "Tutorial: Building a dashboard",
        status: "published",
        scheduled_at: new Date("2025-11-14T09:00"),
      },
    ];
    setPosts(mockPosts);
  }, [filters]);

  const statusColor = (status) => {
    switch (status) {
      case "draft":
        return "yellow";
      case "scheduled":
        return "blue";
      case "published":
        return "green";
      case "failed":
        return "red";
      default:
        return "gray";
    }
  };

  return (
    <div className="content-timeline">
      {posts.map((post) => (
        <div
          key={post.id}
          className={`timeline-block ${statusColor(post.status)}`}
          title={`${post.platform}: ${post.snippet}`}
        >
          <strong>{post.platform}</strong>
          <span>{post.snippet}</span>
          <span className="scheduled-time">
            {post.scheduled_at.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
