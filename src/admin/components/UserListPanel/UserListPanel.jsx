import React, { useState } from "react";
import UserListRow from "./UserListRow";
import { Search } from "lucide-react";
export default function UserListPanel({ users, selectedUser, onSelectUser, loading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredUsers = users.filter(u => 
    (u.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      <div className="user-list-header">
        <h2 className="text-lg font-bold text-white mb-4">Users</h2>
        <div className="search-container">
          <Search className="search-icon" size={16} />
          <input
            type="text"
            placeholder="Search users..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="user-list-content custom-scrollbar">
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No users found.</div>
        ) : (
          filteredUsers.map((user) => (
            <UserListRow
              key={user.id}
              user={user}
              isSelected={selectedUser?.id === user.id}
              onClick={() => onSelectUser(user)}
            />
          ))
        )}
      </div>
    </>
  );
}