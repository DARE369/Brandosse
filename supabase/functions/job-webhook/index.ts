/**
 * job-webhook — fal.ai queue webhook receiver (Week 3 Fix 3)
 *
 * fal.ai's queue API (see _shared/fal.service.ts submitVideoJob) is passed
 * `?fal_webhook=<this function's URL>` at submit time, with a per-job
 * random token embedded in the URL as the auth mechanism (fal does not
 * document a signature scheme this app can verify, so a capability URL —
 * the same trust model as e.g. an unsigned legacy webhook fallback — is the
 * pragmatic choice; see FIXLOG for what this leaves unverified).
 *
 * Uses fal.ai's own webhook POST BODY as the primary completion source
 * (confirmed live 2026-07-12 against fal.ai's documented webhook contract:
 * `{ request_id, status: "OK"|"ERROR", payload }`, where `payload` IS the
 * model's real output already — no extra fetch needed). This was changed
 * from an earlier design that distrusted the body and always re-fetched via
 * GET, after live testing found fal.ai's GET-based result endpoint
 * genuinely broken for at least one real model (fal-ai/kling-video/v2.5/pro
 * 404s on every URL shape tried — a fal.ai-side routing quirk for
 * multi-segment endpoint ids, not something fixable from this app). Falls
 * back to reconcileJob (GET-based re-fetch) if the body doesn't match the
 * expected shape, for robustness against any other webhook delivery format.
 * Both this function and process-jobs ultimately go through
 * finalizeCompleted/finalizeFailed's status='running' claim guard, so a
 * webhook/poller race is still safe regardless of which path got there.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { reconcileJob, finalizeFromWebhookPayload, type BackgroundJobRow } from "../_shared/videoJobFinalize.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Always 200 to fal.ai regardless of internal outcome — a non-2xx would
  // make fal retry the webhook, which is fine (idempotent via reconcileJob's
  // claim guard), but there's no reason to signal failure for e.g. "job
  // already finalized by the poller" races.
  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");
    const token = url.searchParams.get("token");
    if (!jobId || !token) return jsonResponse({ ok: false, reason: "missing job_id/token" }, 200);

    const adminClient = createAdminClient();

    const { data: jobRow, error: fetchError } = await adminClient
      .from("background_jobs")
      .select("id, user_id, status, payload, request_id, attempts")
      .eq("id", jobId)
      .maybeSingle();
    if (fetchError || !jobRow) return jsonResponse({ ok: false, reason: "job not found" }, 200);

    const storedToken = (jobRow.payload as Record<string, unknown>)?.webhook_token;
    if (!storedToken || storedToken !== token) {
      console.error("[job-webhook] token mismatch for job", jobId);
      return jsonResponse({ ok: false, reason: "invalid token" }, 200);
    }

    if (jobRow.status !== "running") {
      return jsonResponse({ ok: true, reason: "job already finalized", status: jobRow.status }, 200);
    }

    let webhookBody: { status?: string; payload?: unknown; payload_error?: string } | null = null;
    try {
      webhookBody = await req.json();
    } catch {
      webhookBody = null; // No/invalid body — e.g. a manual GET-style ping. Fall back below.
    }

    const fromBody = await finalizeFromWebhookPayload(adminClient, jobRow as BackgroundJobRow, webhookBody);
    if (fromBody) {
      return jsonResponse({ ok: true, source: "webhook_body", ...fromBody }, 200);
    }

    const outcome = await reconcileJob(adminClient, jobRow as BackgroundJobRow);
    return jsonResponse({ ok: true, source: "refetch", ...outcome }, 200);
  } catch (error) {
    console.error("[job-webhook] error:", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 200);
  }
});
