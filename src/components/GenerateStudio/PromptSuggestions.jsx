import React from 'react';
import { PROMPT_SUGGESTIONS } from './shared/constants';

/* ─────────────────────────────────────────────────────────────────────────────
   PromptSuggestions — clickable inspiration prompts
   ───────────────────────────────────────────────────────────────────────────── */
export default function PromptSuggestions({ mode, onSelect }) {
  const list = PROMPT_SUGGESTIONS[mode] || PROMPT_SUGGESTIONS.image;
  return (
    <div className="studio-suggestions">
      <span className="studio-suggestions__label">Try a starting point</span>
      <div className="studio-suggestions__list">
        {list.map((s, i) => (
          <button key={i} type="button" className="studio-suggestion-card" onClick={() => onSelect(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
