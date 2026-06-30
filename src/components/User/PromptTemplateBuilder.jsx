// src/components/User/PromptTemplateBuilder.jsx
import React, { useState } from "react";
export default function PromptTemplateBuilder() {
  const [platform, setPlatform] = useState("Twitter");
  const [tone, setTone] = useState("");
  const [keywords, setKeywords] = useState("");
  const [length, setLength] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log({ platform, tone, keywords, length });
    // later: send to AI generation
  };

  return (
    <div className="prompt-builder">
      <h3>Create Post Template</h3>
      <form onSubmit={handleSubmit}>
        <label>Platform</label>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option>Twitter</option>
          <option>Instagram</option>
          <option>LinkedIn</option>
          <option>Facebook</option>
        </select>

        <label>Tone</label>
        <input
          type="text"
          placeholder="E.g., friendly, professional"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        />

        <label>Keywords</label>
        <input
          type="text"
          placeholder="Comma separated"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />

        <label>Length</label>
        <input
          type="text"
          placeholder="Approximate word count"
          value={length}
          onChange={(e) => setLength(e.target.value)}
        />

        <button type="submit">Generate Template</button>
      </form>
    </div>
  );
}
