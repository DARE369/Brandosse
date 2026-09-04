/**
 * SubprocessorsPage.jsx — the published Subprocessors list.
 *
 * Converted from legal/SUBPROCESSORS.md, which is the repo's internal,
 * evidence-cited version. Changes made in publishing:
 *
 *   1. The "Evidence" column of `file:line` citations is dropped. It is the
 *      right column for the internal document — it is what makes that document
 *      auditable — and the wrong one for a public page, which is read by users
 *      and platform reviewers who cannot open the repository. Location and
 *      retention take its place. The internal file remains the source of truth
 *      for the citations and MUST be updated in the same change as this page.
 *   2. "{{VERCEL_REGION}}" is resolved: the Vercel row names the global edge
 *      network rather than asserting a region that has not been pinned in
 *      vercel.json.
 *   3. The internal "Action required before publishing" admonition about
 *      fal.ai is replaced by the public statement of the same fact. The
 *      position is not softened — it still says we do not know.
 *   4. Paystack: the internal row said "Decided, not yet integrated. The code
 *      still carries a Stripe checkout." Published as the user-facing version
 *      of that same fact — billing is not open. This is the honest statement,
 *      not a promotion of a plan to a promise.
 *
 * ── This page is a factual claim, and claims rot ────────────────────────────
 * Verified against the codebase on 25 August 2026, re-verified 4 September
 * 2026. Two rows are the ones most likely to go stale first:
 *
 *   - Publishing. Zernio is still the only real-publish provider
 *     (supabase/functions/publish-post/index.ts:160-173). Direct per-platform
 *     OAuth is being built on this branch; when it ships, this row changes
 *     from one processor to four platform endpoints, and the Privacy Policy's
 *     "Publishing provider" category in section 4.1 changes with it.
 *   - Payments. Paystack is named in the Terms; the code implements Stripe.
 *
 * Neither may be left to drift. Updating this page is part of shipping either
 * change, not a follow-up.
 */

import Link from "next/link";
import LegalShell from "./LegalShell";
import { getLegalDoc } from "./legalDocs";
import styles from "./Legal.module.css";

const DOC = getLegalDoc("subprocessors");

const CONTENTS = [
  { id: "infrastructure", label: "Infrastructure" },
  { id: "ai-providers", label: "AI model providers" },
  { id: "training-posture", label: "Training and retention posture" },
  { id: "publishing", label: "Publishing" },
  { id: "operations", label: "Operations" },
  { id: "not-present", label: "What is not here" },
  { id: "media-retrieval", label: "Third-party media retrieval" },
  { id: "changes", label: "Changes to this list" },
];

export default function SubprocessorsPage() {
  return (
    <LegalShell
      slug="subprocessors"
      eyebrow="Data protection"
      title="Subprocessors"
      lede="Every third party that processes personal data on our behalf, what it receives, and where it runs."
      meta={[
        { label: "Effective date", value: DOC.effective },
        { label: "Last verified", value: "4 September 2026" },
        { label: "Forms part of", value: "The Privacy Policy" },
      ]}
      contents={CONTENTS}
    >
      <div className={`${styles.callout} ${styles.intro}`}>
        <p>
          This list forms part of our <Link href="/privacy">Privacy Policy</Link>. It is compiled
          from the running system rather than from our own documentation, and we update it before
          adding a new subprocessor that processes personal data.
        </p>
      </div>

      {/* ── Infrastructure ────────────────────────────────────────────────── */}
      <section className={styles.section} id="infrastructure">
        <h2 className={styles.h2}>1. Infrastructure</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "18%" }}>Provider</th>
                <th style={{ width: "24%" }}>Role</th>
                <th style={{ width: "34%" }}>Personal data it receives</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Supabase</td>
                <td>Database, authentication, file storage, edge functions</td>
                <td className={styles.tdQuiet}>
                  All account, profile, workspace, content, brand kit, upload, token and ledger data
                </td>
                <td className={styles.tdQuiet}>Ireland (EU)</td>
              </tr>
              <tr>
                <td>Vercel</td>
                <td>Application hosting and edge network</td>
                <td className={styles.tdQuiet}>IP address, user agent, request logs</td>
                <td className={styles.tdQuiet}>Global edge network</td>
              </tr>
              <tr>
                <td>Fly.io</td>
                <td>Video processing worker host</td>
                <td className={styles.tdQuiet}>Video source media, job metadata</td>
                <td className={styles.tdQuiet}>London, United Kingdom</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── AI providers ──────────────────────────────────────────────────── */}
      <section className={styles.section} id="ai-providers">
        <h2 className={styles.h2}>2. AI model providers</h2>
        <p>
          These receive <strong>prompt text, brand kit content, and reference or source media</strong>{" "}
          needed to produce Output.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "18%" }}>Provider</th>
                <th style={{ width: "38%" }}>Role</th>
                <th>What it receives</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Anthropic (Claude)</td>
                <td>Primary text generation — captions, plans, briefs, titles</td>
                <td className={styles.tdQuiet}>Prompts, brand kit text, post content</td>
              </tr>
              <tr>
                <td>Groq</td>
                <td>Fallback text generation</td>
                <td className={styles.tdQuiet}>
                  The same, when the primary provider fails
                </td>
              </tr>
              <tr>
                <td>fal.ai</td>
                <td>Image generation, image editing, upscaling, video generation</td>
                <td className={styles.tdQuiet}>
                  Prompts, reference and uploaded images, source video
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Training posture ──────────────────────────────────────────────── */}
      <section className={styles.section} id="training-posture">
        <h2 className={styles.h2}>3. Training and retention posture</h2>
        <p>
          Verified against each provider’s published terms on 25 August 2026. We state each position
          separately rather than making one blanket promise, because we can only pass on what each
          provider actually commits to.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "18%" }}>Provider</th>
                <th style={{ width: "40%" }}>Trains on your inputs?</th>
                <th>Retention</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Anthropic</td>
                <td className={styles.tdQuiet}>
                  <strong>No</strong> — the Commercial Services Agreement prohibits training on API
                  inputs and outputs
                </td>
                <td className={styles.tdQuiet}>
                  Deleted within 30 days; up to 2 years if flagged for a usage-policy violation.
                  Zero-retention available to qualifying accounts
                </td>
              </tr>
              <tr>
                <td>Groq</td>
                <td className={styles.tdQuiet}>
                  <strong>No</strong> — contractually prohibited from using inputs or outputs for
                  training or fine-tuning
                </td>
                <td className={styles.tdQuiet}>
                  No retention of inference inputs and outputs by default; troubleshooting logs up to
                  30 days, opt-out available in Data Controls
                </td>
              </tr>
              <tr>
                <td>fal.ai</td>
                <td className={styles.tdQuiet}>
                  <strong>Unknown</strong> — its privacy policy is silent on model training, and we
                  have not obtained written confirmation
                </td>
                <td className={styles.tdQuiet}>
                  Generated media held on fal.ai’s CDN for a minimum of 7 days
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={`${styles.callout} ${styles.calloutStrict}`}>
          <p>
            <strong>The fal.ai position is a genuine gap, and we are not going to paper over it.</strong>{" "}
            fal.ai receives the most sensitive material in the product — uploaded reference images,
            brand assets, and source video. Until we obtain written confirmation of its training
            posture, you should not assume any training restriction applies to material sent to the
            image, video, editing or upscaling features. We will update this page and the{" "}
            <Link href="/privacy#ai-processing">Privacy Policy</Link> when that changes, in either
            direction.
          </p>
        </div>
      </section>

      {/* ── Publishing ────────────────────────────────────────────────────── */}
      <section className={styles.section} id="publishing">
        <h2 className={styles.h2}>4. Publishing</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "18%" }}>Provider</th>
                <th style={{ width: "38%" }}>Role</th>
                <th>What it receives</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Zernio</td>
                <td>Social publishing API — connects accounts and delivers posts to platforms</td>
                <td className={styles.tdQuiet}>
                  Connected account authorisation, post text, media, scheduling metadata
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Platforms reachable through this provider: Facebook, Instagram, LinkedIn, Pinterest,
          Threads, TikTok, X and YouTube. Each platform is itself an independent controller of what
          you publish to it, under its own terms — see{" "}
          <Link href="/terms#connected-accounts">Terms section 11</Link>.
        </p>
      </section>

      {/* ── Operations ────────────────────────────────────────────────────── */}
      <section className={styles.section} id="operations">
        <h2 className={styles.h2}>5. Operations</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "18%" }}>Provider</th>
                <th style={{ width: "34%" }}>Role</th>
                <th>What it receives</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Resend</td>
                <td>Transactional email</td>
                <td className={styles.tdQuiet}>Email address, message content</td>
              </tr>
              <tr>
                <td>Sentry</td>
                <td>Error monitoring and performance tracing</td>
                <td className={styles.tdQuiet}>
                  Stack traces, breadcrumbs, request context, user identifiers
                </td>
              </tr>
              <tr>
                <td>Paystack</td>
                <td>Payment processing and billing</td>
                <td className={styles.tdQuiet}>
                  Card details (direct to the processor), billing address, transaction records.{" "}
                  <strong>Not yet active</strong> — billing is not open to users, and no payment has
                  been taken. This page will name the processor in use before any payment is
                  processed
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Not present ───────────────────────────────────────────────────── */}
      <section className={styles.section} id="not-present">
        <h2 className={styles.h2}>6. What is not here</h2>
        <p>
          Verified absent from the codebase, because what we do <em>not</em> run is as much a part of
          this disclosure as what we do:
        </p>
        <ul className={styles.bullets}>
          <li>
            <strong>No analytics or product-telemetry provider.</strong> No PostHog, Mixpanel, Google
            Analytics or Plausible anywhere in the application.
          </li>
          <li>
            <strong>No advertising or marketing-attribution pixel.</strong>
          </li>
          <li>
            <strong>No session-replay tool.</strong>
          </li>
          <li>
            <strong>No CRM or customer-messaging widget.</strong>
          </li>
        </ul>
        <p>
          If any of these is added, this page and the{" "}
          <Link href="/privacy#cookies">Privacy Policy cookie section</Link> are updated in the same
          change.
        </p>
      </section>

      {/* ── Media retrieval ───────────────────────────────────────────────── */}
      <section className={styles.section} id="media-retrieval">
        <h2 className={styles.h2}>7. Third-party media retrieval</h2>
        <p>
          The video pipeline retrieves media from URLs you supply. This is <strong>not</strong> a
          subprocessor relationship: no personal data of yours is sent to the source site beyond the
          request itself. It is a terms-of-service and copyright exposure instead, and it is
          addressed in <Link href="/terms#source-material">Terms of Service section 8</Link> and{" "}
          <Link href="/acceptable-use#source-material">Acceptable Use Policy section 4</Link>.
        </p>
      </section>

      {/* ── Changes ───────────────────────────────────────────────────────── */}
      <section className={styles.section} id="changes">
        <h2 className={styles.h2}>8. Changes to this list</h2>
        <p>
          We update this page before a new subprocessor begins processing personal data, and whenever
          an existing one’s role, location or retention position changes. Questions about anything on
          it go to <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>.
        </p>
      </section>
    </LegalShell>
  );
}
