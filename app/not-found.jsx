import NextPublicProviders from "@/next/NextPublicProviders";
import NotFoundPage from "@/pages/NotFoundPage";

/**
 * The 404 route.
 *
 * ── Why this replaced app/[...path]/page.jsx ───────────────────────────────
 * A catch-all `[...path]` segment MATCHES every unknown URL, so Next treated
 * every 404 as a successful render and answered **HTTP 200** with the
 * not-found page in the body. A soft 404.
 *
 * That is not a cosmetic bug. Before the legal pages shipped,
 * https://www.brandosse.com/terms returned 200 with "404 — the page you're
 * looking for" in the body, and so did /robots.txt and /sitemap.xml. Meta,
 * TikTok and LinkedIn all run an automated reachability check on the policy
 * URLs submitted for app review: that check sees 200 and passes, and then a
 * human opens the same URL and reads "page not found". Search engines treat a
 * soft 404 the same way — they index the error page instead of dropping it.
 *
 * app/not-found.jsx is the framework's own answer: Next renders it for any
 * unmatched route AND for any explicit notFound() call, and it sets a real 404
 * status. Same component, same providers, correct status code.
 *
 * scripts/check-legal-pages.cjs asserts the catch-all has not come back.
 */
export default function NotFound() {
  return (
    <NextPublicProviders>
      <NotFoundPage />
    </NextPublicProviders>
  );
}
