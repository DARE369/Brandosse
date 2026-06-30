import { OrgAdminRoute } from "@/utils/protectedRoute";
import PipelineConfigPage from "@/org/admin/PipelineConfigPage";

export const metadata = { title: "Organization Pipelines | Brandosse" };

export default function OrgPipelinesRoute() {
  return (
    <OrgAdminRoute>
      <PipelineConfigPage />
    </OrgAdminRoute>
  );
}