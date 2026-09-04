/**
 * RefundPolicy.jsx — the published Refund and Credits Policy.
 *
 * Converted from legal/REFUND-AND-CREDITS-POLICY.md. Changes made in
 * publishing:
 *
 *   1. The "Status: DRAFT — NOT LEGALLY REVIEWED. DO NOT PUBLISH." banner is
 *      removed. This is the published version.
 *   2. "{{EFFECTIVE_DATE}}" is resolved to 27 August 2026, matching the rest of
 *      the published set.
 *   3. Relative markdown links are now links to the real published routes.
 *   4. Section 8's currency clause read "Refunds are made in Naira". Published
 *      as "in the currency you were originally charged", because the Terms of
 *      Service section 5.1 states prices in USD and a user reading both
 *      documents would otherwise be given two different answers. The
 *      substantive point — that we do not compensate for exchange-rate
 *      movement — is unchanged. See the note below; this is a drafting fix, not
 *      a decision about which currency billing will use.
 *
 * ── Known inconsistency, flagged rather than silently resolved ──────────────
 * This policy and Terms section 5.2 both name Paystack as the payment
 * processor. The code currently implements a Stripe checkout in USD
 * (app/api/credits/purchase/route.ts:77). Billing is not open to users, so no
 * one is affected today, but the processor named here must match the processor
 * that actually takes the first payment. Resolve before billing opens.
 */

import Link from "next/link";
import LegalShell from "./LegalShell";
import { getLegalDoc } from "./legalDocs";
import styles from "./Legal.module.css";

const DOC = getLegalDoc("refunds");

const CONTENTS = [
  { id: "how-credits-work", label: "How Credits work" },
  { id: "nigerian-law", label: "Your rights under Nigerian law come first" },
  { id: "automatic-restoration", label: "Automatic restoration" },
  { id: "first-purchase", label: "First purchase — 7 days, no questions" },
  { id: "after-first-purchase", label: "After the first purchase" },
  { id: "if-we-cancel", label: "If we cancel or change things" },
  { id: "how-to-request", label: "How to request a refund" },
  { id: "how-paid", label: "How refunds are paid" },
  { id: "chargebacks", label: "Chargebacks and disputes" },
  { id: "changes", label: "Changes to this policy" },
];

export default function RefundPolicy() {
  return (
    <LegalShell
      slug="refunds"
      eyebrow="Billing and credits"
      title="Refund and Credits Policy"
      lede="How credits are consumed and expire, when they are restored automatically, and how to get your money back."
      meta={[
        { label: "Effective date", value: DOC.effective },
        { label: "Last updated", value: DOC.updated },
        { label: "Forms part of", value: "The Terms of Service" },
      ]}
      contents={CONTENTS}
    >
      <p className={styles.intro}>
        Part of the <Link href="/terms">Terms of Service</Link>. Payments and refunds are processed
        by <strong>Paystack</strong>.
      </p>

      {/* ── 1 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="how-credits-work">
        <h2 className={styles.h2}>1. How Credits work</h2>
        <p>
          Credits are prepaid units consumed when you run a job — a caption generation, an image
          render, a video clip, a publish action. The Credit cost of each action is shown in the
          Service before you run it.
        </p>
        <p>
          <strong>Credits are consumed when a job starts.</strong> The compute is bought and spent at
          that moment.
        </p>
        <p>
          Credits are not money, are not a deposit, are not redeemable for cash, and earn no
          interest.
        </p>
        <p>
          <strong>Expiry.</strong> Purchased Credits expire 12 months after the date of purchase.
          Free monthly allowance Credits expire at the end of the month in which they are granted and
          do not accumulate.
        </p>
      </section>

      {/* ── 2 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="nigerian-law">
        <h2 className={styles.h2}>2. Your rights under Nigerian law come first</h2>
        <p>
          Under the <strong>Federal Competition and Consumer Protection Act 2018</strong>, if you are
          a consumer you are entitled to a refund where a service is not rendered as agreed.{" "}
          <strong>
            Nothing in this policy limits that right, and no term here operates as a waiver of it.
          </strong>{" "}
          Where this policy and the FCCPA differ, the FCCPA wins.
        </p>
        <p>
          Everything below is intended to be more generous than that statutory floor, not less.
        </p>
      </section>

      {/* ── 3 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="automatic-restoration">
        <h2 className={styles.h2}>3. Automatic restoration — you do not need to ask</h2>
        <p>Credits are returned to your balance automatically when:</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "62%" }}>Situation</th>
                <th>Remedy</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  A job fails because of a fault on our side — an internal error, a provider outage, a
                  timeout
                </td>
                <td className={styles.tdQuiet}>Credits restored automatically</td>
              </tr>
              <tr>
                <td>A job never reaches a final state</td>
                <td className={styles.tdQuiet}>Credits restored</td>
              </tr>
              <tr>
                <td>An individual clip fails to render while others in the job succeed</td>
                <td className={styles.tdQuiet}>Credits for that clip restored</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          If a restoration does not appear on your credit ledger, email{" "}
          <a href="mailto:support@brandosse.com">support@brandosse.com</a> and we will correct it.
        </p>
      </section>

      {/* ── 4 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="first-purchase">
        <h2 className={styles.h2}>4. First purchase — 7 days, no questions asked</h2>
        <div className={styles.callout}>
          <p>
            <strong>
              On your first paid purchase, you may request a full refund within 7 days for any reason
              at all.
            </strong>{" "}
            You do not have to explain, and we will not ask.
          </p>
        </div>
        <ul className={styles.bullets}>
          <li>
            Available <strong>once per account</strong>, on the first purchase only.
          </li>
          <li>
            Credits consumed during those 7 days are deducted at the rate they were charged; the
            remainder is refunded in full.
          </li>
          <li>
            We absorb the payment processing fee. You receive the full amount you paid.
          </li>
        </ul>
      </section>

      {/* ── 5 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="after-first-purchase">
        <h2 className={styles.h2}>5. After the first purchase</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "42%" }}>Situation</th>
                <th>Position</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Unused Credits</td>
                <td className={styles.tdQuiet}>
                  Refundable within 14 days of the purchase that created them
                </td>
              </tr>
              <tr>
                <td>Consumed Credits</td>
                <td className={styles.tdQuiet}>
                  Not refundable, <strong>except</strong> where the Service failed to do what it
                  described — see section 2 and section 3
                </td>
              </tr>
              <tr>
                <td>You did not like the generated Output</td>
                <td className={styles.tdQuiet}>
                  Not a refund ground on its own. Generation is probabilistic and quality is not
                  guaranteed (<Link href="/terms#ai-output">Terms §9.2</Link>). This does{" "}
                  <strong>not</strong> cover a job that failed, produced nothing, or did not do what
                  the interface said it would
                </td>
              </tr>
              <tr>
                <td>A platform rejected, removed, throttled or de-ranked your post</td>
                <td className={styles.tdQuiet}>
                  Not refundable — outside our control (
                  <Link href="/terms#connected-accounts">Terms §11.3</Link>)
                </td>
              </tr>
              <tr>
                <td>Your social platform account was suspended</td>
                <td className={styles.tdQuiet}>Not refundable — outside our control</td>
              </tr>
              <tr>
                <td>Expired Credits</td>
                <td className={styles.tdQuiet}>Not refundable</td>
              </tr>
              <tr>
                <td>
                  Account terminated for breach of the{" "}
                  <Link href="/acceptable-use">Acceptable Use Policy</Link>
                </td>
                <td className={styles.tdQuiet}>
                  Unused Credits forfeited, except where the law requires otherwise
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 6 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="if-we-cancel">
        <h2 className={styles.h2}>6. If we cancel or change things</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "58%" }}>Situation</th>
                <th>Remedy</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>We charge you twice for the same purchase</td>
                <td className={styles.tdQuiet}>Full refund of the duplicate</td>
              </tr>
              <tr>
                <td>We charge you after you cancelled</td>
                <td className={styles.tdQuiet}>Full refund of the incorrect charge</td>
              </tr>
              <tr>
                <td>We materially reduce or remove a feature you paid for</td>
                <td className={styles.tdQuiet}>Pro-rata refund of the unused period</td>
              </tr>
              <tr>
                <td>We terminate your account for a reason other than your breach</td>
                <td className={styles.tdQuiet}>
                  Pro-rata refund of unused Credits and any unexpired prepaid period
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 7 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="how-to-request">
        <h2 className={styles.h2}>7. How to request a refund</h2>
        <p>
          Email <a href="mailto:support@brandosse.com">support@brandosse.com</a> from your account
          email address with the transaction date, the amount, and — unless you are using the section
          4 window — what went wrong.
        </p>
        <p>
          <strong>We respond within 5 business days.</strong>
        </p>
      </section>

      {/* ── 8 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="how-paid">
        <h2 className={styles.h2}>8. How refunds are paid</h2>
        <p>
          Approved refunds are returned <strong>to the original payment method</strong> through
          Paystack. You do not need a Paystack account to receive one.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: "50%" }}>Original payment method</th>
                <th>Typical time to arrive</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Card</td>
                <td className={styles.tdQuiet}>5 to 10 business days, depending on your bank</td>
              </tr>
              <tr>
                <td>Bank transfer</td>
                <td className={styles.tdQuiet}>2 to 3 business days</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>After 180 days.</strong> Paystack can only reverse a transaction within 180 days of
          the original charge. If your refund is approved after that window, we will pay it by direct
          bank transfer instead, and will ask you for account details for that purpose only.
        </p>
        <p>
          <strong>Currency.</strong> Refunds are made in the currency you were originally charged, in
          the amount originally charged. We do not compensate for exchange rate movement if your card
          was denominated in another currency.
        </p>
      </section>

      {/* ── 9 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="chargebacks">
        <h2 className={styles.h2}>9. Chargebacks and disputes</h2>
        <p>
          <strong>Please email us before raising a chargeback with your bank.</strong> It is faster,
          and in almost every case we will simply refund you.
        </p>
        <p>
          If a chargeback is raised, we may suspend the account until the dispute is resolved. Where
          a chargeback is raised after we have already refunded the same transaction, or is found to
          have been made in bad faith, we may terminate the account under{" "}
          <Link href="/terms#termination">Terms §15</Link>.
        </p>
      </section>

      {/* ── 10 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="changes">
        <h2 className={styles.h2}>10. Changes to this policy</h2>
        <p>
          We may update this policy. Material changes are notified as set out in{" "}
          <Link href="/terms#changes">Terms §20</Link>, and the version in force when you made a
          purchase governs that purchase.
        </p>
      </section>
    </LegalShell>
  );
}
