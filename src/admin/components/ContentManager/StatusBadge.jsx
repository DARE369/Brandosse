// src/components/ContentManager/StatusBadge.jsx
import React from "react";
export default function StatusBadge({ status }) {
  const colorMap = {
    draft: "yellow",
    scheduled: "blue",
    published: "green",
    failed: "red",
    suspended: "gray",
  };

  return <span className={`status-badge ${colorMap[status] || "gray"}`}>{status}</span>;
}
