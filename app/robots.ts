import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/pages/Legal/legalMetadata";

/**
 * robots.txt.
 *
 * Added with the legal pages, because a legal document that crawlers cannot
 * reach is not published in any useful sense — and the platform review teams
 * whose forms these URLs go on do check that the URL resolves publicly.
 *
 * The disallow list is the signed-in product, not the marketing surface. Those
 * routes are behind auth anyway; keeping them out of the index stops search
 * results pointing at a login redirect.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app/", "/api/", "/auth/", "/monitoring", "/review/", "/join/", "/select-context"],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    // No `host` directive. It is a non-standard Yandex extension that expects
    // a bare hostname, and Next emits whatever it is given — so passing an
    // origin here writes "Host: https://brandosse.com", which is malformed.
  };
}
