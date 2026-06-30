import { OrgAdminRoute } from "@/utils/protectedRoute";
import OrgSettingsPage from "@/org/admin/OrgSettingsPage";

export const metadata = { title: "Organization Settings | Brandosse" };

export default function OrgSettingsRoute() {
  return (
    <OrgAdminRoute>
      <OrgSettingsPage />
    </OrgAdminRoute>
  );
}