// src/components/User/AIResultPreviewer.jsx
import React, { useState } from "react";
export default function AIResultPreviewer() {
  const [platform, setPlatform] = useState("Twitter");

  const tabs = ["Twitter", "Instagram", "LinkedIn"];

  return (
    <div className="ai-preview">
      <h3>AI Post Preview</h3>
      <div className="tab-buttons">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={platform === tab ? "active" : ""}
            onClick={() => setPlatform(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="preview-content">
        <div className="preview-placeholder">
          <p>Generated {platform} post will appear here...</p>
        </div>
      </div>
    </div>
  );
}
