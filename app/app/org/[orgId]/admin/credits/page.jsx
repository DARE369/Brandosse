import { OrgAdminRoute } from "@/utils/protectedRoute";
import CreditManagementPage from "@/org/admin/CreditManagementPage";

export const metadata = { title: "Organization Credits | Brandosse" };

export default function OrgCreditsRoute() {
  return (
    <OrgAdminRoute>
      <CreditManagementPage />
    </OrgAdminRoute>
  );
}