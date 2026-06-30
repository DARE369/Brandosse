import React from "react";
import { Search, User, Video, Image as ImageIcon, Layers, Calendar } from "lucide-react";
import { POST_STATUS } from "../../../constants/statuses";

export default function FilterBar({ filters, setFilters, uniqueUsers }) {
  const handleChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="filter-bar-container">
      {/* Search */}
      <div className="filter-group search-group">
        <Search className="filter-icon" size={16} />
        <input 
          type="text" 
          placeholder="Search prompts or captions..." 
          value={filters.search}
          onChange={(e) => handleChange("search", e.target.value)}
          className="filter-input"
        />
      </div>

      {/* User Select */}
      <div className="filter-group">
        <User className="filter-icon" size={16} />
        <select 
          value={filters.user} 
          onChange={(e) => handleChange("user", e.target.value)}
          className="filter-select"
        >
          <option value="all">All Users</option>
          {uniqueUsers.map(u => (
            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
          ))}
        </select>
      </div>

      {/* Media Type */}
      <div className="filter-group">
        {filters.type === 'video' ? <Video size={16} className="filter-icon"/> : <ImageIcon size={16} className="filter-icon"/>}
        <select 
          value={filters.type} 
          onChange={(e) => handleChange("type", e.target.value)}
          className="filter-select"
        >
          <option value="all">All Media</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </select>
      </div>

      {/* Status */}
      <div className="filter-group">
        <Layers className="filter-icon" size={16} />
        <select 
          value={filters.status} 
          onChange={(e) => handleChange("status", e.target.value)}
          className="filter-select"
        >
          <option value="all">All Status</option>
          <option value={POST_STATUS.DRAFT}>Drafts</option>
          <option value={POST_STATUS.SCHEDULED}>Scheduled</option>
          <option value={POST_STATUS.PUBLISHED}>Published</option>
        </select>
      </div>

      {/* Date Range */}
      <div className="filter-group">
        <Calendar className="filter-icon" size={16} />
        <select 
          value={filters.dateRange} 
          onChange={(e) => handleChange("dateRange", e.target.value)}
          className="filter-select"
        >
          <option value="all">All Time</option>
          <option value="7days">Last 7 Days</option>
          <option value="30days">Last 30 Days</option>
        </select>
      </div>
    </div>
  );
}
