import React from "react";

const RISK_META = {
  low: { label: "Low", className: "admin-risk-badge admin-risk-badge-low" },
  medium: { label: "Medium", className: "admin-risk-badge admin-risk-badge-medium" },
  high: { label: "High", className: "admin-risk-badge admin-risk-badge-high" },
  very_high: { label: "Very High", className: "admin-risk-badge admin-risk-badge-critical" },
  critical: { label: "Critical", className: "admin-risk-badge admin-risk-badge-critical" },
};

export default function AdminRiskBadge({ level }) {
  const key = String(level || "").trim().toLowerCase();
  if (!key || key === "none") return null;

  const meta = RISK_META[key];
  if (!meta) return null;

  return <span className={meta.className}>{meta.label}</span>;
}
