// src/components/User/KpiCard.jsx
import React from "react";

export default function KpiCard({ title, value, trend }) {
  return (
    <div className="kpi-card">
      <h4>{title}</h4>
      <h2>{value}</h2>
      <span className="trend">{trend}</span>
    </div>
  );
}
