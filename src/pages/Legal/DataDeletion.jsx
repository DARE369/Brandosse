/**
 * DataDeletion.jsx — the standalone data deletion instructions page.
 *
 * ── Why this exists as its own URL ─────────────────────────────────────────
 * Meta App Review asks for a "Data Deletion Instructions URL" as a field
 * SEPARATE from the Privacy Policy URL, and rejects a submission that points
 * both at the same page. TikTok and LinkedIn ask the same question in their
 * own words. Pointing at /privacy#your-rights would technically resolve, but a
 * reviewer landing two thirds of the way down a 13-section privacy policy and
 * having to hunt for the deletion paragraph is how a submission gets bounced.
 *
 * ── Why it says deletion is manual ─────────────────────────────────────────
 * Because it is. DataPrivacyTab.jsx writes a row to user_account_requests and
 * an administrator actions it; there is no automated hard-delete pipeline.
 * Privacy 8.3 already says so in those words, and this page must not quietly
 * upgrade that to a promise of instant deletion — an overstated deletion
 * claim is a misrepresentation to both the user and the reviewer reading it.
 *
 * Every retention figure below is the one in Privacy section 7. If that table
 * changes, this page changes in the same commit.
 */

import Link from "next/link";
import LegalShell from "./LegalShell";
import { getLegalDoc } from "./legalDocs";
import styles from "./Legal.module.css";

const DOC = getLegalDoc("data-deletion");

const CONTENTS = [
  { id: "how-to-delete", label: "How to delete your account" },
  { id: "what-happens", label: "What happens next" },
  { id: "what-is-deleted", label: "What gets deleted" },
  { id: "what-is-kept", label: "What we keep, and why" },
  { id: "connected-accounts", label: "Your connected social accounts" },
  { id: "partial-deletion", label: "Deleting individual items instead" },
  { id: "contact", label: "Questions" },
];

export default function DataDeletion() {
  return (
    <LegalShell
      slug="data-deletion"
      eyebrow="Data protection"
      title="Data Deletion"
      lede="How to delete your Brandosse account and personal data, what is removed, and how long it takes."
      crossLabel="The agreement"
      meta={[
        { label: "Effective date", value: DOC.effective },
        { label: "Last updated", value: DOC.updated },
        { label: "Data controller", value: "Lordsway Energy Limited" },
      ]}
      contents={CONTENTS}
    >
      <div className={`${styles.callout} ${styles.intro}`}>
        <p>
          <strong>The short version.</strong> Ask us in the app at{" "}
          <strong>Settings → Data and Privacy → Delete account</strong>, or email{" "}
          <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a> from your account address.
          We acknowledge within 72 hours and complete the deletion within 30 days.
        </p>
        <p>
          Deletion is handled by a person, not a button that wipes everything instantly. We would
          rather tell you that than imply otherwise.
        </p>
      </div>

      {/* ── 1 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="how-to-delete">
        <h2 className={styles.h2}>1. How to delete your account</h2>
        <p>There are two routes, and both reach the same place.</p>
        <p>
          <strong>1.1 In the app.</strong> Sign in and go to{" "}
          <strong>Settings → Data and Privacy</strong>. Under <strong>Delete account</strong>, confirm
          the request. You will see the request listed as pending until it is actioned, and you can
          cancel it from the same screen at any time before it completes.
        </p>
        <p>
          <strong>1.2 By email.</strong> Email{" "}
          <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>{" "}
          from the email address on the account and ask us to delete it. Use this route if you can no longer sign in. We will
          verify that you control the address before acting, because a deletion request we cannot
          attribute is a way to delete someone else&apos;s work.
        </p>
      </section>

      {/* ── 2 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="what-happens">
        <h2 className={styles.h2}>2. What happens next</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "34%" }}>Step</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>We record your request</td>
                <td className={styles.tdQuiet}>Immediately</td>
              </tr>
              <tr>
                <td>We acknowledge it by email</td>
                <td className={styles.tdQuiet}>Within 72 hours</td>
              </tr>
              <tr>
                <td>We confirm with you before anything is removed</td>
                <td className={styles.tdQuiet}>
                  Before deletion — this is deliberate, so an accidental or unauthorised request
                  cannot destroy your work
                </td>
              </tr>
              <tr>
                <td>Deletion is completed and confirmed by email</td>
                <td className={styles.tdQuiet}>Within 30 days of the request</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>Being plain about the mechanism.</strong> Export and deletion are request-based and
          fulfilled manually by our team; there is no automated pipeline behind the button yet. That
          is the same statement made in{" "}
          <Link href="/privacy#your-rights">Privacy Policy section 8.3</Link>, and it is the honest
          description of what happens.
        </p>
      </section>

      {/* ── 3 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="what-is-deleted">
        <h2 className={styles.h2}>3. What gets deleted</h2>
        <ul className={styles.bullets}>
          <li>Your account and sign-in credentials, including any Google sign-in link.</li>
          <li>Your profile and personal workspace.</li>
          <li>Your brand kits — logos, colours, fonts, tone-of-voice notes, product descriptions.</li>
          <li>Your uploads: images, video files and documents in your library.</li>
          <li>Your prompts, briefs, and everything the Service generated for you.</li>
          <li>Your content plans, schedules and calendar entries.</li>
          <li>
            Your connected social account records, including the stored access and refresh tokens.
          </li>
          <li>Any cached source material still held from a link you submitted.</li>
        </ul>
        <p>
          Anything not deleted within 30 days of account deletion is covered by section 4 below.
        </p>
      </section>

      {/* ── 4 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="what-is-kept">
        <h2 className={styles.h2}>4. What we keep, and why</h2>
        <p>
          Two categories survive account deletion. Both are kept because the law requires it, not
          because we want the data.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "34%" }}>What</th>
                <th style={{ width: "22%" }}>How long</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Credit ledger and transaction records</td>
                <td className={styles.tdQuiet}>7 years</td>
                <td className={styles.tdQuiet}>
                  Nigerian tax and accounting obligations. These are financial records of payments
                  made, not your content
                </td>
              </tr>
              <tr>
                <td>Security and access logs</td>
                <td className={styles.tdQuiet}>90 days</td>
                <td className={styles.tdQuiet}>
                  Abuse investigation and security incident response
                </td>
              </tr>
              <tr>
                <td>
                  Records we are required to keep for a legal, tax, security or dispute purpose
                </td>
                <td className={styles.tdQuiet}>As required</td>
                <td className={styles.tdQuiet}>
                  <Link href="/terms#termination">Terms section 15.4</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Everything else is deleted or de-identified within 30 days, as set out in{" "}
          <Link href="/privacy#retention">Privacy Policy section 7</Link>.
        </p>
      </section>

      {/* ── 5 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="connected-accounts">
        <h2 className={styles.h2}>5. Your connected social accounts</h2>
        <div className={`${styles.callout} ${styles.calloutStrict}`}>
          <p>
            <strong>Deleting your Brandosse account does not delete anything on Facebook,
            Instagram, TikTok, LinkedIn, X, YouTube, Pinterest or Threads.</strong> We delete the
            authorisation we hold and stop acting on your behalf. Posts already published to a
            platform belong to that platform&apos;s copy of your account, and only you can remove
            them there.
          </p>
        </div>
        <p>
          <strong>5.1 What we delete.</strong> The connection record and the access and refresh
          tokens we stored for it. Once deleted we can no longer read from or post to that account.
        </p>
        <p>
          <strong>5.2 What you should also do.</strong> Revoke Brandosse&apos;s access from the
          platform&apos;s own settings — every platform has an apps or connected-services screen —
          and delete any published posts you no longer want, on the platform itself.
        </p>
        <p>
          <strong>5.3 Disconnecting without deleting your account.</strong> You can remove a single
          connected account at any time from{" "}
          <strong>Settings → Connected accounts</strong>. That deletes its tokens immediately and
          does not affect the rest of your workspace.
        </p>
      </section>

      {/* ── 6 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="partial-deletion">
        <h2 className={styles.h2}>6. Deleting individual items instead</h2>
        <p>
          You do not have to delete the whole account to remove something. You can delete an
          individual upload, generated image, caption, scheduled post or brand kit from where it
          lives in the app, and that deletion takes effect immediately rather than through a request.
        </p>
        <p>
          If you belong to an organisation workspace, note that the workspace administrators can also
          see and delete content created inside it — including content you created. That is described
          in <Link href="/privacy#sharing">Privacy Policy section 4.4</Link>.
        </p>
      </section>

      {/* ── 7 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="contact">
        <h2 className={styles.h2}>7. Questions</h2>
        <p>
          Anything about deletion, export, or what we hold about you goes to{" "}
          <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>. If you are not satisfied
          with how we handled a request, you may complain to the Nigeria Data Protection Commission,
          or — if you are in the EEA or UK — to your local supervisory authority.
        </p>
        <div className={styles.contactGrid}>
          <div>
            <p className={styles.metaLabel}>Data controller</p>
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
              Privacy and deletion —{" "}
              <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>
              <br />
              General — <a href="mailto:support@brandosse.com">support@brandosse.com</a>
            </p>
          </div>
        </div>
      </section>
    </LegalShell>
  );
}
