import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { ensureOrganizationBootstrap } from "../_shared/org-bootstrap.ts";

type OrgSetupRequest = {
  organization_id: string;
  owner_user_id: string;
  plan_key: "organization" | "agency";
  org_name: string;
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
    const body = await parseJsonBody<OrgSetupRequest>(req);

    if (!body.organization_id || !body.owner_user_id || !body.org_name) {
      throw createHttpError("Missing organization setup details.", 400);
    }

    if (user.id !== body.owner_user_id) {
      throw createHttpError("Only the workspace owner can initialize this organization.", 403);
    }

    const result = await ensureOrganizationBootstrap(adminClient, {
      organizationId: body.organization_id,
      ownerUserId: body.owner_user_id,
      planKey: body.plan_key || "organization",
      orgName: body.org_name,
      activateOwnerMembership: true,
    });

    return jsonResponse(result);
  } catch (error) {
    console.error("[org-setup] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
