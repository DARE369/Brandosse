import React from "react";
export default function KpiCard({ title, value, trend, trendUp, color, onClick = null, className = "" }) {
  const isChart = Array.isArray(trend);
  const cardClassName = [
    "admin-kpi-card",
    onClick ? "clickable" : "",
    className,
  ].filter(Boolean).join(" ");

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      className={cardClassName}
      style={{ "--admin-kpi-accent": color || "#6366f1" }}
      onClick={onClick || undefined}
    >
      <div className="admin-kpi-card-header">
        <span className="admin-kpi-card-title">{title}</span>

        {!isChart && trend ? (
          <span className={`admin-kpi-badge ${trendUp ? "positive" : "negative"}`}>
            {trend}
          </span>
        ) : null}
      </div>

      <div className="admin-kpi-card-body">
        <h3 className="admin-kpi-card-value">{value}</h3>

        {isChart ? (
          <div className="admin-kpi-sparkline">
            <SparkLine data={trend} color={color} />
          </div>
        ) : null}
      </div>
    </Wrapper>
  );
}

function SparkLine({ data, color }) {
  if (!Array.isArray(data) || data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 100 - ((value - min) / range) * 100;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "40px" }}>
      <polyline points={points} fill="none" stroke={color || "#888"} strokeWidth="2" />
    </svg>
  );
}
