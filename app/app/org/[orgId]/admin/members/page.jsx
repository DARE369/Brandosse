import { OrgAdminRoute } from "@/utils/protectedRoute";
import MembersPage from "@/org/admin/MembersPage";

export const metadata = { title: "Organization Members | Brandosse" };

export default function OrgMembersRoute() {
  return (
    <OrgAdminRoute>
      <MembersPage />
    </OrgAdminRoute>
  );
}