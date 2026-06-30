import { OrgAdminRoute } from "@/utils/protectedRoute";
import RolesPage from "@/org/admin/RolesPage";

export const metadata = { title: "Organization Roles | Brandosse" };

export default function OrgRolesRoute() {
  return (
    <OrgAdminRoute>
      <RolesPage />
    </OrgAdminRoute>
  );
}