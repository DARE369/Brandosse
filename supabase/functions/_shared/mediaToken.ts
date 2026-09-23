// supabase/functions/_shared/mediaToken.ts
//
// The Deno twin of app/api/_lib/mediaToken.js. This side MINTS; the Next.js
// route VERIFIES. Both must produce byte-identical signatures over the same
// payload, or every TikTok photo post fails with a 403 from our own proxy —
// and the symptom would look like TikTok rejecting the image.
// scripts/check-media-token-parity.cjs asserts they agree.
//
// Why a proxy exists at all: TikTok photo posts are PULL_FROM_URL only, TikTok
// fetches the bytes itself with no credential of ours, and the docs require
// that the developer "verify the ownership of the URL prefix or domain". Our
// media lives on <project>.supabase.co, which we can never verify — so the
// bytes must come from brandosse.com.

/** How long a minted token stays valid. TikTok fetches within seconds. */
export const MEDIA_TOKEN_TTL_SECONDS = 1800; // 30 minutes

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getSecret(): string {
  const secret = Deno.env.get("MEDIA_PROXY_SECRET") || "";
  // Fail closed, and say which side is unconfigured. A photo post that dies
  // here has a fixable cause; one that dies at TikTok with a fetch error does
  // not look like our problem at all.
  if (secret.length < 32) {
    throw new Error(
      "MEDIA_PROXY_SECRET is missing or shorter than 32 characters in the edge "
      + "function environment, so no photo URL can be signed. Set it with: "
      + "npx supabase secrets set MEDIA_PROXY_SECRET=… (the SAME value as Vercel).",
    );
  }
  return secret;
}

/**
 * Mint a token naming ONE generation, for ONE post, with an expiry.
 *
 * Never a path or a bucket: the proxy must not be steerable at another object.
 */
export async function createMediaToken(
  { generationId, postId, ttlSeconds = MEDIA_TOKEN_TTL_SECONDS }:
  { generationId: string; postId?: string | null; ttlSeconds?: number },
): Promise<string> {
  if (!generationId) throw new Error("createMediaToken: generationId is required");

  const payload = JSON.stringify({
    g: String(generationId),
    p: postId ? String(postId) : null,
    exp: Math.floor(Date.now() / 1000) + Number(ttlSeconds || MEDIA_TOKEN_TTL_SECONDS),
  });
  const payloadB64 = base64url(new TextEncoder().encode(payload));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));

  return `${payloadB64}.${base64url(new Uint8Array(signature))}`;
}

/** The public URL TikTok will fetch. `appUrl` must be the verified domain. */
export function mediaProxyUrl(appUrl: string, token: string): string {
  const base = String(appUrl || "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) {
    throw new Error(
      `The media proxy URL must be https on the domain verified with TikTok; got "${base}". `
      + "Set APP_URL in the edge function environment.",
    );
  }
  return `${base}/api/media/tiktok/${token}`;
}
