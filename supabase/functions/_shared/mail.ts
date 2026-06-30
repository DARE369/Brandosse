import { readOptionalEnv } from "./env.ts";

export type MailDeliveryStatus =
  | "sent"
  | "skipped_not_configured"
  | "failed_provider_error"
  | "manual_link_only";

export type MailDeliveryResult = {
  delivered: boolean;
  status: MailDeliveryStatus;
  provider: "resend";
  reason: string | null;
};

type SendTransactionalEmailPayload = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  mode?: "manual_link" | "email" | "hybrid";
};

export function resolveResendConfig() {
  const apiKey = readOptionalEnv("RESEND_API_KEY");
  const fromEmail = readOptionalEnv("RESEND_FROM_EMAIL")
    || readOptionalEnv("FROM_EMAIL");
  const fromName = readOptionalEnv("FROM_NAME") || "SocialAI";

  return {
    apiKey,
    fromEmail,
    fromName,
  };
}

export async function sendTransactionalEmail({
  to,
  subject,
  html,
  text,
  mode = "email",
}: SendTransactionalEmailPayload): Promise<MailDeliveryResult> {
  if (mode === "manual_link") {
    return {
      delivered: false,
      status: "manual_link_only",
      provider: "resend",
      reason: "manual_link_only",
    };
  }

  const { apiKey, fromEmail, fromName } = resolveResendConfig();
  if (!apiKey || !fromEmail) {
    return {
      delivered: false,
      status: "skipped_not_configured",
      provider: "resend",
      reason: !apiKey ? "missing_resend_api_key" : "missing_resend_from_email",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      return {
        delivered: false,
        status: "failed_provider_error",
        provider: "resend",
        reason: `resend_${response.status}:${responseText || response.statusText}`,
      };
    }

    return {
      delivered: true,
      status: "sent",
      provider: "resend",
      reason: null,
    };
  } catch (error) {
    return {
      delivered: false,
      status: "failed_provider_error",
      provider: "resend",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
