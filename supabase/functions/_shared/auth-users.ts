import type { DatabaseClient } from "./supabase.ts";

export type AuthUserSummary = {
  id: string;
  email?: string | null;
};

export function inferNameFromEmail(email: string | null | undefined) {
  return String(email || "").split("@")[0] || "New User";
}

export async function findAuthUserByEmail(
  adminClient: DatabaseClient,
  email: string | null | undefined,
) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const perPage = 1000;

  for (let page = 1; page <= 20; page += 1) {
    const usersResult = await adminClient.auth.admin.listUsers({ page, perPage });
    if (usersResult.error) throw usersResult.error;

    const users = usersResult.data?.users || [];
    const match = users.find((entry) => entry.email?.toLowerCase() === normalizedEmail) || null;
    if (match) {
      return match as AuthUserSummary;
    }

    if (users.length < perPage) {
      break;
    }
  }

  return null;
}
