import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { isSupabaseConfigured } from '../services/supabaseConfig';
import {
  getUserOrgMemberships,
  getUserProfileAndRole,
  resetUserProfileRoleCache,
} from '../services/authService';
import { fetchContextLastUsed, updateLastUsedContext } from '../org/services/orgService';
import {
  isAdminPath,
  isAdminRole,
  isUserWorkspacePath,
  normalizeRole,
} from '../utils/authRouting';
import {
  buildWorkspaceCatalog,
  deriveWorkspaceFromPath,
  findWorkspaceTarget,
} from '../utils/workspaceUtils';
import { getOrganizationHomePath } from '../org/utils/orgHomePath';
import {
  buildPendingSignupIntent,
  clearPendingSignupIntent,
  getPendingSignupIntent,
  isOrganizationPlanKey,
  provisionSelfSignupOrganization,
  savePendingSignupIntent,
  SIGNUP_COMPLETION_PATH,
} from '../services/signupIntentService';
import {
  fetchUserSettings,
  normalizeDefaultWorkspaceRoute,
} from '../services/userSettingsService';

const AuthContext = createContext();
const AUTH_REQUEST_TIMEOUT_MS = 8_000;
const AUTH_SESSION_TIMEOUT_MS = 6_000;
const AUTH_STORAGE_KEY = 'socialai-auth';
const AUTH_WARNING_DEDUPE_MS = 30_000;
const authWarningTimestamps = new Map();

function withAuthTimeout(promise, label, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
        reject(new Error(`${label} timed out. Check your connection and Supabase configuration.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    globalThis.clearTimeout(timeoutId);
  });
}

function isAuthTimeoutError(error) {
  return /timed out\. Check your connection and Supabase configuration/i.test(error?.message || '');
}

function isRetryableAuthNetworkError(error) {
  if (!error) return false;
  const status = Number(error.status || error.code || 0);
  const message = `${error.name || ''} ${error.message || ''}`.toLowerCase();

  return (
    status === 0 ||
    status === 503 ||
    message.includes('authretryablefetcherror') ||
    message.includes('auth_unavailable') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('connection reset') ||
    message.includes('temporarily unavailable')
  );
}

function isRecoverableAuthAvailabilityError(error) {
  return isAuthTimeoutError(error) || isRetryableAuthNetworkError(error);
}

function warnAuthOnce(key, message, detail = null) {
  const now = Date.now();
  const lastSeen = authWarningTimestamps.get(key) || 0;
  if (now - lastSeen < AUTH_WARNING_DEDUPE_MS) return;

  authWarningTimestamps.set(key, now);
  if (detail) {
    console.warn(message, detail);
  } else {
    console.warn(message);
  }
}

function inferNameFromEmail(email) {
  return email?.split('@')[0] || 'New User';
}

function isInvalidStoredSessionError(error) {
  if (!error) return false;
  const status = Number(error.status || error.code || 0);
  const message = `${error.name || ''} ${error.message || ''}`.toLowerCase();

  return (
    status === 401 ||
    status === 403 ||
    message.includes('invalid jwt') ||
    message.includes('jwt') ||
    message.includes('no suitable key') ||
    message.includes('wrong key type') ||
    message.includes('invalid api key') ||
    message.includes('session_not_found') ||
    message.includes('refresh_token_not_found')
  );
}

async function clearLocalAuthSession(reason = 'invalid session') {
  resetUserProfileRoleCache();

  if (typeof window !== 'undefined') {
    window.localStorage?.removeItem(AUTH_STORAGE_KEY);
    window.sessionStorage?.removeItem(AUTH_STORAGE_KEY);
  }

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    if (!isInvalidStoredSessionError(error)) {
      console.warn(`[AuthContext] local sign-out after ${reason} failed:`, error?.message || error);
    }
  }
}

function resolveWorkspaceRedirectPath({
  adminUser,
  memberships = [],
  lastContext = null,
  personalDefaultRoute = '/app/dashboard',
}) {
  const safePersonalRoute = normalizeDefaultWorkspaceRoute(personalDefaultRoute);
  const activeMemberships = Array.isArray(memberships)
    ? memberships.filter((membership) => membership?.status === 'active')
    : [];

  const lastOrganizationId = lastContext?.last_organization_id || null;
  const lastOrganizationMembership = activeMemberships.find(
    (membership) => membership.organizationId === lastOrganizationId,
  );

  if (lastContext?.last_context_type === 'organization' && lastOrganizationMembership) {
    return getOrganizationHomePath(lastOrganizationId, lastOrganizationMembership.role);
  }

  if (lastContext?.last_context_type === 'personal') {
    return safePersonalRoute;
  }

  if (lastContext?.last_context_type === 'admin' && adminUser) {
    return '/app/admin';
  }

  if (adminUser) {
    return '/app/admin';
  }

  if (activeMemberships.length > 0) {
    return '/select-context';
  }

  return safePersonalRoute;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(undefined);
  const [session, setSession] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [resolvedRole, setResolvedRole] = useState(null);
  const [adminRole, setAdminRole] = useState(null);
  const [orgMemberships, setOrgMemberships] = useState([]);
  const [lastUsedContext, setLastUsedContext] = useState(null);
  const [workspaceRedirectPath, setWorkspaceRedirectPath] = useState(null);
  const [currentPathname, setCurrentPathname] = useState('');
  const prevSessionRef = useRef(null);
  const accessRequestRef = useRef(0);

  const clearResolvedAccess = useCallback(() => {
    accessRequestRef.current += 1;
    setProfile(null);
    setResolvedRole(null);
    setAdminRole(null);
    setOrgMemberships([]);
    setLastUsedContext(null);
    setWorkspaceRedirectPath(null);
    setCurrentPathname('');
    setAccessLoading(false);
  }, []);

  const clearManagedWorkspaceRedirect = useCallback(() => {
    if (typeof window === 'undefined') return;
    const currentRedirect = sessionStorage.getItem('socialai-redirect-after-login');
    if (
      currentRedirect === '/select-context'
      || currentRedirect === SIGNUP_COMPLETION_PATH
      || currentRedirect?.startsWith('/app/org/')
      || isAdminPath(currentRedirect)
      || isUserWorkspacePath(currentRedirect)
    ) {
      sessionStorage.removeItem('socialai-redirect-after-login');
    }
  }, []);

  const setManagedWorkspaceRedirect = useCallback((nextPath) => {
    if (typeof window === 'undefined') return;

    if (!nextPath) {
      clearManagedWorkspaceRedirect();
      return;
    }

    sessionStorage.setItem('socialai-redirect-after-login', nextPath);
  }, [clearManagedWorkspaceRedirect]);

  const runBackgroundTask = useCallback((task, label) => {
    Promise.resolve()
      .then(task)
      .catch((error) => {
        const message = error?.message || String(error || 'Unknown error');
        if (!/permission denied|does not exist/i.test(message)) {
          console.warn(`[AuthContext] ${label} failed:`, message);
        }
      });
  }, []);

  const loadResolvedAccess = useCallback(async (activeUser) => {
    if (!activeUser?.id) {
      clearResolvedAccess();
      return { user: null, role: null, adminRole: null, profile: null };
    }

    const requestId = accessRequestRef.current + 1;
    accessRequestRef.current = requestId;
    setAccessLoading(true);

    try {
      const [result, memberships, lastContext, userSettings] = await Promise.all([
        getUserProfileAndRole(activeUser),
        getUserOrgMemberships(activeUser.id),
        fetchContextLastUsed(activeUser.id),
        fetchUserSettings(activeUser.id).catch(() => null),
      ]);

      if (accessRequestRef.current !== requestId) {
        return result;
      }

      const nextResolvedRole =
        normalizeRole(result?.adminRole || result?.role || result?.profile?.role || 'user') || 'user';
      const nextAdminRole = normalizeRole(result?.adminRole || result?.profile?.role);
      const nextProfile = result?.profile
        ? {
            ...result.profile,
            id: result.profile.id ?? activeUser.id,
            email: result.profile.email ?? result?.user?.email ?? activeUser.email ?? null,
          }
        : {
            id: activeUser.id,
            full_name:
              result?.user?.user_metadata?.full_name ||
              result?.user?.user_metadata?.name ||
              inferNameFromEmail(result?.user?.email || activeUser.email),
            email: result?.user?.email ?? activeUser.email ?? null,
            avatar_url: null,
            credits: 0,
            role: nextResolvedRole,
            organization_id: null,
          };

      setProfile(nextProfile);
      setResolvedRole(nextResolvedRole);
      setAdminRole(nextAdminRole);
      setOrgMemberships(memberships);
      setLastUsedContext(lastContext);

      const personalDefaultRoute = normalizeDefaultWorkspaceRoute(
        userSettings?.defaultWorkspaceRoute || '/app/dashboard',
      );

      const adminUser = isAdminRole(nextAdminRole || nextResolvedRole);
      const nextWorkspaceRedirectPath = resolveWorkspaceRedirectPath({
        adminUser,
        memberships,
        lastContext,
        personalDefaultRoute,
      });

      setWorkspaceRedirectPath(nextWorkspaceRedirectPath);
      setManagedWorkspaceRedirect(nextWorkspaceRedirectPath);

      return {
        ...result,
        profile: nextProfile,
        role: nextResolvedRole,
        adminRole: nextAdminRole,
        orgMemberships: memberships,
        lastUsedContext: lastContext,
        workspaceRedirectPath: nextWorkspaceRedirectPath,
      };
    } catch (error) {
      if (accessRequestRef.current === requestId) {
        console.error('[AuthContext] access resolution failed:', error);
        setProfile({
          id: activeUser.id,
          full_name:
            activeUser.user_metadata?.full_name ||
            activeUser.user_metadata?.name ||
            inferNameFromEmail(activeUser.email),
          email: activeUser.email ?? null,
          avatar_url: null,
          credits: 0,
          role: 'user',
          organization_id: null,
        });
        setResolvedRole('user');
        setAdminRole(null);
        setOrgMemberships([]);
        setLastUsedContext(null);
        setWorkspaceRedirectPath('/app/dashboard');
        clearManagedWorkspaceRedirect();
      }

      return { user: activeUser, role: 'user', adminRole: null, profile: null };
    } finally {
      if (accessRequestRef.current === requestId) {
        setAccessLoading(false);
      }
    }
  }, [clearManagedWorkspaceRedirect, clearResolvedAccess, setManagedWorkspaceRedirect]);

  useEffect(() => {
    const recordLastActive = async (activeUser) => {
      if (!activeUser?.id) return;
      const { error } = await supabase
        .from("profiles")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", activeUser.id);

      if (error && !/last_active_at|column/i.test(error.message || "")) {
        console.warn("[AuthContext] last_active_at update failed:", error.message);
      }
    };

    const writeAuthAuditLog = async ({ activeUser, eventType, summary }) => {
      if (!activeUser?.id) return;

      const { error } = await supabase.rpc("write_audit_log", {
        p_actor_id: activeUser.id,
        p_actor_type: "user",
        p_actor_role: null,
        p_organization_id: null,
        p_event_category: "authentication",
        p_event_type: eventType,
        p_entity_type: "session",
        p_entity_id: activeUser.id,
        p_summary: summary,
        p_previous_value: null,
        p_new_value: null,
        p_metadata: {
          timestamp: new Date().toISOString(),
        },
        p_risk_level: null,
        p_correlation_id: null,
        p_ip_address: null,
        p_user_agent: navigator.userAgent,
      });

      if (error && !/write_audit_log|audit_logs|permission denied|does not exist/i.test(error.message || "")) {
        console.warn(`[AuthContext] ${eventType} audit log failed:`, error.message);
      }
    };

    const applySignedOutState = () => {
      setSession(null);
      setUser(null);
      prevSessionRef.current = null;
      clearResolvedAccess();
    };

    const validateStoredSession = async (candidateSession, source, options = {}) => {
      if (!candidateSession?.access_token) return null;

      let result = null;
      try {
        result = await withAuthTimeout(
          supabase.auth.getUser(),
          `${source} validation`,
          AUTH_SESSION_TIMEOUT_MS,
        );
      } catch (error) {
        const fallbackUser = candidateSession.user || options.fallbackUser || null;
        if (options.allowTimeoutFallback && isRecoverableAuthAvailabilityError(error) && fallbackUser?.id) {
          warnAuthOnce(
            `${source}-recoverable-validation`,
            `[AuthContext] ${source} validation could not reach Supabase; keeping the current session temporarily.`,
          );
          return {
            ...candidateSession,
            user: fallbackUser,
          };
        }
        throw error;
      }

      const { data, error } = result;

      if (error) {
        if (isInvalidStoredSessionError(error)) {
          console.warn(`[AuthContext] cleared stale Supabase session from ${source}:`, error.message);
          await clearLocalAuthSession(source);
          return null;
        }

        throw error;
      }

      if (!data?.user?.id) {
        await clearLocalAuthSession(`${source} missing user`);
        return null;
      }

      return {
        ...candidateSession,
        user: data.user,
      };
    };

    const checkSession = async () => {
      let activeSession = null;
      try {
        ({
          data: { session: activeSession },
        } = await withAuthTimeout(
          supabase.auth.getSession(),
          'Session check',
          AUTH_SESSION_TIMEOUT_MS,
        ));
      } catch (error) {
        // getSession itself failed (timeout / unavailable). Treat as signed out
        // for the first paint; onAuthStateChange reconciles if a session exists.
        if (isRecoverableAuthAvailabilityError(error)) {
          warnAuthOnce(
            'session-check-auth-unavailable',
            '[AuthContext] Supabase session check is temporarily unavailable.',
            error?.message || error,
          );
        } else if (isInvalidStoredSessionError(error)) {
          await clearLocalAuthSession('session check');
        } else {
          console.warn('[AuthContext] session check failed:', error?.message || error);
        }
        applySignedOutState();
        setLoading(false);
        return;
      }

      // Paint immediately from the LOCAL session (getSession reads storage, no
      // network wait), then verify with getUser in the BACKGROUND. This removes
      // the second serial auth round-trip from first paint. We only sign out if
      // the token is *definitively* invalid — never on a transient network blip.
      if (activeSession?.user) {
        setSession(activeSession);
        setUser(activeSession.user);
        prevSessionRef.current = activeSession;
        setLoading(false);

        runBackgroundTask(async () => {
          try {
            const verifiedSession = await validateStoredSession(activeSession, 'initial session');
            if (verifiedSession?.user) {
              setSession(verifiedSession);
              setUser(verifiedSession.user);
              prevSessionRef.current = verifiedSession;
              void recordLastActive(verifiedSession.user);
            } else {
              applySignedOutState();
            }
          } catch (error) {
            if (isRecoverableAuthAvailabilityError(error)) return; // keep optimistic session
            if (isInvalidStoredSessionError(error)) {
              await clearLocalAuthSession('background session validation');
            }
            applySignedOutState();
          }
        }, 'background session validation');
      } else {
        applySignedOutState();
        setLoading(false);
      }
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      const previousSession = prevSessionRef.current;

      try {
        if (event === "INITIAL_SESSION") {
          const verifiedSession = await validateStoredSession(nextSession, 'auth state initial session', {
            allowTimeoutFallback: true,
            fallbackUser: nextSession?.user || previousSession?.user || null,
          });
          setSession(verifiedSession);
          setUser(verifiedSession?.user ?? null);
          prevSessionRef.current = verifiedSession;
          if (!verifiedSession) {
            applySignedOutState();
          }
          setLoading(false);
          return;
        }

        if (event === "TOKEN_REFRESHED") {
          const verifiedSession = await validateStoredSession(nextSession, 'token refresh', {
            allowTimeoutFallback: true,
            fallbackUser: nextSession?.user || previousSession?.user || null,
          });
          setSession(verifiedSession);
          setUser(verifiedSession?.user ?? null);
          prevSessionRef.current = verifiedSession;
          if (!verifiedSession) {
            applySignedOutState();
          }
          return;
        }

        if (event === "SIGNED_IN") {
          resetUserProfileRoleCache();
          setSession(nextSession);
          setUser(nextSession?.user ?? null);
          prevSessionRef.current = nextSession;
          setLoading(false);

          if (nextSession?.user) {
            runBackgroundTask(
              () => recordLastActive(nextSession.user),
              "last_active_at update",
            );

            if (previousSession?.access_token !== nextSession.access_token) {
              runBackgroundTask(
                () =>
                  writeAuthAuditLog({
                    activeUser: nextSession.user,
                    eventType: "login",
                    summary: "User logged in",
                  }),
                "login audit log",
              );
            }
          } else {
            applySignedOutState();
          }

          return;
        }

        if (event === "SIGNED_OUT") {
          resetUserProfileRoleCache();
          clearManagedWorkspaceRedirect();
          applySignedOutState();
          setLoading(false);
        }
      } catch (error) {
        if (isRecoverableAuthAvailabilityError(error)) {
          warnAuthOnce(
            `auth-event-${event}-auth-unavailable`,
            `[AuthContext] ${event} could not verify Supabase auth state.`,
            error?.message || error,
          );
          if (event === "INITIAL_SESSION") {
            applySignedOutState();
            setLoading(false);
          }
          return;
        }

        console.warn(`[AuthContext] ${event} handling failed:`, error?.message || error);
        if (isInvalidStoredSessionError(error)) {
          await clearLocalAuthSession(`auth event ${event}`);
          applySignedOutState();
        }
        if (event === "INITIAL_SESSION") {
          setLoading(false);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [clearManagedWorkspaceRedirect, clearResolvedAccess, runBackgroundTask]);

  useEffect(() => {
    if (!user?.id) {
      clearResolvedAccess();
      return;
    }

    void loadResolvedAccess(user);
  }, [clearResolvedAccess, loadResolvedAccess, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (loading || accessLoading || !user?.id) return;

    const pendingInviteToken = sessionStorage.getItem('socialai-pending-org-invite-token');
    if (!pendingInviteToken) return;
    if (window.location.pathname === '/join') return;

    window.location.replace(`/join?token=${encodeURIComponent(pendingInviteToken)}`);
  }, [accessLoading, loading, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (loading || accessLoading || !user?.id) return;
    if (sessionStorage.getItem('socialai-pending-org-invite-token')) return;

    const pendingSignupIntent = getPendingSignupIntent();
    if (!pendingSignupIntent) return;
    if (window.location.pathname === SIGNUP_COMPLETION_PATH) return;
    if (window.location.pathname === '/join') return;

    window.location.replace(SIGNUP_COMPLETION_PATH);
  }, [accessLoading, loading, user?.id]);

  // --- EXISTING METHODS ---
  const login = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    const { data, error } = await withAuthTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      'Sign-in request',
    );
    if (error) throw error;
    return data;
  }, []);

  const requestPasswordReset = useCallback(async (email) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) {
      throw new Error('Email is required.');
    }

    const redirectTo = `${window.location.origin.replace(/\/+$/, '')}/reset-password`;
    const { error } = await withAuthTimeout(
      supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo }),
      'Password reset request',
    );
    if (error) throw error;
    return true;
  }, []);

  const updatePassword = useCallback(async (password) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    const normalizedPassword = String(password || '');
    if (normalizedPassword.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }

    const { error } = await withAuthTimeout(
      supabase.auth.updateUser({ password: normalizedPassword }),
      'Password update request',
    );
    if (error) throw error;
    return true;
  }, []);

  const logout = useCallback(async () => {
    if (user?.id) {
      const { error: logoutAuditError } = await supabase.rpc("write_audit_log", {
        p_actor_id: user.id,
        p_actor_type: "user",
        p_actor_role: null,
        p_organization_id: null,
        p_event_category: "authentication",
        p_event_type: "logout",
        p_entity_type: "session",
        p_entity_id: user.id,
        p_summary: "User logged out",
        p_previous_value: null,
        p_new_value: null,
        p_metadata: {
          timestamp: new Date().toISOString(),
        },
        p_risk_level: null,
        p_correlation_id: null,
        p_ip_address: null,
        p_user_agent: navigator.userAgent,
      });

      if (logoutAuditError && !/write_audit_log|audit_logs|permission denied|does not exist/i.test(logoutAuditError.message || "")) {
        console.warn("[AuthContext] logout audit log failed:", logoutAuditError.message);
      }
    }

    resetUserProfileRoleCache();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, [user?.id]);

  // Fallback profile provisioning for email/password registration.
  // DB trigger remains the primary guarantee.
  const ensureProfileFallback = async ({ user, source }) => {
    if (!user?.id) {
      console.warn(`[ProfileProvisioning][${source}] skipped fallback upsert: user id unavailable`);
      return;
    }

    const inferredRole = 'user';
    const fullName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      inferNameFromEmail(user.email);

    const { error } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        full_name: fullName,
        email: user.email,
        role: inferredRole,
        credits: 100,
        status: 'active',
      },
      { onConflict: 'id' },
    );

    if (error) {
      console.error(`[ProfileProvisioning][${source}] fallback upsert failed:`, error.message);
      return;
    }

    console.info(`[ProfileProvisioning][${source}] fallback upsert succeeded for user ${user.id}`);
  };

  const register = useCallback(async (email, password, options = {}) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    const pendingSignupIntent = isOrganizationPlanKey(options?.planKey)
      ? savePendingSignupIntent(buildPendingSignupIntent({
          planKey: options?.planKey,
          organizationName: options?.organizationName,
          organizationSlug: options?.organizationSlug,
          signupRequestId: options?.signupRequestId,
        }))
      : null;

    if (pendingSignupIntent) {
      sessionStorage.setItem('socialai-redirect-after-login', SIGNUP_COMPLETION_PATH);
    } else {
      clearPendingSignupIntent();
    }

    let data = null;

    try {
      const signUpResult = await withAuthTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: inferNameFromEmail(email),
            },
          },
        }),
        'Registration request',
      );

      data = signUpResult.data;
      if (signUpResult.error) throw signUpResult.error;
    } catch (error) {
      if (pendingSignupIntent) {
        clearPendingSignupIntent();
        sessionStorage.removeItem('socialai-redirect-after-login');
      }
      throw error;
    }

    await ensureProfileFallback({
      user: data?.user ?? null,
      source: 'register-email',
    });

    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();

    const activeSession = data?.session || currentSession || null;
    let organizationProvision = null;
    let organizationProvisionPending = false;

    if (pendingSignupIntent) {
      if (activeSession?.access_token) {
        try {
          organizationProvision = await provisionSelfSignupOrganization(pendingSignupIntent);
          sessionStorage.removeItem('socialai-redirect-after-login');
          await loadResolvedAccess(activeSession.user || data?.user || null);
        } catch (_provisionError) {
          organizationProvisionPending = true;
        }
      } else {
        organizationProvisionPending = true;
      }
    }

    return {
      ...data,
      hasActiveSession: Boolean(activeSession?.access_token),
      organizationProvision,
      organizationProvisionPending,
      signupIntent: pendingSignupIntent,
    };
  }, [loadResolvedAccess]);

  // --- NEW METHOD: Social Login ---
  const loginWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Redirect back to your app after Google login
        redirectTo: `${window.location.origin}/auth/callback`, 
      },
    });
    if (error) throw error;
  }, []);

  const isAdminUser = isAdminRole(adminRole || resolvedRole);

  const availableWorkspaces = useMemo(
    () => buildWorkspaceCatalog({ isAdmin: isAdminUser, orgMemberships }),
    [isAdminUser, orgMemberships],
  );

  const activeWorkspace = useMemo(() => {
    const fromPath = deriveWorkspaceFromPath(currentPathname, availableWorkspaces);
    if (fromPath) return fromPath;

    if (workspaceRedirectPath) {
      return deriveWorkspaceFromPath(workspaceRedirectPath, availableWorkspaces);
    }

    if (lastUsedContext?.last_context_type === 'organization' && lastUsedContext?.last_organization_id) {
      return findWorkspaceTarget(availableWorkspaces, {
        type: 'organization',
        organizationId: lastUsedContext.last_organization_id,
      });
    }

    if (lastUsedContext?.last_context_type === 'admin') {
      return findWorkspaceTarget(availableWorkspaces, 'admin');
    }

    return findWorkspaceTarget(availableWorkspaces, 'personal');
  }, [availableWorkspaces, currentPathname, lastUsedContext, workspaceRedirectPath]);

  const syncWorkspacePath = useCallback((pathname) => {
    setCurrentPathname(pathname || '');
  }, []);

  const switchWorkspace = useCallback(async (target) => {
    const nextWorkspace = findWorkspaceTarget(availableWorkspaces, target);
    if (!nextWorkspace) return null;

    const contextType = nextWorkspace.type === 'organization' ? 'organization' : nextWorkspace.type;

    if (user?.id) {
      await updateLastUsedContext({
        userId: user.id,
        contextType,
        organizationId: nextWorkspace.organizationId || null,
        brandProjectId: null,
      });

      setLastUsedContext({
        user_id: user.id,
        last_context_type: contextType,
        last_organization_id: nextWorkspace.organizationId || null,
        last_brand_project_id: null,
        updated_at: new Date().toISOString(),
      });
    }

    setWorkspaceRedirectPath(nextWorkspace.path);
    return nextWorkspace.path;
  }, [availableWorkspaces, user?.id]);

  const refreshAccess = useCallback(async (activeUser = null) => {
    const resolvedUser = activeUser || user || session?.user || null;
    return loadResolvedAccess(resolvedUser);
  }, [loadResolvedAccess, session?.user, user]);

  const value = useMemo(() => ({
    user,
    session,
    profile,
    resolvedRole,
    adminRole,
    orgMemberships,
    lastUsedContext,
    workspaceRedirectPath,
    availableWorkspaces,
    activeWorkspace,
    loading,
    accessLoading,
    isAdmin: isAdminUser,
    login,
    requestPasswordReset,
    updatePassword,
    logout,
    signOut: logout,
    register,
    loginWithGoogle,
    refreshAccess,
    syncWorkspacePath,
    switchWorkspace,
  }), [
    activeWorkspace,
    accessLoading,
    adminRole,
    availableWorkspaces,
    isAdminUser,
    loadResolvedAccess,
    lastUsedContext,
    loading,
    login,
    requestPasswordReset,
    updatePassword,
    logout,
    orgMemberships,
    profile,
    register,
    refreshAccess,
    resolvedRole,
    session,
    switchWorkspace,
    syncWorkspacePath,
    user,
    workspaceRedirectPath,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  return useContext(AuthContext);
};
