import React from "react";

export default function AdminDashboard({ children }) {
  return (
    <div className="admin-dashboard">
      <main className="admin-main-content">
        {children}
      </main>
    </div>
  );
}
