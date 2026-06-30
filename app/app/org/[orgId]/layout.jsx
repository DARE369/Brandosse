// Org-only stylesheets — scoped to the /app/org subtree so they are not
// shipped to personal users.
import "@/styles/OrgWorkspace.css";
import "@/org/styles/AssetLibrary.css";
import "@/org/styles/BrandKit.css";
import "@/org/styles/CommonRoom.css";
import "@/org/styles/MyOffice.css";
import "@/org/styles/MyWorkspace.css";
import "@/org/styles/OrgAdmin.css";
import "@/org/styles/OrgCalendar.css";
import "@/org/styles/OrgDraftWorkflowModal.css";
import "@/org/styles/OrgGenerateComposer.css";
import "@/org/styles/Pipeline.css";
import "@/org/styles/PipelineBoard.css";
import OrgRouteShell from "@/next/OrgRouteShell";

export default async function OrgLayout({ children, params }) {
  const { orgId } = await params;
  return <OrgRouteShell orgId={orgId}>{children}</OrgRouteShell>;
}