import { OrgAdminRoute } from "@/utils/protectedRoute";
import OrgOverview from "@/org/pages/OrgOverview";

export const metadata = { title: "Organization Overview | Brandosse" };

export default function OrgOverviewPage() {
  return (
    <OrgAdminRoute>
      <OrgOverview />
    </OrgAdminRoute>
  );
}