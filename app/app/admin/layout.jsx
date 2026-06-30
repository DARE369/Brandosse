// Admin-only stylesheets — scoped to the /app/admin subtree so they are not
// shipped to personal/org users (and so admin's `.sidebar-nav` rule can't leak).
import "@/admin/styles/admin-entry.css";
import AdminRouteShell from "@/next/AdminRouteShell";

export default function AdminLayout({ children }) {
  return <AdminRouteShell>{children}</AdminRouteShell>;
}