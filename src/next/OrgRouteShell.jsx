"use client";

import React from "react";
import OrgWorkspaceShell from "../layouts/OrgWorkspaceShell";
import { OrgContextProvider } from "../org/context/OrgContextProvider";
import { OrgMemberRoute } from "../utils/protectedRoute";

export default function OrgRouteShell({ children, orgId }) {
  return (
    <OrgContextProvider orgId={orgId}>
      <OrgMemberRoute>
        <OrgWorkspaceShell>{children}</OrgWorkspaceShell>
      </OrgMemberRoute>
    </OrgContextProvider>
  );
}
