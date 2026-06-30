import AdminUserDetailPage from "@/admin/pages/AdminUserDetailPage";

export const metadata = { title: "Admin User | Brandosse" };

export default async function AdminUserDetailRoute({ params }) {
  const { userId } = await params;
  return <AdminUserDetailPage userId={userId} />;
}