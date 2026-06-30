/**
 * @file UserListRow.jsx
 * @description Single row item for UserListPanel. Displays profile pic, name, email, and status.
 */

import React from "react";
export default function UserListRow({ user, isSelected, onClick }) {
  return (
    <button
      className={`user-list-row ${isSelected ? "selected" : ""}`}
      onClick={onClick}
      type="button"
      aria-pressed={isSelected}
      aria-label={`Open details for ${user.name}`}
    >
      <img src={user.avatar} alt={`${user.name} avatar`} className="user-avatar" />
      <div className="user-info">
        <p className="user-name">{user.name}</p>
        <p className="user-email">{user.email}</p>
      </div>
      <span className={`status-badge ${user.status.toLowerCase()}`}>
        {user.status}
      </span>
    </button>
  );
}
