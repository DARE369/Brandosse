import AdminComplaintDetailPage from "@/admin/pages/AdminComplaintDetailPage";

export const metadata = { title: "Admin Complaint | Brandosse" };

export default async function AdminComplaintDetailRoute({ params }) {
  const { complaintId } = await params;
  return <AdminComplaintDetailPage complaintId={complaintId} />;
}