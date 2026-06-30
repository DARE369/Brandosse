import { create } from "zustand";
import { supabase } from "../services/supabaseClient";
import {
  ADMIN_NOTIFICATION_TYPE,
  COMPLAINT_CATEGORY,
  COMPLAINT_STATUS,
} from "../constants/statuses";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const COMPLAINT_SELECT_VARIANTS = [
  "id, organization_id, submitted_by_user_id, complaint_type, subject, description, status, priority, resolution_note, resolved_at, created_at, updated_at, linked_post_id, linked_generation_id, assigned_admin_id",
  "id, organization_id, submitted_by_user_id, category, complaint_type, title, subject, description, status, priority, resolution_note, resolved_by_admin_id, resolved_at, screenshot_url, user_notified_at, created_at, updated_at, linked_post_id, linked_generation_id",
];

const CATEGORY_TO_LEGACY_TYPE = {
  [COMPLAINT_CATEGORY.GENERATION]: "content_quality",
  [COMPLAINT_CATEGORY.PUBLISHING]: "publishing_issue",
  [COMPLAINT_CATEGORY.SCHEDULING]: "publishing_issue",
  [COMPLAINT_CATEGORY.ACCOUNT]: "account_issue",
  [COMPLAINT_CATEGORY.BILLING]: "credits_issue",
  [COMPLAINT_CATEGORY.PLATFORM_CONNECTION]: "connection_issue",
  [COMPLAINT_CATEGORY.OTHER]: "other",
};

const LEGACY_TYPE_TO_CATEGORY = {
  account_issue: COMPLAINT_CATEGORY.ACCOUNT,
  publishing_issue: COMPLAINT_CATEGORY.PUBLISHING,
  credits_issue: COMPLAINT_CATEGORY.BILLING,
  content_quality: COMPLAINT_CATEGORY.GENERATION,
  brand_mismatch: COMPLAINT_CATEGORY.GENERATION,
  abuse_report: COMPLAINT_CATEGORY.OTHER,
  connection_issue: COMPLAINT_CATEGORY.PLATFORM_CONNECTION,
  other: COMPLAINT_CATEGORY.OTHER,
};

let inFlightComplaintsPromise = null;
let inFlightComplaintsUserId = null;

function isMissingSchemaError(error) {
  if (!error) return false;
  const message = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return (
    message.includes("column") ||
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("pgrst")
  );
}

function normalizeComplaintStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "submitted" || normalized === "new") return COMPLAINT_STATUS.SUBMITTED;
  if (["triaged", "in_progress", "waiting_on_user", "escalated", "under_review"].includes(normalized)) {
    return COMPLAINT_STATUS.UNDER_REVIEW;
  }
  if (normalized === COMPLAINT_STATUS.RESOLVED) return COMPLAINT_STATUS.RESOLVED;
  if (normalized === COMPLAINT_STATUS.CLOSED) return COMPLAINT_STATUS.CLOSED;
  return COMPLAINT_STATUS.SUBMITTED;
}

async function fetchComplaintStatusHistory(complaintIds = []) {
  const ids = [...new Set((complaintIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("complaint_status_history")
    .select("id, complaint_id, from_status, to_status, changed_by_admin_id, note, created_at")
    .in("complaint_id", ids)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }

  return data || [];
}

async function fetchComplaintComments(complaintIds = []) {
  const ids = [...new Set((complaintIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const preferred = await supabase
    .from("complaint_comments")
    .select("id, complaint_id, author_id, author_type, body, is_internal, created_at")
    .in("complaint_id", ids)
    .eq("is_internal", false)
    .order("created_at", { ascending: true });

  if (!preferred.error) {
    return preferred.data || [];
  }

  if (!isMissingSchemaError(preferred.error)) {
    throw preferred.error;
  }

  const fallback = await supabase
    .from("complaint_comments")
    .select("id, complaint_id, author_id, author_type, body, is_internal, created_at")
    .in("complaint_id", ids)
    .order("created_at", { ascending: true });

  if (fallback.error) {
    if (isMissingSchemaError(fallback.error)) return [];
    throw fallback.error;
  }

  return (fallback.data || []).filter((comment) => !comment.is_internal);
}

async function fetchComplaintsWithFallback(userId) {
  let lastError = null;

  for (const selectClause of COMPLAINT_SELECT_VARIANTS) {
    const result = await supabase
      .from("complaints")
      .select(selectClause)
      .eq("submitted_by_user_id", userId)
      .order("created_at", { ascending: false });

    if (!result.error) {
      return result;
    }

    lastError = result.error;
    if (!isMissingSchemaError(result.error)) {
      return result;
    }
  }

  return { data: [], error: lastError };
}

function sanitizeFileName(name = "screenshot") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function getCurrentUserContext() {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) throw authError;
  if (!user) throw new Error("You must be signed in to use support.");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id, full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  return {
    user,
    profile: profile || null,
  };
}

async function uploadComplaintScreenshot(userId, screenshotFile) {
  if (!screenshotFile) return null;

  if (!String(screenshotFile.type || "").startsWith("image/")) {
    throw new Error("Screenshot must be an image file.");
  }

  if (screenshotFile.size > MAX_SCREENSHOT_BYTES) {
    throw new Error("Screenshot must be 5MB or smaller.");
  }

  const storagePath = `${userId}/${Date.now()}-${sanitizeFileName(screenshotFile.name)}`;
  const { error } = await supabase.storage
    .from("complaint-screenshots")
    .upload(storagePath, screenshotFile, {
      cacheControl: "3600",
      upsert: false,
      contentType: screenshotFile.type || "application/octet-stream",
    });

  if (error) throw error;
  return storagePath;
}

function attachResolvedByName(complaints, profileMap) {
  const resolvedProfileMap = profileMap instanceof Map ? profileMap : new Map();

  return (complaints || []).map((complaint) => ({
    ...complaint,
    title: complaint.title || complaint.subject || "Untitled issue",
    category: complaint.category || LEGACY_TYPE_TO_CATEGORY[complaint.complaint_type] || COMPLAINT_CATEGORY.OTHER,
    status: normalizeComplaintStatus(complaint.status),
    resolvedBy:
      complaint.resolved_by_admin_id && resolvedProfileMap.get(complaint.resolved_by_admin_id)
        ? resolvedProfileMap.get(complaint.resolved_by_admin_id)
        : null,
  }));
}

function buildComplaintTimelineById({
  complaints = [],
  statusHistory = [],
  comments = [],
  profileMap = new Map(),
}) {
  const timelineByComplaint = new Map();

  const addEntry = (complaintId, entry) => {
    if (!complaintId || !entry) return;
    const existing = timelineByComplaint.get(complaintId) || [];
    existing.push(entry);
    timelineByComplaint.set(complaintId, existing);
  };

  complaints.forEach((complaint) => {
    addEntry(complaint.id, {
      id: `submitted-${complaint.id}`,
      type: "status",
      from_status: null,
      to_status: COMPLAINT_STATUS.SUBMITTED,
      note: null,
      author: null,
      created_at: complaint.created_at,
    });
  });

  statusHistory.forEach((entry) => {
    addEntry(entry.complaint_id, {
      id: entry.id,
      type: "status",
      from_status: normalizeComplaintStatus(entry.from_status),
      to_status: normalizeComplaintStatus(entry.to_status),
      note: entry.note || null,
      author: entry.changed_by_admin_id ? profileMap.get(entry.changed_by_admin_id) || null : null,
      created_at: entry.created_at,
    });
  });

  comments.forEach((entry) => {
    addEntry(entry.complaint_id, {
      id: entry.id,
      type: "comment",
      body: entry.body || "",
      author_type: entry.author_type || "user",
      author: entry.author_id ? profileMap.get(entry.author_id) || null : null,
      created_at: entry.created_at,
    });
  });

  timelineByComplaint.forEach((entries, complaintId) => {
    const uniqueById = new Map();
    entries.forEach((entry) => {
      if (!entry?.id || uniqueById.has(entry.id)) return;
      uniqueById.set(entry.id, entry);
    });

    timelineByComplaint.set(
      complaintId,
      [...uniqueById.values()].sort(
        (left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime(),
      ),
    );
  });

  return timelineByComplaint;
}

const useHelpStore = create((set, get) => ({
  complaints: [],
  loadingComplaints: false,
  submitting: false,
  submitError: null,
  submitSuccess: false,
  activeTab: "help-center",
  formOpen: false,

  fetchUserComplaints: async () => {
    try {
      const { user } = await getCurrentUserContext();
      if (inFlightComplaintsPromise && inFlightComplaintsUserId === user.id) {
        return await inFlightComplaintsPromise;
      }

      set((state) => (
        state.loadingComplaints || state.submitError !== null
          ? { loadingComplaints: true, submitError: null }
          : state
      ));

      const requestPromise = (async () => {
        const { data, error } = await fetchComplaintsWithFallback(user.id);

        if (error) throw error;

        const complaintIds = [...new Set((data || []).map((item) => item.id).filter(Boolean))];
        const [statusHistory, comments] = await Promise.all([
          fetchComplaintStatusHistory(complaintIds),
          fetchComplaintComments(complaintIds),
        ]);

        const profileIds = [
          ...new Set([
            ...(data || []).map((item) => item.resolved_by_admin_id).filter(Boolean),
            ...statusHistory.map((item) => item.changed_by_admin_id).filter(Boolean),
            ...comments.map((item) => item.author_id).filter(Boolean),
          ]),
        ];

        let profileMap = new Map();
        if (profileIds.length) {
          const profileResult = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", profileIds);

          if (!profileResult.error) {
            profileMap = new Map((profileResult.data || []).map((profile) => [profile.id, profile]));
          }
        }

        const normalizedComplaints = attachResolvedByName(data || [], profileMap);
        const timelineByComplaintId = buildComplaintTimelineById({
          complaints: normalizedComplaints,
          statusHistory,
          comments,
          profileMap,
        });

        const complaintsWithTimeline = normalizedComplaints.map((complaint) => ({
          ...complaint,
          timeline: timelineByComplaintId.get(complaint.id) || [],
        }));

        set({
          complaints: complaintsWithTimeline,
          loadingComplaints: false,
          submitError: null,
        });

        return complaintsWithTimeline;
      })();

      inFlightComplaintsPromise = requestPromise;
      inFlightComplaintsUserId = user.id;

      try {
        return await requestPromise;
      } finally {
        if (inFlightComplaintsPromise === requestPromise) {
          inFlightComplaintsPromise = null;
          inFlightComplaintsUserId = null;
        }
      }
    } catch (error) {
      set({
        complaints: [],
        loadingComplaints: false,
        submitError: error?.message || "Failed to load support tickets.",
      });
      throw error;
    }
  },

  submitComplaint: async ({ category, title, description, screenshotFile }) => {
    set({
      submitting: true,
      submitError: null,
      submitSuccess: false,
    });

    try {
      const trimmedTitle = String(title || "").trim();
      const trimmedDescription = String(description || "").trim();

      if (!category) throw new Error("Category is required.");
      if (!trimmedTitle) throw new Error("Title is required.");
      if (trimmedTitle.length > 100) throw new Error("Title must be 100 characters or fewer.");
      if (trimmedDescription.length < 20) throw new Error("Description must be at least 20 characters.");
      if (trimmedDescription.length > 1000) throw new Error("Description must be 1000 characters or fewer.");

      const { user, profile } = await getCurrentUserContext();
      const screenshotPath = await uploadComplaintScreenshot(user.id, screenshotFile);

      const insertPayload = {
        organization_id: profile?.organization_id ?? null,
        submitted_by_user_id: user.id,
        category,
        complaint_type: CATEGORY_TO_LEGACY_TYPE[category] || CATEGORY_TO_LEGACY_TYPE.other,
        title: trimmedTitle,
        subject: trimmedTitle,
        description: trimmedDescription,
        status: COMPLAINT_STATUS.SUBMITTED,
        screenshot_url: screenshotPath,
      };

      let insertedComplaint = null;
      let insertError = null;

      const primaryInsert = await supabase
        .from("complaints")
        .insert(insertPayload)
        .select(COMPLAINT_SELECT_VARIANTS[1])
        .single();

      insertedComplaint = primaryInsert.data;
      insertError = primaryInsert.error;

      if (insertError && isMissingSchemaError(insertError)) {
        const legacyInsert = await supabase
          .from("complaints")
          .insert({
            organization_id: profile?.organization_id ?? null,
            submitted_by_user_id: user.id,
            complaint_type: CATEGORY_TO_LEGACY_TYPE[category] || CATEGORY_TO_LEGACY_TYPE.other,
            subject: trimmedTitle,
            description: trimmedDescription,
            status: "new",
          })
          .select(COMPLAINT_SELECT_VARIANTS[0])
          .single();

        insertedComplaint = legacyInsert.data;
        insertError = legacyInsert.error;
      }

      if (insertError) throw insertError;

      const notificationPayload = {
        type: ADMIN_NOTIFICATION_TYPE.COMPLAINT_SUBMITTED,
        severity: "medium",
        title: "New support ticket submitted",
        body: `${trimmedTitle}`,
        metadata: {
          complaint_id: insertedComplaint.id,
          user_id: user.id,
          category,
          entity_id: insertedComplaint.id,
          entity_type: "complaint",
          organization_id: profile?.organization_id ?? null,
        },
      };

      const notifyResult = await supabase.functions.invoke("notify-admin-event", {
        body: notificationPayload,
      });

      if (notifyResult.error || notifyResult.data?.error) {
        await supabase.from("admin_notifications").insert({
          recipient_admin_id: null,
          notification_type: ADMIN_NOTIFICATION_TYPE.COMPLAINT_SUBMITTED,
          severity: "medium",
          title: "New support ticket submitted",
          body: `${category}: ${trimmedTitle}`,
          metadata: {
            complaint_id: insertedComplaint.id,
            user_id: user.id,
            category,
            entity_id: insertedComplaint.id,
            entity_type: "complaint",
          },
          organization_id: profile?.organization_id ?? null,
          is_read: false,
        }).catch(() => {});
      }

      await get().fetchUserComplaints();

      set({
        submitting: false,
        submitSuccess: true,
        formOpen: false,
      });

      return insertedComplaint;
    } catch (error) {
      set({
        submitting: false,
        submitError: error?.message || "Could not submit your support ticket.",
        submitSuccess: false,
      });
      throw error;
    }
  },

  markComplaintsViewed: async (complaintIds = []) => {
    const ids = [...new Set((complaintIds || []).filter(Boolean))];
    if (!ids.length) return;

    const hasPendingViewedUpdates = get().complaints.some((complaint) => (
      ids.includes(complaint.id) && !complaint.user_notified_at
    ));

    if (!hasPendingViewedUpdates) {
      return;
    }

    const { error } = await supabase.rpc("mark_user_complaints_viewed", {
      p_complaint_ids: ids,
    });

    if (error && !isMissingSchemaError(error)) throw error;

    const now = new Date().toISOString();
    set((state) => {
      let changed = false;
      const complaints = state.complaints.map((complaint) => {
        if (!ids.includes(complaint.id) || complaint.user_notified_at) {
          return complaint;
        }

        changed = true;
        return { ...complaint, user_notified_at: now };
      });

      return changed ? { complaints } : state;
    });
  },

  setActiveTab: (tab) => set((state) => (state.activeTab === tab ? state : { activeTab: tab })),
  setFormOpen: (value) => {
    const nextValue = Boolean(value);
    set((state) => (state.formOpen === nextValue ? state : { formOpen: nextValue }));
  },
  resetForm: () => set((state) => (
    state.submitError === null && !state.submitSuccess && !state.formOpen
      ? state
      : { submitError: null, submitSuccess: false, formOpen: false }
  )),
  clearSubmitState: () => set((state) => (
    state.submitError === null && !state.submitSuccess
      ? state
      : { submitError: null, submitSuccess: false }
  )),
}));

export default useHelpStore;
