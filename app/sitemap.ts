import type { MetadataRoute } from "next";
import { LEGAL_DOCS } from "@/pages/Legal/legalDocs";
import { SITE_ORIGIN } from "@/pages/Legal/legalMetadata";

/**
 * sitemap.xml — the public surface only.
 *
 * The legal routes are generated from LEGAL_DOCS rather than listed by hand,
 * so publishing a sixth document cannot leave it out of the sitemap.
 *
 * lastModified is the document's own "last updated" date, not the build time:
 * a legal document that reports itself as modified on every deploy is telling
 * crawlers something untrue. It reads updatedISO, not the display string —
 * parsing "12 August 2026" yields local midnight, which serialises to 11
 * August in any timezone east of UTC, including the one this is developed in.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const legal = LEGAL_DOCS.map((doc) => ({
    url: `${SITE_ORIGIN}/${doc.slug}`,
    lastModified: new Date(`${doc.updatedISO}T00:00:00Z`),
    changeFrequency: "yearly" as const,
    priority: 0.5,
  }));

  return [
    {
      url: SITE_ORIGIN,
      changeFrequency: "weekly" as const,
      priority: 1,
    },
    {
      url: `${SITE_ORIGIN}/register`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: `${SITE_ORIGIN}/login`,
      changeFrequency: "monthly" as const,
      priority: 0.3,
    },
    ...legal,
  ];
}
