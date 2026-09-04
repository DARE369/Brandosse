/**
 * LegalIndex.jsx — the /legal hub.
 *
 * Exists for three reasons, none of them decorative:
 *
 *   1. Some platform application forms ask for a single "legal" or "policies"
 *      URL rather than one field per document. Without a hub the only honest
 *      answer is to paste /terms and hope the reviewer finds the rest.
 *   2. The signed-in app needs ONE target to link to from the account menu.
 *      Five entries in a dropdown is a menu nobody reads; one is a menu item.
 *   3. It is the natural landing place for someone who types brandosse.com/legal
 *      by habit — which, before this, hit the catch-all and rendered a 404 page
 *      under an HTTP 200.
 *
 * Built from LEGAL_DOCS, so a new document appears here the moment it is
 * registered. Nothing about this page is hand-maintained.
 */

import Link from "next/link";
import { StudioMark } from "../../ui-v2/brand/StudioMark";
import { LEGAL_DOCS } from "./legalDocs";
import styles from "./Legal.module.css";

const GROUPS = [
  {
    kind: "agreement",
    label: "The agreement",
    blurb:
      "These five documents together are the contract between you and Lordsway Energy Limited. Each one incorporates the others by reference.",
  },
  {
    kind: "instructions",
    label: "How to",
    blurb: "Not part of the contract — practical instructions for exercising your rights.",
  },
];

export default function LegalIndex() {
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

      <div className={styles.indexLayout}>
        <main className={styles.doc}>
          <p className={styles.eyebrow}>Legal</p>
          <h1 className={styles.title}>Policies and agreements</h1>
          <p className={styles.lede}>
            Everything governing your use of Brandosse, in one place. Written to be read, not to be
            survived.
          </p>

          <div className={styles.metaGrid}>
            <div>
              <p className={styles.metaLabel}>Entity</p>
              <p className={styles.metaValue}>Lordsway Energy Limited</p>
            </div>
            <div>
              <p className={styles.metaLabel}>Governing law</p>
              <p className={styles.metaValue}>Nigeria — Lagos State courts</p>
            </div>
            <div>
              <p className={styles.metaLabel}>Privacy contact</p>
              <p className={styles.metaValue}>privacy@brandosse.com</p>
            </div>
          </div>

          {GROUPS.map((group) => {
            const docs = LEGAL_DOCS.filter((doc) => doc.kind === group.kind);
            if (docs.length === 0) return null;

            return (
              <section className={styles.section} key={group.kind}>
                <h2 className={styles.h2}>{group.label}</h2>
                <p>{group.blurb}</p>
                <ul className={styles.indexList}>
                  {docs.map((doc) => (
                    <li key={doc.slug}>
                      <Link href={`/${doc.slug}`} className={styles.indexCard}>
                        <span className={styles.indexCardTitle}>{doc.title}</span>
                        <span className={styles.indexCardNote}>{doc.note}</span>
                        <span className={styles.indexCardMeta}>
                          Effective {doc.effective}
                          {doc.updated !== doc.effective ? ` · Updated ${doc.updated}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <section className={styles.section}>
            <h2 className={styles.h2}>Getting in touch</h2>
            <div className={styles.contactGrid}>
              <div>
                <p className={styles.metaLabel}>Registered office</p>
                <p>
                  Lordsway Energy Limited
                  <br />
                  8 Venia Place, Lekki Phase 1
                  <br />
                  Lagos, Nigeria
                </p>
              </div>
              <div>
                <p className={styles.metaLabel}>Contact</p>
                <p>
                  Legal — <a href="mailto:legal@brandosse.com">legal@brandosse.com</a>
                  <br />
                  Privacy — <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>
                  <br />
                  Security — <a href="mailto:security@brandosse.com">security@brandosse.com</a>
                  <br />
                  Abuse — <a href="mailto:abuse@brandosse.com">abuse@brandosse.com</a>
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>Brandosse — Legal</span>
          <span>Lordsway Energy Limited · Lagos, Nigeria</span>
        </div>
      </footer>
    </div>
  );
}
