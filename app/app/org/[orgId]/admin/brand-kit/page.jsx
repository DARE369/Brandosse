import { OrgAdminRoute } from "@/utils/protectedRoute";
import OrgBrandKitPage from "@/org/admin/BrandKitPage";

export const metadata = { title: "Organization Brand Kit | Brandosse" };

export default function OrgBrandKitRoute() {
  return (
    <OrgAdminRoute>
      <OrgBrandKitPage />
    </OrgAdminRoute>
  );
}