// src/components/ContentManager/ContentFilterBar.jsx
import React, { useState, useEffect } from "react";

export default function ContentFilterBar({ filters, onFilterChange }) {
  const [localFilters, setLocalFilters] = useState(filters);

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const updated = { ...localFilters, [name]: value };
    setLocalFilters(updated);
    onFilterChange(updated);
  };

  return (
    <div className="content-filter-bar">
      <input
        type="text"
        name="search"
        placeholder="Search content..."
        value={localFilters.search}
        onChange={handleInputChange}
      />
      <select
        name="platforms"
        value={localFilters.platforms}
        onChange={handleInputChange}
      >
        <option value="">All Platforms</option>
        <option value="instagram">Instagram</option>
        <option value="tiktok">TikTok</option>
        <option value="facebook">Facebook</option>
        <option value="youtube">YouTube</option>
      </select>
      <select
        name="status"
        value={localFilters.status}
        onChange={handleInputChange}
      >
        <option value="">All Statuses</option>
        <option value="draft">Draft</option>
        <option value="scheduled">Scheduled</option>
        <option value="published">Published</option>
        <option value="failed">Failed</option>
      </select>
      <input
        type="date"
        name="dateRange"
        value={localFilters.dateRange || ""}
        onChange={handleInputChange}
      />
    </div>
  );
}
