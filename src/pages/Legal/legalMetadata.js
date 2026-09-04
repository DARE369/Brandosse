/**
 * legalMetadata.js — Next.js metadata for the five legal routes.
 *
 * One builder rather than five hand-written metadata objects, because these
 * URLs are pasted into platform application forms (Meta, TikTok, LinkedIn,
 * Google) and a reviewer's first signal is what the page reports itself to be.
 * The three things that matter there are the title, a description that says
 * what the document is, and a canonical URL that resolves — all of which come
 * from the same registry that drives the pages themselves.
 *
 * robots: index, follow is explicit. These pages exist to be found; a legal
 * document nobody can reach from a crawl is not published in any useful sense.
 */

import { getLegalDoc } from "./legalDocs";

/**
 * The public origin. NEXT_PUBLIC_APP_URL is the repo's existing convention
 * (.env.example:26).
 *
 * ── Why localhost is refused in a production build ─────────────────────────
 * .env.local sets NEXT_PUBLIC_APP_URL to http://localhost:3000, which is
 * correct for development and catastrophic if it reaches a production build:
 * every canonical tag, every Open Graph URL and every sitemap entry would
 * point at localhost. A platform reviewer following the canonical would get
 * nothing, and a crawler would drop the pages.
 *
 * That is not a hypothetical — the variable is already localhost on this
 * machine, and the same file shape is what gets copied into a host's
 * environment settings. So in production a localhost value is treated as
 * absent rather than obeyed. In development it is used as-is, because there
 * localhost is the truth.
 */
const RAW_ORIGIN = process.env.NEXT_PUBLIC_APP_URL;
const PRODUCTION_ORIGIN = "https://brandosse.com";

const looksLocal = !RAW_ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(RAW_ORIGIN);

export const SITE_ORIGIN =
  process.env.NODE_ENV === "production" && looksLocal
    ? PRODUCTION_ORIGIN
    : RAW_ORIGIN || PRODUCTION_ORIGIN;

/** Build the Next.js `metadata` export for one legal document. */
export function legalMetadata(slug) {
  const doc = getLegalDoc(slug);

  if (!doc) {
    throw new Error(
      `legalMetadata("${slug}"): no such document. Add it to LEGAL_DOCS in legalDocs.js first.`,
    );
  }

  const url = `${SITE_ORIGIN}/${doc.slug}`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: `${doc.title} — Brandosse`,
    description: doc.description,
    alternates: { canonical: url },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: "article",
      siteName: "Brandosse",
      title: `${doc.title} — Brandosse`,
      description: doc.description,
      url,
    },
    twitter: {
      card: "summary",
      title: `${doc.title} — Brandosse`,
      description: doc.description,
    },
  };
}

/**
 * Metadata for the /legal hub, which is an index rather than a registered
 * document and therefore has no LEGAL_DOCS entry to build from.
 */
export function legalHubMetadata() {
  const url = `${SITE_ORIGIN}/legal`;
  const title = "Legal — Brandosse";
  const description =
    "Every policy and agreement governing your use of Brandosse: terms of service, privacy, acceptable use, refunds, subprocessors, and how to delete your data.";

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: "website", siteName: "Brandosse", title, description, url },
    twitter: { card: "summary", title, description },
  };
}
