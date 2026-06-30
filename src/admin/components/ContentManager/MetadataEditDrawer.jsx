// src/components/ContentManager/MetadataEditDrawer.jsx
import React, { useState } from "react";
export default function MetadataEditDrawer({ post, visible, onClose, onSave }) {
  const [caption, setCaption] = useState(post?.snippet || "");
  const [scheduledAt, setScheduledAt] = useState(post?.scheduled_at || "");

  if (!visible) return null;

  const handleSave = () => {
    onSave({ ...post, snippet: caption, scheduled_at: scheduledAt });
    onClose();
  };

  return (
    <div className="metadata-drawer">
      <div className="drawer-header">
        <h4>Edit Metadata</h4>
        <button onClick={onClose}>X</button>
      </div>
      <div className="drawer-content">
        <label>
          Caption:
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <label>
          Scheduled At:
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </label>
      </div>
      <div className="drawer-actions">
        <button onClick={handleSave}>Save</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
