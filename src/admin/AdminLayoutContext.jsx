"use client";

import React, { createContext, useContext } from "react";

const AdminLayoutContext = createContext({});

export function AdminLayoutProvider({ children, value }) {
  return (
    <AdminLayoutContext.Provider value={value || {}}>
      {children}
    </AdminLayoutContext.Provider>
  );
}

export function useAdminLayoutContext() {
  return useContext(AdminLayoutContext) || {};
}
