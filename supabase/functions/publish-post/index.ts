/**
 * publish-post — unified publish endpoint (real + mock)
 *
 * Routes automatically:
 *   account.is_mock = true  → mock flow (mockPublish.ts)
 *   account.is_mock = false → real platform API via Zernio (zernio.service.ts)
 *
 * Called by:
 *   - The scheduled-publish SQL worker (service-role, via pg_net)
 *   - Manual publish actions in the UI (user JWT)
 *
 * On success:  post.status → "published", external_post_id saved (platform post
 *              URL saved under workflow_state.publish.platform_post_url — posts
 *              has no dedicated column for it)
 * On failure:  post.status → "failed", error_message saved, retry count
 *              tracked under workflow_state.publish.retry_count
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { requireInvokeSecret, presentsInvokeSecret } from "../_shared/connectionHelpers.ts";
import { createHttpError, requireActiveOrgMember } from "../_shared/org.ts";
import { runMockPublish } from "../_shared/mockPublish.ts";
import { publishToZernio } from "../_shared/zernio.service.ts";
import { publishToLinkedIn } from "../_shared/linkedin.service.ts";
import { publishToTikTok } from "../_shared/tiktok.service.ts";
import { publishToYouTube } from "../_shared/youtube.service.ts";

type PublishRequest = {
  post_id: string;
  connected_account_id: string;
  user_id?: string | null;
  organization_id?: string | null;
  publish_request_id?: string | null;
};

const MAX_RETRIES = 3;

// A machine caller (the scheduler) presents the shared invoke secret; a person
// presents their own JWT. Both remain supported — this only changes what a
// MACHINE must show, which is the half that had been failing.
function isMachineCaller(req: Request) {
  return presentsInvokeSecret(req);
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createAdminClient();
    let requesterId: string | null = null;

    if (isMachineCaller(req)) {
      requireInvokeSecret(req);
    } else {
      const authClient = createAuthClient(req.headers.get("Authorization"));
      const user = await requireUser(authClient);
      requesterId = user.id;
    }

    const body = await parseJsonBody<PublishRequest>(req);
    const postId = String(body.post_id || "").trim();
    const connectedAccountId = String(body.connected_account_id || "").trim();
    const publishRequestId = body.publish_request_id ?? null;

    if (!postId || !connectedAccountId) {
      return jsonResponse({ error: "post_id and connected_account_id are required" }, 400);
    }

    // ── Fetch account + post ──────────────────────────────────────────────────

    const { data: account, error: acctErr } = await adminClient
      .from("connected_accounts")
      .select("*")
      .eq("id", connectedAccountId)
      .maybeSingle();

    if (acctErr) throw acctErr;
    if (!account) throw createHttpError("Connected account not found", 404);

    const { data: post, error: postErr } = await adminClient
      .from("posts")
      .select(`
        id, user_id, organization_id, title, caption, platform, status,
        scheduled_at, hashtags, workflow_state,
        generations ( id, storage_path, media_type, output_url, metadata )
      `)
      .eq("id", postId)
      .maybeSingle();

    if (postErr) throw postErr;
    if (!post) throw createHttpError("Post not found", 404);

    const postOrgId = post.organization_id ?? null;
    const accountOrgId = account.organization_id ?? null;
    const accountScope = String(account.scope || "personal").trim().toLowerCase();
    const accountIsOrgScoped = accountScope === "organization" || Boolean(accountOrgId);
    const postPlatform = String(post.platform || "").trim().toLowerCase();
    const accountPlatform = String(account.platform || "").trim().toLowerCase();

    if (requesterId) {
      if (postOrgId) {
        await requireActiveOrgMember(adminClient, postOrgId, requesterId);
      } else if (post.user_id !== requesterId || account.user_id !== requesterId) {
        throw createHttpError("Forbidden", 403);
      }
    }

    if (!postOrgId && account.user_id !== post.user_id) {
      throw createHttpError("Personal connected account does not belong to the post owner", 400);
    }
    if (postOrgId && (!accountIsOrgScoped || accountOrgId !== postOrgId)) {
      throw createHttpError("Connected account organization does not match the post organization", 400);
    }
    if (!postOrgId && accountIsOrgScoped) {
      throw createHttpError("Organization connected accounts cannot publish personal posts", 400);
    }
    if (postPlatform && accountPlatform && postPlatform !== accountPlatform) {
      throw createHttpError("Connected account platform does not match the post platform", 400);
    }

    // Guard: don't double-publish
    if (post.status === "published") {
      return jsonResponse({ success: true, message: "Post already published", postId });
    }

    // ── Mark as publishing ────────────────────────────────────────────────────

    await adminClient
      .from("posts")
      .update({ status: "publishing", updated_at: new Date().toISOString() })
      .eq("id", postId);

    // ── Resolve the media URL ─────────────────────────────────────────────────
    //
    // Two shapes reach this point:
    //   * a durable public URL in output_url (image generations live in the
    //     public `generations` bucket), used as-is; or
    //   * a storage_path into a PRIVATE bucket — every rendered video clip is in
    //     `video-clips`, which is not public.
    //
    // For the private case the signed URL is minted HERE, seconds before the
    // upload, and never stored. Storing one would be the quiet kind of bug this
    // codebase keeps producing: a post scheduled three weeks out would carry a
    // signature that expired days earlier, and the publish would fail with a 400
    // from storage that says nothing about why.
    //
    // The previous version fell back to `storage_path` directly, which is a bare
    // path like `<user>/<job>/clip_0.mp4` — not a URL at all. Anything consuming
    // it would have failed on the first fetch. That fallback simply had no caller
    // until now, because nothing linked a video to a post.

    // NB: the `as` must stay on this line — TypeScript forbids a line break
    // before it, and Deno reports that as a bare SyntaxError that stops the
    // whole type check, which then looks like zero errors.
    const rawGen = Array.isArray(post.generations) ? post.generations[0] : post.generations;
    const gen = rawGen as Record<string, unknown> | null;

    // 15 minutes: long enough for a large upload, short enough to be worthless
    // if it ever leaks into a log.
    const SIGNED_URL_TTL_SECONDS = 900;

    let mediaUrl: string | null = null;
    const declaredUrl = gen?.output_url as string | undefined;
    const storagePath = gen?.storage_path as string | undefined;

    if (declaredUrl && /^https?:\/\//i.test(declaredUrl)) {
      mediaUrl = declaredUrl;
    } else if (storagePath) {
      // Which bucket the path belongs to is recorded by whoever created the
      // generation. Defaulting to `generations` keeps every pre-existing image
      // row working unchanged.
      const meta = (gen?.metadata && typeof gen.metadata === "object")
        ? gen.metadata as Record<string, unknown>
        : {};
      const bucket = String(meta.storage_bucket || "generations");

      const { data: signed, error: signErr } = await adminClient
        .storage.from(bucket).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

      if (signErr || !signed?.signedUrl) {
        // Loud, and specific about which bucket and path failed. A generic
        // "could not read the video" here would send someone to the platform
        // adapter, which is the wrong place entirely.
        console.error(
          `[publish-post] could not sign ${bucket}/${storagePath}:`,
          signErr?.message ?? "no signedUrl returned",
        );
      } else {
        mediaUrl = signed.signedUrl;
      }
    }

    // ── Route: mock or real ───────────────────────────────────────────────────

    let result;

    if (account.is_mock) {
      // Mock publish flow — runMockPublish() already writes posts.status/
      // published_at/platform/account_id (and mock_publish_logs, and
      // connected_accounts) itself; do not update posts again here. An
      // earlier version of this function did a second, redundant posts
      // update referencing platform_post_id/platform_post_url/
      // failure_reason, none of which exist on posts (confirmed via live
      // schema introspection 2026-07-10) — that update was silently failing
      // on every mock-routed call through this endpoint.
      result = await runMockPublish({
        adminClient,
        account,
        post,
        mediaUrl,
        publishRequestId: publishRequestId as string | null,
      });

    } else {
      // Real platform publish — routed by provider.
      //
      // Direct per-platform OAuth is replacing Zernio one platform at a time,
      // so both paths are live during the migration. LinkedIn, TikTok and
      // YouTube have adapters; Meta is the last one still on Zernio.
      //
      // The previous version of this branch refused ANY provider other than
      // "zernio", which was correct then (the old direct path had no
      // credentials and could never publish) and is wrong now.
      //
      // NOTE what this does NOT consult: connected_accounts_health_summary's
      // can_publish. Dispatch is by provider alone. That is why the
      // publish_providers registry has to be kept honest — a provider with a
      // working adapter but is_supported = false publishes fine here while the
      // UI tells the user the account cannot publish (which is exactly what
      // TikTok did until 20260909160000).
      const provider = String(account.provider || "").trim().toLowerCase();

      if (provider === "linkedin" || provider === "tiktok" || provider === "youtube") {
        // Secrets live in their own table with no client grant (defect D1,
        // migration 20260904120000). Only service-role reaches it, which is
        // exactly the context this function runs in.
        const { data: secret, error: secretErr } = await adminClient
          .from("connected_account_secrets")
          .select("access_token_ciphertext, refresh_token_ciphertext, expires_at, granted_scopes")
          .eq("connected_account_id", connectedAccountId)
          .maybeSingle();

        if (secretErr) throw secretErr;

        // Per-post platform settings live under workflow_state.<provider>.
        // Read once here rather than in each branch: workflow_state is shared
        // with approval routing and publish accounting, and every reader of it
        // in this repo has to treat it as a shared object (see the defect where
        // a bare assignment replaced it wholesale — handoff 2026-09-09 §4.2).
        const workflow = (post.workflow_state && typeof post.workflow_state === "object")
          ? post.workflow_state as Record<string, unknown>
          : {};
        const optionsFor = (key: string): Record<string, unknown> | null =>
          (workflow[key] && typeof workflow[key] === "object")
            ? workflow[key] as Record<string, unknown>
            : null;

        if (provider === "linkedin") {
          result = await publishToLinkedIn({ post, account, secret, mediaUrl });
        } else if (provider === "youtube") {
          // Unlike TikTok, YouTube's guidelines do not require the user to pick
          // a visibility, so the adapter defaults to `private` and SAYS SO in
          // its note rather than refusing. Private is both the safe direction
          // and, before the compliance audit, what YouTube enforces anyway.
          result = await publishToYouTube({
            post, account, secret, mediaUrl, options: optionsFor("youtube"),
          });
        } else {
          // TikTok's per-post settings — privacy level, interaction toggles,
          // commercial disclosure — are collected by TikTokOptionsPanel and
          // stored on the post. They are NOT defaulted here: TikTok's
          // guidelines require the user to choose the privacy level, and the
          // adapter refuses to publish without one rather than invent a
          // visibility the user never agreed to.
          // mediaType and the generation id decide which TikTok API is used:
          // video uploads bytes, photo hands TikTok a URL on our verified
          // domain to pull from (see tiktok.service.ts).
          result = await publishToTikTok({
            post,
            account,
            secret,
            mediaUrl,
            options: optionsFor("tiktok"),
            mediaType: (gen?.media_type as string | undefined) ?? null,
            generationId: (gen?.id as string | undefined) ?? null,
          });
        }

      } else if (provider === "" || provider === "zernio") {
        result = await publishToZernio({ post, account, mediaUrl });

      } else {
        // A provider we have no adapter for. Fail loudly and specifically —
        // never silently, and never as a generic error that reads like the
        // platform's fault.
        result = {
          success: false,
          platformPostId: null,
          platformPostUrl: null,
          failureReason:
            `No publishing adapter for provider "${account.provider}". ` +
            "Reconnect this account.",
          retriable: false,
        };
      }

      // posts has no consecutive_failure_count/last_failure_at/
      // platform_post_url columns (confirmed via live schema introspection
      // 2026-07-10 — an earlier version of this function assumed columns
      // from a migration that never actually ran against the live DB).
      // external_post_id and error_message are the real equivalents of
      // platform_post_id/failure_reason. Retry count and the platform post
      // URL have no dedicated column, so they're tracked inside
      // workflow_state, the same flexible jsonb column posts already uses
      // for other workflow bookkeeping.
      const existingWorkflowState = (post.workflow_state && typeof post.workflow_state === "object")
        ? post.workflow_state as Record<string, unknown>
        : {};
      const existingPublish = (existingWorkflowState.publish && typeof existingWorkflowState.publish === "object")
        ? existingWorkflowState.publish as Record<string, unknown>
        : {};

      if (!result.success && result.retriable) {
        // Increment retry counter; caller (cron) will retry later
        const retries = Number(existingPublish.retry_count ?? 0) + 1;
        await adminClient
          .from("posts")
          .update({
            status: retries >= MAX_RETRIES ? "failed" : "scheduled",
            error_message: result.failureReason,
            workflow_state: {
              ...existingWorkflowState,
              publish: { ...existingPublish, retry_count: retries, last_failure_at: new Date().toISOString() },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", postId);
      } else {
        await adminClient
          .from("posts")
          .update({
            status: result.success ? "published" : "failed",
            external_post_id: result.platformPostId,
            error_message: result.failureReason,
            published_at: result.success ? new Date().toISOString() : null,
            failed_at: result.success ? null : new Date().toISOString(),

            // ── Record WHICH account this went to ─────────────────────────────
            //
            // posts.platform and posts.account_id were never written on the real
            // publish path — only runMockPublish set them. So a mock post
            // recorded MORE than a real one, and the first genuine upload
            // (video vjuIoPzSVcc, 2026-09-10) landed with both NULL despite
            // having an external_post_id.
            //
            // Two consequences, neither visible at publish time:
            //   * analytics cannot tell which channel a published post belongs
            //     to, so per-post metrics have nothing to attribute to an
            //     account or a token; and
            //   * the post's own history cannot answer "where did this go?"
            //     once a user has more than one account on a platform.
            //
            // Written on failure too, deliberately. A failed attempt against a
            // specific account is exactly what someone debugging needs to see.
            platform: String(account.platform || "").toLowerCase() || null,
            account_id: connectedAccountId,
            workflow_state: {
              ...existingWorkflowState,
              publish: {
                ...existingPublish,
                platform_post_url: result.platformPostUrl,
                // Persisted so a caveat survives regardless of HOW this ran.
                // Before this, `note` only reached the synchronous HTTP
                // response body: QuickPostComposer.jsx:937 reads it for an
                // immediate "Publish now", but dispatch_scheduled_post's cron
                // path calls this function with PERFORM net.http_post(...),
                // which discards the response outright. Every note this
                // adapter has ever returned — "published as private because
                // no visibility was chosen", "no synthetic-media disclosure
                // set" — was silently lost for every SCHEDULED YouTube post.
                // Found 2026-09-22 while wiring the custom-thumbnail note
                // through this same path; the gap predates thumbnails
                // entirely and applied to every existing note.
                note: result.note ?? null,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", postId);

        // Update account health + token
        if (result.success) {
          await adminClient
            .from("connected_accounts")
            .update({
              last_successful_publish_at: new Date().toISOString(),
              consecutive_failure_count: 0,
              total_posts_published: (account.total_posts_published || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", connectedAccountId);
        } else {
          const failures = (account.consecutive_failure_count || 0) + 1;
          await adminClient
            .from("connected_accounts")
            .update({
              consecutive_failure_count: failures,
              last_failure_at: new Date().toISOString(),
              last_failure_reason: result.failureReason,
              health_score: Math.max(0, (account.health_score || 100) - 15),
              updated_at: new Date().toISOString(),
            })
            .eq("id", connectedAccountId);
        }
      }
    }

    return jsonResponse({
      success: result.success,
      postId,
      platformPostId: result.success
        ? (account.is_mock ? result.mockPostId : result.platformPostId)
        : null,
      platformPostUrl: result.success
        ? (account.is_mock ? result.mockPostUrl : result.platformPostUrl)
        : null,
      failureReason: result.failureReason,
      mode: account.is_mock ? "mock" : "real",
      note: account.is_mock ? null : (result.note ?? null),
    });

  } catch (error) {
    console.error("[publish-post] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
