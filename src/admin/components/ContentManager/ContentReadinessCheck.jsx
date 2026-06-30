// src/components/ContentManager/ContentReadinessCheck.jsx
import React from "react";
export default function ContentReadinessCheck({ post, onAction }) {
  const checklist = [
    {
      label: "Media Attached",
      ready: post.is_media_ready,
      action: () => onAction("uploadMedia"),
    },
    {
      label: "Caption Complete",
      ready: post.is_caption_complete,
      action: () => onAction("editCaption"),
    },
    {
      label: "AI Credits Reserved",
      ready: post.is_credits_reserved,
      action: () => onAction("topUpCredits"),
    },
    {
      label: "Compliance Tags",
      ready: post.platform_meta_json?.compliance ?? true,
      action: () => onAction("editTags"),
    },
  ];

  return (
    <div className="readiness-check">
      <h4>Readiness Checklist</h4>
      <ul>
        {checklist.map((item, idx) => (
          <li key={idx} className={item.ready ? "ready" : "pending"}>
            <span>{item.label}</span>
            {!item.ready && (
              <button onClick={item.action}>Resolve</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

