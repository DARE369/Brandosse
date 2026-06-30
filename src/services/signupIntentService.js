import { supabase } from "./supabaseClient";

export const SIGNUP_COMPLETION_PATH = "/complete-signup";

const STORAGE_KEY = "socialai-pending-signup-intent";

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizePlanKey(planKey) {
  const normalized = String(planKey || "individual").trim().toLowerCase();
  return ["organization", "agency"].includes(normalized) ? normalized : "individual";
}

function getStorage() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

export function isOrganizationPlanKey(planKey) {
  return ["organization", "agency"].includes(normalizePlanKey(planKey));
}

export function createSignupRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `signup-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function buildPendingSignupIntent({
  planKey,
  organizationName,
  organizationSlug,
  signupRequestId = null,
} = {}) {
  const normalizedPlanKey = normalizePlanKey(planKey);
  if (!isOrganizationPlanKey(normalizedPlanKey)) {
    return null;
  }

  const trimmedName = String(organizationName || "").trim();
  const normalizedSlug = slugify(organizationSlug || trimmedName);

  return {
    planKey: normalizedPlanKey,
    organizationName: trimmedName,
    organizationSlug: normalizedSlug,
    signupRequestId: signupRequestId || createSignupRequestId(),
    createdAt: new Date().toISOString(),
    lastAttemptAt: null,
    lastError: null,
  };
}

export function getPendingSignupIntent() {
  const storage = getStorage();
  if (!storage) return null;

  const rawValue = storage.getItem(STORAGE_KEY);
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") return null;
    if (!isOrganizationPlanKey(parsed.planKey)) return null;

    return {
      planKey: normalizePlanKey(parsed.planKey),
      organizationName: String(parsed.organizationName || "").trim(),
      organizationSlug: slugify(parsed.organizationSlug || parsed.organizationName || ""),
      signupRequestId: String(parsed.signupRequestId || "").trim() || createSignupRequestId(),
      createdAt: parsed.createdAt || new Date().toISOString(),
      lastAttemptAt: parsed.lastAttemptAt || null,
      lastError: parsed.lastError || null,
    };
  } catch (_error) {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function savePendingSignupIntent(intent) {
  const storage = getStorage();
  if (!storage || !intent) return null;

  const normalizedIntent = buildPendingSignupIntent(intent);
  if (!normalizedIntent) {
    storage.removeItem(STORAGE_KEY);
    return null;
  }

  const nextIntent = {
    ...normalizedIntent,
    createdAt: intent.createdAt || normalizedIntent.createdAt,
    lastAttemptAt: intent.lastAttemptAt || null,
    lastError: intent.lastError || null,
  };

  storage.setItem(STORAGE_KEY, JSON.stringify(nextIntent));
  return nextIntent;
}

export function updatePendingSignupIntent(patch = {}) {
  const currentIntent = getPendingSignupIntent();
  if (!currentIntent) return null;

  return savePendingSignupIntent({
    ...currentIntent,
    ...patch,
  });
}

export function clearPendingSignupIntent() {
  const storage = getStorage();
  storage?.removeItem(STORAGE_KEY);
}

function normalizeProvisionError(error) {
  const message = String(error?.message || "").trim();
  if (!message) return "Could not finish setting up your organization workspace.";
  if (/failed to send a request to the edge function/i.test(message)) {
    return "Could not reach the organization setup service. Try again in a moment.";
  }
  if (/non-2xx status code|edge function returned/i.test(message)) {
    return "The organization setup service returned an error. Try again or contact support if it persists.";
  }
  return message;
}

export async function provisionSelfSignupOrganization(intent) {
  const activeIntent = intent || getPendingSignupIntent();
  if (!activeIntent || !isOrganizationPlanKey(activeIntent.planKey)) {
    throw new Error("There is no pending organization signup to complete.");
  }

  updatePendingSignupIntent({
    lastAttemptAt: new Date().toISOString(),
    lastError: null,
  });

  const { data, error } = await supabase.functions.invoke("org-self-signup", {
    body: {
      organization_name: activeIntent.organizationName,
      slug: activeIntent.organizationSlug,
      plan_key: activeIntent.planKey,
      signup_request_id: activeIntent.signupRequestId,
    },
  });

  if (error) {
    const normalizedMessage = normalizeProvisionError(error);
    updatePendingSignupIntent({
      lastAttemptAt: new Date().toISOString(),
      lastError: normalizedMessage,
    });
    throw new Error(normalizedMessage);
  }

  clearPendingSignupIntent();
  return data;
}
