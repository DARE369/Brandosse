// src/components/Generate/IntentClarificationPanel.jsx
import React, { useState } from 'react';

const GOAL_OPTIONS = [
  { value: 'product_promotion',   label: 'Sell a product or service' },
  { value: 'brand_awareness',     label: 'Build brand awareness' },
  { value: 'education',           label: 'Educate or inform' },
  { value: 'entertainment',       label: 'Just for fun / entertainment' },
];

const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok',    label: 'TikTok' },
  { value: 'linkedin',  label: 'LinkedIn' },
  { value: 'x',         label: 'X' },
  { value: 'youtube',   label: 'YouTube' },
  { value: 'all',       label: 'All equally' },
];

/**
 * Shows 1–2 clarifying questions when intent is ambiguous.
 *
 * Props:
 *   questions: string[]       — e.g. ['content_goal', 'primary_platform']
 *   onSubmit: (answers) => void
 *   onSkip: () => void
 */
export default function IntentClarificationPanel({ questions = [], onSubmit, onSkip }) {
  const [answers, setAnswers] = useState({});

  const setAnswer = (key, value) => setAnswers(a => ({ ...a, [key]: value }));

  const handleSubmit = () => onSubmit(answers);

  return (
    <div className="intent-clarification-panel" role="region" aria-label="Clarification questions">
      <div className="icp-header">
        <span className="icp-icon">🤔</span>
        <span>Quick question before I generate…</span>
      </div>

      <div className="icp-questions">
        {questions.includes('content_goal') && (
          <fieldset>
            <legend>What's the main goal of this post?</legend>
            {GOAL_OPTIONS.map(opt => (
              <label key={opt.value} className="icp-option">
                <input
                  type="radio"
                  name="content_goal"
                  value={opt.value}
                  checked={answers.content_goal === opt.value}
                  onChange={() => setAnswer('content_goal', opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </fieldset>
        )}

        {questions.includes('primary_platform') && (
          <fieldset>
            <legend>Which platform is the priority?</legend>
            <div className="icp-platform-grid">
              {PLATFORM_OPTIONS.map(opt => (
                <label key={opt.value} className="icp-option">
                  <input
                    type="radio"
                    name="primary_platform"
                    value={opt.value}
                    checked={answers.primary_platform === opt.value}
                    onChange={() => setAnswer('primary_platform', opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      <div className="icp-actions">
        <button className="bk-btn-primary" onClick={handleSubmit}>
          Generate with context
        </button>
        <button className="bk-btn-secondary" onClick={onSkip}>
          Generate anyway (let AI infer)
        </button>
      </div>
    </div>
  );
}
