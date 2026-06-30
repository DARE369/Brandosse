import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";
import { readEnv } from "./env.ts";

export type DatabaseClient = SupabaseClient;

export function createAuthClient(authHeader: string | null): DatabaseClient {
  if (!authHeader) {
    throw new Error("Unauthorized: missing Authorization header");
  }

  return createClient(
    readEnv("SUPABASE_URL"),
    readEnv("SUPABASE_ANON_KEY"),
    {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: {
        persistSession: false,
      },
    },
  );
}

export function createAdminClient(): DatabaseClient {
  return createClient(
    readEnv("SUPABASE_URL"),
    readEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
      },
    },
  );
}

export async function requireUser(authClient: DatabaseClient): Promise<User> {
  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) {
    throw new Error("Unauthorized");
  }
  return data.user;
}
