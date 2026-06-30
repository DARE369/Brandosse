import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { sendTransactionalEmail } from "../_shared/mail.ts";

type NotifyPayload = {
  target_user_id: string;
  channel: "in_app" | "email" | "both";
  subject: string;
  body: string;
};

async function sendEmailIfConfigured({ to, subject, body }: { to: string; subject: string; body: string }) {
  const result = await sendTransactionalEmail({
    to,
    subject,
    text: body,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-wrap;">${body}</div>`,
    mode: "email",
  });

  return {
    delivered: result.delivered,
    status: result.status,
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const authClient = createAuthClient(req.headers.get("Authorization"));
    const adminClient = createAdminClient();
    const actor = await requireUser(authClient);
    const payload = await parseJsonBody<NotifyPayload>(req);

    if (!payload?.target_user_id || !payload?.subject?.trim() || !payload?.body?.trim()) {
      throw new Error("Missing notification fields");
    }

    const { data: isAdmin, error: adminError } = await authClient.rpc("is_admin_user", {
      p_user_id: actor.id,
    });
    if (adminError) throw adminError;
    if (!isAdmin) throw new Error("Forbidden");

    const { data: canAccess, error: accessError } = await authClient.rpc("can_admin_access_user", {
      p_admin_id: actor.id,
      p_target_user_id: payload.target_user_id,
    });
    if (accessError) throw accessError;
    if (!canAccess) throw new Error("Forbidden");

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id, full_name, email, organization_id")
      .eq("id", payload.target_user_id)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!targetProfile) throw new Error("Target user not found");

    const { data: notification, error: notificationError } = await adminClient
      .from("user_notifications")
      .insert({
        user_id: payload.target_user_id,
        sent_by_admin_id: actor.id,
        channel: payload.channel,
        subject: payload.subject.trim(),
        body: payload.body.trim(),
      })
      .select("id, created_at")
      .single();
    if (notificationError) throw notificationError;

    let emailStatus = "not_requested";
    if ((payload.channel === "email" || payload.channel === "both") && targetProfile.email) {
      const emailResult = await sendEmailIfConfigured({
        to: targetProfile.email,
        subject: payload.subject.trim(),
        body: payload.body.trim(),
      });
      emailStatus = emailResult.status;
    }

    const { data: adminRoleResult } = await adminClient
      .from("admin_roles")
      .select("role")
      .eq("user_id", actor.id)
      .maybeSingle();

    await adminClient.from("audit_logs").insert({
      actor_id: actor.id,
      actor_type: "admin",
      actor_role: adminRoleResult?.role || null,
      organization_id: targetProfile.organization_id || null,
      event_category: "admin_action",
      event_type: "admin_notified_user",
      entity_type: "user",
      entity_id: payload.target_user_id,
      summary: `Admin sent notification to ${targetProfile.full_name || targetProfile.email || payload.target_user_id}`,
      metadata: {
        notification_id: notification.id,
        channel: payload.channel,
        email_status: emailStatus,
      },
      risk_level: null,
    });

    return jsonResponse({
      success: true,
      notification_id: notification.id,
      email_status: emailStatus,
    });
  } catch (error) {
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
