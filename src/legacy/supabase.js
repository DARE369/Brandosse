// LEGACY - do not use for new code paths.
// Historical auth helper moved under src/legacy per roadmap XC-2.
import { supabase } from "../services/supabaseClient";

/**
 * Registers a new user, then creates profile & default settings rows.
 * Returns: { user, error } (error if any stage failed)
 */
export const registerUser = async ({ name, email, password, role = "user", adminKey = null }) => {
  try {
    // 1) Create auth user
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });

    if (signUpError) {
      return { user: null, error: signUpError };
    }

    // Try to get user id from signUpData or from auth.getUser
    let user = signUpData?.user ?? null;
    if (!user) {
      const { data: userData, error: getUserErr } = await supabase.auth.getUser();
      if (getUserErr) {
        // not fatal for client, but return error
        return { user: null, error: getUserErr };
      }
      user = userData?.user ?? null;
    }

    if (!user) {
      return { user: null, error: new Error("Unable to obtain created user id") };
    }

    const userId = user.id;

    // 2) Insert profile (id = auth.users.id)
    // Use upsert to be safe if row already exists
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .upsert(
        { id: userId, full_name: name, role }, // role defaults to 'user' unless specified
        { onConflict: "id" }
      )
      .select()
      .single();

    if (profileError) {
      // log, but we can still proceed if needed. Return error to surface to UI.
      return { user, error: profileError };
    }

    // 3) Insert default user_settings if none exists
    const { data: settingsData, error: settingsError } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId);

    if (!settingsData || settingsData.length === 0) {
      const { error: insertSettingsError } = await supabase.from("user_settings").insert([
        {
          user_id: userId,
          theme: "light",
          language: "en",
          notifications: true,
        },
      ]);
      if (insertSettingsError) {
        // non-fatal but surface it
        return { user, error: insertSettingsError };
      }
    }

    return { user, error: null };
  } catch (err) {
    return { user: null, error: err };
  }
};

export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const getCurrentUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user ?? null;
};

/**
 * Returns { user, role }.
 * If no profile row exists, role defaults to 'user'.
 */
export const getUserProfileAndRole = async () => {
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    return { user: null, role: null };
  }
  const user = userData.user;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  // If profileError is PGRST116 (no rows) treat as non-admin / default user
  if (profileError && profileError.code !== "PGRST116") {
    console.warn("Error fetching profile:", profileError.message);
    return { user, role: null };
  }

  const role = profile?.role ?? "user";
  return { user, role, profile };
};
