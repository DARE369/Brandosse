/**
 * GET /api/auth/zernio/available
 *
 * Returns whether the Zernio unified publishing API is configured. The
 * frontend checks this before /api/auth/oauth/available (direct-OAuth,
 * per-platform) — Zernio covers 15 platforms with one key, so it's the
 * first-choice provider when available.
 */
export async function GET() {
  return Response.json({ available: Boolean(process.env.ZERNIO_API_KEY) });
}
