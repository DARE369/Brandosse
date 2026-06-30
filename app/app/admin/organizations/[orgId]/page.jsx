import AdminOrgDetailPage from "@/admin/pages/AdminOrgDetailPage";

export const metadata = { title: "Admin Organization | Brandosse" };

export default async function AdminOrganizationDetailRoute({ params }) {
  const { orgId } = await params;
  return <AdminOrgDetailPage orgId={orgId} />;
}