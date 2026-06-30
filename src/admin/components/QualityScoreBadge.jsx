import React from "react";

function getScoreBand(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return { tone: "neutral", label: "Not Scored", value: "-" };
  }

  const numericScore = Math.round(Number(score));
  if (numericScore >= 85) return { tone: "success", label: "Ready", value: numericScore };
  if (numericScore >= 70) return { tone: "positive", label: "Minor Review", value: numericScore };
  if (numericScore >= 50) return { tone: "warning", label: "Needs Revision", value: numericScore };
  return { tone: "danger", label: "Regenerate", value: numericScore };
}

export default function QualityScoreBadge({ score, size = "md", showLabel = true }) {
  const band = getScoreBand(score);

  return (
    <span className={`admin-score-badge admin-score-badge-${band.tone} admin-score-badge-${size}`}>
      <strong>{band.value}</strong>
      {showLabel ? <span>{band.label}</span> : null}
    </span>
  );
}
