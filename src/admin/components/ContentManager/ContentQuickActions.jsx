
// src/components/ContentManager/ContentQuickActions.jsx
import React from "react";
export default function ContentQuickActions({ post, onEdit, onForcePost, onViewLogs }) {
  return (
    <div className="content-quick-actions">
      <button onClick={() => onEdit(post)}>Edit</button>
      <button onClick={() => onForcePost(post)}>Force Post</button>
      <button onClick={() => onViewLogs(post)}>View Logs</button>
    </div>
  );
}
