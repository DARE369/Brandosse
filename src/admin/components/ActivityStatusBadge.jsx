import React from "react";

const STATUS_MAP = {
  highly_active: { label: "Highly Active", tone: "success" },
  active: { label: "Active", tone: "positive" },
  dormant: { label: "Dormant", tone: "warning" },
  inactive: { label: "Inactive", tone: "neutral" },
  suspended: { label: "Suspended", tone: "danger" },
  pending_deletion: { label: "Pending Deletion", tone: "warning" },
  deleted: { label: "Deleted", tone: "neutral" },
};

export default function ActivityStatusBadge({ status }) {
  const value = STATUS_MAP[status] || STATUS_MAP.inactive;

  return (
    <span className={`admin-pill admin-pill-${value.tone}`}>
      <span className="admin-pill-dot" aria-hidden="true" />
      {value.label}
    </span>
  );
}
