/**
 * PrivacyPolicy.jsx — the published Privacy Policy.
 *
 * Transcribed from the approved document. Changes made in the course of
 * publishing, all recorded here rather than left to be found by diffing:
 *
 *   1. Clause 1.1 no longer carries the "[RC NUMBER]" placeholder. The clause
 *      is rewritten to state the entity and its address without the CAC
 *      registration number, which is not yet issued. Publishing a live privacy
 *      policy containing a visible template placeholder is worse than omitting
 *      the number: it reads as an unfinished document to the platform review
 *      teams who open this URL. Add the number to this clause when it exists.
 *   2. The international-transfers table no longer carries "[HOSTING REGION]".
 *      The row names the hosting provider's edge network rather than asserting
 *      a specific region we have not confirmed. Clause 6.3 already covers the
 *      transfer basis for anything outside the EEA and UK.
 *   3. Mojibake from the source file (em dashes and curly quotes that had been
 *      double-encoded) is repaired.
 *   4. Cross-references to the Terms, Acceptable Use Policy and Subprocessors
 *      list are now links to the real published pages.
 *
 * No other wording was altered.
 */

import Link from "next/link";
import LegalShell from "./LegalShell";
import { getLegalDoc } from "./legalDocs";
import styles from "./Legal.module.css";

const DOC = getLegalDoc("privacy");

const CONTENTS = [
  { id: "who-we-are", label: "Who we are" },
  { id: "what-we-collect", label: "What we collect" },
  { id: "how-we-use-it", label: "How we use it, and our legal basis" },
  { id: "sharing", label: "Who we share it with" },
  { id: "ai-processing", label: "AI processing" },
  { id: "transfers", label: "International transfers" },
  { id: "retention", label: "How long we keep it" },
  { id: "your-rights", label: "Your rights" },
  { id: "security", label: "Security" },
  { id: "cookies", label: "Cookies" },
  { id: "children", label: "Children" },
  { id: "policy-changes", label: "Changes to this policy" },
  { id: "contact", label: "Contact" },
];

export default function PrivacyPolicy() {
  return (
    <LegalShell
      slug="privacy"
      eyebrow="Data protection"
      title="Privacy Policy"
      lede="How Lordsway Energy Limited collects, uses and protects personal data in Brandosse."
      meta={[
        { label: "Effective date", value: DOC.effective },
        { label: "Last updated", value: DOC.updated },
        { label: "Data controller", value: "Lordsway Energy Limited" },
      ]}
      contents={CONTENTS}
    >
      <div className={`${styles.callout} ${styles.intro}`}>
        <p>
          <strong>In plain terms.</strong> We collect what you give us — account details, brand
          assets, uploads, prompts — and what the Service produces for you. To generate content we
          send your prompts, brand kit and reference images to third-party AI providers; that is how
          the Service works, and section 5 names them. To publish, we send your finished post and
          media to a publishing provider, which passes it to the platform you chose.
        </p>
        <p>
          We do not sell your personal data, we do not use behavioural advertising, and we run no
          analytics or ad-tracking cookies — verified in code as of 25 August 2026. This box is a
          summary; the sections below govern.
        </p>
      </div>

      {/* ── 1 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="who-we-are">
        <h2 className={styles.h2}>1. Who we are</h2>
        <p>
          <span className={styles.num}>1.1</span> Lordsway Energy Limited, a private company limited
          by shares registered in Nigeria, of 8 Venia Place, Lekki Phase 1, Lagos, Nigeria, is the{" "}
          <strong>data controller</strong> for the personal data described in this policy.
        </p>
        <p>
          <span className={styles.num}>1.2</span> This policy covers Brandosse at brandosse.com and
          its related services (the “Service”). Terms defined in our{" "}
          <Link href="/terms">Terms of Service</Link> have the same meaning here.
        </p>
        <p>
          <span className={styles.num}>1.3</span> We have not appointed a Data Protection Officer.
          Our privacy contact, <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>, is
          responsible for handling all data protection enquiries and requests.
        </p>
      </section>

      {/* ── 2 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="what-we-collect">
        <h2 className={styles.h2}>2. What we collect</h2>

        <h3 className={styles.h3}>2.1 What you give us</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "22%" }}>Data</th>
                <th style={{ width: "44%" }}>Examples</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Account</td>
                <td>Email, password hash, display name, account type</td>
                <td className={styles.tdQuiet}>Create and secure your account</td>
              </tr>
              <tr>
                <td>Google sign-in</td>
                <td>Email, name, profile picture, Google account ID</td>
                <td className={styles.tdQuiet}>Optional sign-in method</td>
              </tr>
              <tr>
                <td>Profile and workspace</td>
                <td>Business name, role, organisation membership, invitations</td>
                <td className={styles.tdQuiet}>Run your workspace</td>
              </tr>
              <tr>
                <td>Brand kit</td>
                <td>Logos, colours, fonts, tone-of-voice notes, product descriptions</td>
                <td className={styles.tdQuiet}>Personalise generated content</td>
              </tr>
              <tr>
                <td>Uploads</td>
                <td>Images, video files, documents you add to a library</td>
                <td className={styles.tdQuiet}>Store and use in your posts</td>
              </tr>
              <tr>
                <td>Prompts and briefs</td>
                <td>What you type to generate a caption, image or plan</td>
                <td className={styles.tdQuiet}>Produce Output</td>
              </tr>
              <tr>
                <td>Source Material links</td>
                <td>URLs you paste for the Service to retrieve</td>
                <td className={styles.tdQuiet}>Retrieve and process the media</td>
              </tr>
              <tr>
                <td>Support messages</td>
                <td>Anything you email or send us</td>
                <td className={styles.tdQuiet}>Answer you</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className={styles.h3}>2.2 Generated for you</h3>
        <p>
          Captions, images, videos, content plans, schedules, scores and analyses produced by the
          Service, plus the generation history and credit ledger showing what ran and what it cost.
        </p>

        <h3 className={styles.h3}>2.3 Connected social accounts</h3>
        <p>
          When you connect a social account we store the access and refresh tokens, the account
          identifier and handle, the platform, and the connection status. We store tokens to act on
          your instruction and hold them only while the connection is live.
        </p>

        <h3 className={styles.h3}>2.4 Collected automatically</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "36%" }}>Data</th>
                <th style={{ width: "22%" }}>Source</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Session and authentication cookies</td>
                <td>Our app</td>
                <td className={styles.tdQuiet}>Keep you signed in</td>
              </tr>
              <tr>
                <td>IP address, user agent, request timestamps</td>
                <td>Server and edge logs</td>
                <td className={styles.tdQuiet}>
                  Security, abuse prevention, rate limiting, debugging
                </td>
              </tr>
              <tr>
                <td>Error reports, stack traces, breadcrumbs</td>
                <td>Sentry</td>
                <td className={styles.tdQuiet}>Diagnose faults</td>
              </tr>
              <tr>
                <td>Job and worker logs</td>
                <td>Our processing pipeline</td>
                <td className={styles.tdQuiet}>Run and debug generation and video jobs</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className={styles.h3}>2.5 Payment data</h3>
        <p>
          Card details go directly to our payment processor and are never stored on our systems. We
          keep the transaction record: amount, currency, status, timestamp, package purchased, and
          the processor’s customer and transaction identifiers.
        </p>

        <h3 className={styles.h3}>2.6 Cached Source Material</h3>
        <p>
          If you paste a link, the media retrieved from it is stored in a private cache bucket while
          your job runs and for 24 hours after the job reaches a final state. That media may contain
          personal data of people appearing in it — see section 2.7.
        </p>

        <h3 className={styles.h3}>2.7 Personal data of other people</h3>
        <p>
          Your Content may contain personal data about others — clients, staff, people in photos,
          followers. Where it does, <strong>you are the controller and we act on your instruction</strong>.
          You are responsible for having a lawful basis, giving those people notice, and obtaining
          any consent or release required. If you use Brandosse to manage social accounts on behalf
          of your own clients, a Data Processing Agreement is available on request from{" "}
          <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>.
        </p>
      </section>

      {/* ── 3 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="how-we-use-it">
        <h2 className={styles.h2}>3. How we use it, and our legal basis</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "62%" }}>Purpose</th>
                <th>Legal basis (GDPR Art. 6)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Create your account, provide the Service, generate and publish content</td>
                <td className={styles.tdQuiet}>Performance of a contract</td>
              </tr>
              <tr>
                <td>Take payment, manage credits, prevent chargeback fraud</td>
                <td className={styles.tdQuiet}>Contract; legal obligation</td>
              </tr>
              <tr>
                <td>
                  Send transactional email — confirmation, password reset, job and invitation notices
                </td>
                <td className={styles.tdQuiet}>Contract</td>
              </tr>
              <tr>
                <td>Keep the Service secure, detect abuse, enforce limits</td>
                <td className={styles.tdQuiet}>Legitimate interests</td>
              </tr>
              <tr>
                <td>Diagnose faults and improve reliability</td>
                <td className={styles.tdQuiet}>Legitimate interests</td>
              </tr>
              <tr>
                <td>Comply with tax, accounting and law-enforcement obligations</td>
                <td className={styles.tdQuiet}>Legal obligation</td>
              </tr>
              <tr>
                <td>Marketing email about the Service</td>
                <td className={styles.tdQuiet}>Consent, withdrawable at any time</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Where we rely on legitimate interests, we have weighed them against your rights and will
          explain the assessment on request.
        </p>
      </section>

      {/* ── 4 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="sharing">
        <h2 className={styles.h2}>4. Who we share it with</h2>
        <p>
          <span className={styles.num}>4.1</span> We share personal data only with the processors
          named in our <Link href="/subprocessors">Subprocessors list</Link>, which forms part of
          this policy. That list names each provider, what it receives, and what it is used for. The
          categories are:
        </p>
        <ul className={styles.bullets}>
          <li>
            <strong>Infrastructure</strong> — application hosting, database, file storage, video
            processing.
          </li>
          <li>
            <strong>AI model providers</strong> — receive your prompts, brand kit text, and reference
            or source images and video needed to generate Output.
          </li>
          <li>
            <strong>Publishing provider</strong> — receives the post content, media and connected
            account authorisation needed to publish.
          </li>
          <li>
            <strong>Email provider</strong> — receives your email address and the message content.
          </li>
          <li>
            <strong>Error monitoring</strong> — receives technical diagnostics, which may
            incidentally include identifiers.
          </li>
          <li>
            <strong>Payment processor</strong> — receives payment and billing details directly.
          </li>
        </ul>
        <p>
          <span className={styles.num}>4.2</span> We also disclose data where legally required, to
          enforce our Terms, to protect rights and safety, and to a successor in a merger or
          acquisition — we will tell you first.
        </p>
        <p>
          <span className={styles.num}>4.3</span> We do not sell personal data and we do not share it
          for cross-context behavioural advertising.
        </p>

        <h3 className={styles.h3}>4.4 Who can see and delete your content</h3>
        <p>
          Two categories of person can reach your content beyond you, and you should know about both.
        </p>
        <p>
          <strong>Brandosse staff.</strong> A small number of our administrators can access user
          accounts and content through an internal admin console, and can delete content — including
          content generated through the Service. We do this only to operate the Service: to
          investigate a fault you have reported, to respond to a legal request, to enforce the{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link>, or to action a deletion you
          asked for. Access is limited to staff who need it, and we do not browse user content for
          any other reason.
        </p>
        <p>
          <strong>Your workspace administrators.</strong> If you belong to an organisation workspace,
          the administrators of that workspace can see and delete content created inside it by any
          member, including content you created. If your employer or client owns the workspace, they
          — not you — control that content. If you are unsure who administers your workspace, ask
          them before putting personal material into it.
        </p>
      </section>

      {/* ── 5 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="ai-processing">
        <h2 className={styles.h2}>5. AI processing — read this one</h2>
        <div className={`${styles.callout} ${styles.calloutStrict}`}>
          <p>
            Do not paste anything into a prompt that you would not be comfortable sending to a
            third-party AI provider — passwords, payment details, health data, government
            identifiers, or another person’s confidential information.
          </p>
        </div>
        <p>
          <span className={styles.num}>5.1</span> To generate content, the Service transmits to
          third-party model providers your prompt text, relevant brand kit content, and any reference
          image, uploaded media or retrieved Source Material the request needs.
        </p>
        <p>
          <span className={styles.num}>5.2</span> We do not train any model on your content, prompts
          or Output, and we do not sell, license or otherwise make them available to anyone for
          training.
        </p>
        <p>
          <span className={styles.num}>5.3</span> Your content is transmitted to the AI providers
          named in our <Link href="/subprocessors">Subprocessors list</Link> solely to generate your
          Output. We can only pass on what those providers commit to, so we state each position
          rather than making a single blanket promise. Positions verified against their published
          terms on 25 August 2026:
        </p>
        <ul className={styles.bullets}>
          <li>
            <strong>Anthropic</strong> — contractually undertakes not to train on commercial API
            inputs or outputs, and deletes them within 30 days.
          </li>
          <li>
            <strong>Groq</strong> — contractually prohibited from using inputs or outputs for
            training or fine-tuning; does not retain inference inputs and outputs by default.
          </li>
          <li>
            <strong>fal.ai</strong> — its published privacy policy does not address model training,
            and we have not obtained written confirmation. Until we have, you should not assume any
            training restriction applies to material sent to image, video, editing or upscaling
            features. Generated media is held on fal.ai’s CDN for a minimum of 7 days.
          </li>
        </ul>
        <p>
          <span className={styles.num}>5.4</span> We will update this section, and the Subprocessors
          list, if any of these positions changes. Model providers apply their own retention; where a
          provider offers zero- or limited-retention terms we use them, and where it does not, we say
          so in the Subprocessors list.
        </p>
      </section>

      {/* ── 6 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="transfers">
        <h2 className={styles.h2}>6. International transfers</h2>
        <p>
          <span className={styles.num}>6.1</span> We are established in Nigeria and our
          infrastructure runs in Europe. Where your data physically sits depends on which part of the
          Service you use:
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "58%" }}>What</th>
                <th>Where it is processed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Account, profile, workspace, brand kit, uploads, generated Output, credit ledger
                </td>
                <td>Ireland (European Union)</td>
              </tr>
              <tr>
                <td>Video clipping — source download, transcription, rendering</td>
                <td>United Kingdom (London)</td>
              </tr>
              <tr>
                <td>The web application and its server functions</td>
                <td>
                  Our hosting provider’s global edge network — named in the{" "}
                  <Link href="/subprocessors">Subprocessors list</Link>
                </td>
              </tr>
              <tr>
                <td>AI generation, publishing, email, error monitoring, payments</td>
                <td>The regions operated by the providers in our Subprocessors list</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <span className={styles.num}>6.2</span> The United Kingdom is not part of the European
          Union. If you are in the EEA, your video source material is therefore transferred to a
          third country. The UK holds a European Commission adequacy decision, and that is the basis
          we rely on for that transfer.
        </p>
        <p>
          <span className={styles.num}>6.3</span> For transfers to Nigeria and to providers outside
          the EEA and UK, we rely on Standard Contractual Clauses and on the transfer mechanisms
          available under the Nigeria Data Protection Act 2023, and we require every processor to
          apply appropriate safeguards under contract.
        </p>
      </section>

      {/* ── 7 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="retention">
        <h2 className={styles.h2}>7. How long we keep it</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "58%" }}>Data</th>
                <th>Retention</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Account and profile</td>
                <td>While your account is open</td>
              </tr>
              <tr>
                <td>Content, brand kit, uploads, generated Output</td>
                <td>While your account is open, or until you delete the item</td>
              </tr>
              <tr>
                <td>Video source material you supplied</td>
                <td>24 hours after the job reaches a final state</td>
              </tr>
              <tr>
                <td>Rendered video clips</td>
                <td>7 days after the job reaches a final state, then permanently deleted</td>
              </tr>
              <tr>
                <td>Connected account tokens</td>
                <td>Until you disconnect or the token is revoked</td>
              </tr>
              <tr>
                <td>Credit ledger and transaction records</td>
                <td>7 years, to meet tax and accounting obligations</td>
              </tr>
              <tr>
                <td>Security and access logs</td>
                <td>90 days</td>
              </tr>
              <tr>
                <td>Error reports</td>
                <td>90 days</td>
              </tr>
              <tr>
                <td>Everything else, after account deletion</td>
                <td>30 days</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 8 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="your-rights">
        <h2 className={styles.h2}>8. Your rights</h2>
        <p>
          <span className={styles.num}>8.1</span> Depending on where you live you may have the right
          to access your data; correct it; delete it; restrict or object to processing; receive it in
          a portable format; withdraw consent; and not be subject to solely automated decisions with
          legal or similarly significant effects.
        </p>
        <p>
          <strong>8.2 How to exercise them.</strong> Use Settings → Data and Privacy in the Service
          to request an export or account deletion, or email{" "}
          <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>.
        </p>
        <p>
          <strong>8.3 How the request is handled.</strong> Stated plainly: export and deletion are
          currently request-based and fulfilled manually by our team, not automated. When you submit
          a request we record it, acknowledge it within 72 hours, and complete it within 30 days. We
          will confirm by email when it is done.
        </p>
        <p>
          <strong>8.4 Complaints.</strong> If you are in Nigeria, you may complain to the Nigeria
          Data Protection Commission (NDPC). If you are in the EEA or UK, you may complain to your
          local supervisory authority. You may always complain to us first at{" "}
          <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>.
        </p>
      </section>

      {/* ── 9 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="security">
        <h2 className={styles.h2}>9. Security</h2>
        <p>
          <span className={styles.num}>9.1</span> We use encryption in transit, hashed credentials,
          row-level access control that isolates each workspace, scoped API keys held server-side,
          signed webhooks, and private storage buckets.
        </p>
        <p>
          <span className={styles.num}>9.2</span> No system is perfectly secure. If a breach affects
          your personal data and is likely to result in a risk to your rights, we will notify you and
          the relevant authority as the law requires.
        </p>
        <p>
          <span className={styles.num}>9.3</span> Report a vulnerability to{" "}
          <a href="mailto:security@brandosse.com">security@brandosse.com</a>.
        </p>
      </section>

      {/* ── 10 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="cookies">
        <h2 className={styles.h2}>10. Cookies</h2>
        <p>We set only what the Service needs to function:</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Cookie type</th>
                <th style={{ width: "48%" }}>Purpose</th>
                <th>Essential</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Authentication / session</td>
                <td>Keep you signed in</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>Security / CSRF state</td>
                <td>Protect sign-in and account-connection flows</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>Preference</td>
                <td>Remember theme and layout choices</td>
                <td>Yes, functional</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We currently run no analytics, advertising or third-party tracking cookies — verified
          against the codebase on 25 August 2026. If that changes, we will update this policy and ask
          for consent where required before setting them.
        </p>
      </section>

      {/* ── 11 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="children">
        <h2 className={styles.h2}>11. Children</h2>
        <p>
          The Service is not for anyone under 18. We do not knowingly collect their data. If you
          believe a child has given us data, contact{" "}
          <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a> and we will delete it.
        </p>
      </section>

      {/* ── 12 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="policy-changes">
        <h2 className={styles.h2}>12. Changes to this policy</h2>
        <p>
          We will post updates here with a new effective date, and give notice by email or in-product
          notice for material changes.
        </p>
      </section>

      {/* ── 13 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="contact">
        <h2 className={styles.h2}>13. Contact</h2>
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
              Privacy — <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>
              <br />
              Security — <a href="mailto:security@brandosse.com">security@brandosse.com</a>
              <br />
              General — <a href="mailto:support@brandosse.com">support@brandosse.com</a>
            </p>
          </div>
        </div>
      </section>
    </LegalShell>
  );
}
