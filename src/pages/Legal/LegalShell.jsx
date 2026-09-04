/**
 * LegalShell.jsx — the chrome every published legal document shares.
 *
 * Deliberately a SERVER component, and deliberately not wrapped in
 * NextPublicProviders. These pages are read by two audiences who are badly
 * served by a client-rendered page:
 *
 *   1. Platform review teams (Meta, TikTok, LinkedIn, Google/YouTube) open the
 *      URL you put on the application form. It must render on first paint,
 *      with no auth check, no query client, and no loading overlay in front of
 *      the text they are there to read.
 *   2. Crawlers, which are what makes the URL verifiable at all.
 *
 * Pulling in the auth provider would gate a public document behind a session
 * lookup for no benefit. There is nothing on these pages that depends on who
 * is reading them, so nothing here ships JavaScript.
 */

import Link from "next/link";
import { StudioMark } from "../../ui-v2/brand/StudioMark";
import { LEGAL_DOCS, otherLegalDocs } from "./legalDocs";
import styles from "./Legal.module.css";

/**
 * @param {object}   props
 * @param {string}   props.slug      Which document this is; drives the cross-links.
 * @param {string}   props.eyebrow   Small uppercase kicker above the title.
 * @param {string}   props.title     Document title.
 * @param {string}   props.lede      One-sentence description under the title.
 * @param {Array<{label: string, value: string}>} props.meta   The three-up fact strip.
 * @param {Array<{id: string, label: string}>}    props.contents Section anchors.
 */
export default function LegalShell({
  slug,
  eyebrow,
  title,
  lede,
  meta,
  contents,
  // "The rest of the agreement" is right on a binding document and wrong on the
  // data-deletion instructions page, which is not part of the contract.
  crossLabel = "The rest of the agreement",
  children,
}) {
  const others = otherLegalDocs(slug);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link href="/" className={styles.brand}>
            <StudioMark size={22} tone="light" decorative />
            <span>Brandosse</span>
          </Link>
          <Link href="/" className={styles.backLink}>
            Back to Brandosse
          </Link>
        </div>
      </header>

      <div className={styles.layout}>
        {/* Sticky contents rail. Below 1040px this is hidden with display:none
            and the inline contents block inside the document takes over — which
            also keeps it out of the accessibility tree, so a screen reader is
            never offered the same table of contents twice. */}
        <div className={styles.rail}>
          <nav aria-labelledby="legal-toc-label">
            <p className={styles.railLabel} id="legal-toc-label">
              Contents
            </p>
            <ul className={styles.railList}>
              {contents.map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`}>{entry.label}</a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="legal-docs-label">
            <p className={styles.railLabel} id="legal-docs-label">
              All documents
            </p>
            <ul className={styles.railDocs}>
              {LEGAL_DOCS.map((doc) =>
                doc.slug === slug ? (
                  <li key={doc.slug}>
                    <span className={styles.railDocsCurrent} aria-current="page">
                      {doc.navLabel}
                    </span>
                  </li>
                ) : (
                  <li key={doc.slug}>
                    <Link href={`/${doc.slug}`}>{doc.navLabel}</Link>
                  </li>
                ),
              )}
            </ul>
          </nav>
        </div>

        <main className={styles.doc}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.lede}>{lede}</p>

          <div className={styles.metaGrid}>
            {meta.map((item) => (
              <div key={item.label}>
                <p className={styles.metaLabel}>{item.label}</p>
                <p className={styles.metaValue}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Contents, inline, for the widths where the rail is hidden. */}
          <nav className={styles.tocInline} aria-labelledby="legal-toc-inline-label">
            <p className={styles.railLabel} id="legal-toc-inline-label">
              Contents
            </p>
            <ul className={styles.tocInlineList}>
              {contents.map((entry, index) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`}>
                    {index + 1}. {entry.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <hr className={styles.rule} />

          {children}

          <section className={styles.crossLinks} aria-label="Related documents">
            <p className={styles.crossLinksLabel}>{crossLabel}</p>
            <ul className={styles.crossGrid}>
              {others.map((doc) => (
                <li key={doc.slug}>
                  <Link href={`/${doc.slug}`} className={styles.crossCard}>
                    <span className={styles.crossCardTitle}>{doc.title}</span>
                    <span className={styles.crossCardNote}>{doc.note}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>Brandosse — {title}</span>
          <span>Lordsway Energy Limited · Lagos, Nigeria</span>
        </div>
      </footer>
    </div>
  );
}
