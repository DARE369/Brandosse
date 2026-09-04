/**
 * legalDocs.js — the registry of published legal documents.
 *
 * One list, because these five documents cite each other constantly: the Terms
 * incorporate the Acceptable Use and Refund policies, the Privacy Policy says
 * the Subprocessors list "forms part of this policy", and every page carries a
 * cross-link block to the other four. Hard-coding "/acceptable-use" at each of
 * those call sites is how one gets renamed and the other twelve start 404ing.
 *
 * scripts/check-legal-pages.cjs asserts that every slug here has a real route
 * under app/(legal)/ and that no page links to a slug that is not in this list.
 *
 * The dates are the ones on the documents themselves, not build timestamps —
 * an effective date that moved every deploy would be meaningless.
 *
 * `updated` is the human string shown on the page; `updatedISO` is the same
 * date for machines (the sitemap's <lastmod>). Both are stored rather than one
 * derived from the other, because `new Date("12 August 2026")` parses as local
 * midnight and serialises to the PREVIOUS day in any timezone east of UTC —
 * which is exactly what the sitemap was emitting before this field existed.
 *
 * ── `kind` ─────────────────────────────────────────────────────────────────
 * "agreement"    — a binding document. These four-plus-one cite each other and
 *                  make up the contract; only these appear in the "rest of the
 *                  agreement" cross-links and in Terms 21.1's entire-agreement
 *                  clause.
 * "instructions" — a required public page that is NOT part of the contract.
 *                  Data deletion is here because Meta App Review demands a
 *                  standalone "Data Deletion Instructions URL" separate from
 *                  the Privacy Policy URL, and TikTok and LinkedIn ask the same
 *                  question in different words. Listing it as an agreement
 *                  document would misstate what it is; leaving it out of the
 *                  registry entirely would drop it from the footer, the
 *                  sitemap, and the guard.
 */

export const LEGAL_DOCS = [
  {
    kind: "agreement",
    slug: "terms",
    title: "Terms of Service",
    navLabel: "Terms of Service",
    note: "The contract between you and us.",
    description:
      "The agreement between you and Lordsway Energy Limited governing your use of Brandosse — credits, content ownership, AI output, publishing, and liability.",
    effective: "25 April 2026",
    updated: "12 August 2026",
    updatedISO: "2026-08-12",
  },
  {
    kind: "agreement",
    slug: "privacy",
    title: "Privacy Policy",
    navLabel: "Privacy Policy",
    note: "What we collect, and who it reaches.",
    description:
      "How Lordsway Energy Limited collects, uses and protects personal data in Brandosse, including what is sent to third-party AI providers and where it is processed.",
    effective: "27 August 2026",
    updated: "27 August 2026",
    updatedISO: "2026-08-27",
  },
  {
    kind: "agreement",
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    navLabel: "Acceptable Use Policy",
    note: "What you may not do with the Service.",
    description:
      "The conduct rules for Brandosse: prohibited content, misuse of AI generation, rules on depicting real people, source material, and platform conduct.",
    effective: "27 August 2026",
    updated: "27 August 2026",
    updatedISO: "2026-08-27",
  },
  {
    kind: "agreement",
    slug: "refunds",
    title: "Refund and Credits Policy",
    navLabel: "Refund and Credits Policy",
    note: "How credits, expiry and refunds work.",
    description:
      "How Brandosse credits are consumed and expire, when they are restored automatically, and how to request a refund.",
    effective: "27 August 2026",
    updated: "27 August 2026",
    updatedISO: "2026-08-27",
  },
  {
    kind: "agreement",
    slug: "subprocessors",
    title: "Subprocessors",
    navLabel: "Subprocessors",
    note: "Every third party that touches your data.",
    description:
      "The third-party providers that process personal data on behalf of Brandosse — infrastructure, AI model providers, publishing, email, error monitoring and payments.",
    effective: "27 August 2026",
    updated: "27 August 2026",
    updatedISO: "2026-08-27",
  },
  {
    kind: "instructions",
    slug: "data-deletion",
    title: "Data Deletion",
    navLabel: "Data Deletion",
    note: "How to delete your account and data.",
    description:
      "How to request deletion of your Brandosse account and personal data, what is removed, what is retained and why, and how long it takes.",
    effective: "27 August 2026",
    updated: "27 August 2026",
    updatedISO: "2026-08-27",
  },
];

/** Look a document up by slug. Returns undefined for an unknown slug. */
export function getLegalDoc(slug) {
  return LEGAL_DOCS.find((doc) => doc.slug === slug);
}

/**
 * The binding documents only. Terms 21.1 names exactly these as the entire
 * agreement, so the cross-link block must not quietly add a sixth item that
 * the contract does not incorporate.
 */
export function agreementDocs() {
  return LEGAL_DOCS.filter((doc) => doc.kind === "agreement");
}

/** The other agreement documents, for the cross-link block at the foot of a page. */
export function otherLegalDocs(slug) {
  return agreementDocs().filter((doc) => doc.slug !== slug);
}

/** Registered entity details, stated identically on every document. */
export const ENTITY = {
  name: "Lordsway Energy Limited",
  addressLines: ["8 Venia Place, Lekki Phase 1", "Lagos, Nigeria"],
  privacyEmail: "privacy@brandosse.com",
  securityEmail: "security@brandosse.com",
  supportEmail: "support@brandosse.com",
  legalEmail: "legal@brandosse.com",
  abuseEmail: "abuse@brandosse.com",
};
