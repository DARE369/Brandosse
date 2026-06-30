import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, requireActiveOrgMember, insertUserNotification } from "../_shared/org.ts";

type TaskNotifyRequest = {
  organization_id: string;
  task_id: string;
  recipients?: string[];
  title?: string;
  body?: string;
  action_url?: string;
  dedupe_key?: string;
  metadata?: Record<string, unknown>;
};

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const adminClient = createAdminClient();
    const body = await parseJsonBody<TaskNotifyRequest>(req);

    if (!body.organization_id || !body.task_id) {
      throw createHttpError("Missing task notification details.", 400);
    }

    await requireActiveOrgMember(adminClient, body.organization_id, user.id);

    const recipients = [...new Set((body.recipients || []).filter(Boolean))];
    for (const recipientId of recipients) {
      await insertUserNotification(adminClient, {
        userId: recipientId,
        organizationId: body.organization_id,
        sentByAdminId: user.id,
        type: "system",
        title: body.title || "Task update",
        body: body.body || "A task was updated in your organization workspace.",
        actionUrl: body.action_url || null,
        dedupeKey: body.dedupe_key ? `${body.dedupe_key}:${recipientId}` : null,
        metadata: {
          requested_type: "org_task_notification",
          task_id: body.task_id,
          ...(body.metadata || {}),
        },
      });
    }

    return jsonResponse({
      task_id: body.task_id,
      delivered: recipients.length,
    });
  } catch (error) {
    console.error("[org-task-notify] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
