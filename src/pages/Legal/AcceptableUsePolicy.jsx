/**
 * AcceptableUsePolicy.jsx — the published Acceptable Use Policy.
 *
 * Converted from legal/ACCEPTABLE-USE-POLICY.md. Changes made in publishing:
 *
 *   1. The "Status: DRAFT — NOT LEGALLY REVIEWED. DO NOT PUBLISH." banner is
 *      removed. This is the published version.
 *   2. "{{EFFECTIVE_DATE}}" is resolved to 27 August 2026, matching the Privacy
 *      Policy — the most recently dated document in the set, and the date on
 *      which this set was finalised.
 *   3. Relative markdown links to sibling files are now links to the real
 *      published routes.
 *   4. Section 4's reference to "section 7" is qualified as Terms section 7,
 *      which is what it meant — this document has no section 7.
 *
 * Wording is otherwise unchanged.
 */

import Link from "next/link";
import LegalShell from "./LegalShell";
import { getLegalDoc } from "./legalDocs";
import styles from "./Legal.module.css";

const DOC = getLegalDoc("acceptable-use");

const CONTENTS = [
  { id: "short-version", label: "The short version" },
  { id: "prohibited-content", label: "Content you must not create or publish" },
  { id: "ai-misuse", label: "Misuse of AI generation" },
  { id: "source-material", label: "Source Material and third-party media" },
  { id: "platform-conduct", label: "Platform and publishing conduct" },
  { id: "technical-conduct", label: "Technical conduct" },
  { id: "prohibited-data", label: "Data you must not put into the Service" },
  { id: "enforcement", label: "Reporting and enforcement" },
  { id: "changes", label: "Changes" },
];

export default function AcceptableUsePolicy() {
  return (
    <LegalShell
      slug="acceptable-use"
      eyebrow="Conduct rules"
      title="Acceptable Use Policy"
      lede="What you may not do with Brandosse. Breaching this policy is a material breach of the Terms of Service."
      meta={[
        { label: "Effective date", value: DOC.effective },
        { label: "Last updated", value: DOC.updated },
        { label: "Forms part of", value: "The Terms of Service" },
      ]}
      contents={CONTENTS}
    >
      <p className={styles.intro}>
        This policy is part of the <Link href="/terms">Terms of Service</Link>. Capitalised terms
        have the meaning given there. Breaching this policy is a material breach of the Terms.
      </p>

      {/* ── 1 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="short-version">
        <h2 className={styles.h2}>1. The short version</h2>
        <div className={styles.callout}>
          <p>
            Do not use Brandosse to deceive people, to publish content you have no right to publish,
            to harm anyone, or to do anything that would get us thrown off a platform, a model
            provider, or a payment processor.
          </p>
        </div>
      </section>

      {/* ── 2 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="prohibited-content">
        <h2 className={styles.h2}>2. Content you must not create, upload or publish</h2>
        <ul className={styles.bullets}>
          <li>
            <strong>Illegal content</strong>, or content that promotes or facilitates a crime.
          </li>
          <li>
            <strong>Child sexual abuse material.</strong> Any instance is reported to the authorities
            and results in immediate, permanent termination without notice.
          </li>
          <li>
            <strong>Non-consensual intimate imagery</strong>, or sexualised depictions of real people.
          </li>
          <li>
            <strong>Content that harasses, bullies, threatens or incites violence</strong> against a
            person or group.
          </li>
          <li>
            <strong>Hate speech</strong> targeting people on the basis of a protected characteristic.
          </li>
          <li>
            <strong>Content promoting self-harm, suicide, or eating disorders.</strong>
          </li>
          <li>
            <strong>Malware, phishing pages, or credential-harvesting content.</strong>
          </li>
          <li>
            <strong>
              Content infringing another person’s copyright, trademark, design right, database right,
              publicity right or trade secret.
            </strong>
          </li>
          <li>
            <strong>
              Deliberately false claims about health, medicine, finance, elections or the law
            </strong>
            , and any content presenting AI Output as verified fact when it is not.
          </li>
          <li>
            <strong>Regulated-goods promotion</strong> where you lack the licence to promote it, and
            content aimed at minors for age-restricted products.
          </li>
        </ul>
      </section>

      {/* ── 3 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="ai-misuse">
        <h2 className={styles.h2}>3. Misuse of AI generation</h2>
        <p>You must not use the generation features to:</p>
        <ul className={styles.bullets}>
          <li>
            <strong>Impersonate a real person or organisation</strong>, or create content that a
            reasonable viewer would take as genuinely made or endorsed by them.
          </li>
          <li>
            <strong>Create synthetic media of a real, identifiable person</strong>, except as
            permitted by section 3.1 below.
          </li>
          <li>
            <strong>Fabricate evidence</strong> — fake reviews, testimonials, endorsements, receipts,
            screenshots, credentials, news reports, or official communications.
          </li>
          <li>
            <strong>Generate content designed to evade a platform’s moderation</strong>, including
            disguised text, cloaked links, or deliberately obfuscated claims.
          </li>
          <li>
            <strong>Reproduce a copyrighted work or a distinctive artist’s style</strong> in a way
            that would infringe rights in your market.
          </li>
          <li>
            <strong>
              Attempt to extract, reverse engineer, or bypass our prompts, system instructions, safety
              filters, or model configuration.
            </strong>
          </li>
          <li>
            Do anything prohibited by the usage policies of the model providers listed in our{" "}
            <Link href="/subprocessors">Subprocessors list</Link>. Their restrictions pass through to
            you.
          </li>
        </ul>

        <h3 className={styles.h3}>3.1 Depictions of real people</h3>
        <p>
          <strong>You may generate depictions of yourself</strong> — your own face, body or voice —
          and, with their documented written consent, members of your own team or organisation whose
          likeness you are authorised to use.
        </p>
        <p>
          <strong>
            You may not generate, or attempt to generate, a depiction of any other real, identifiable
            person.
          </strong>{" "}
          This includes public figures, celebrities, politicians, competitors, and private
          individuals, whether or not the depiction is flattering, and whether or not it is labelled
          as AI-generated.
        </p>
        <p>
          If the Service produces an image resembling a real person you did not set out to depict,
          that is an artefact of how the model works, not permission to use it. Do not publish it.
        </p>
      </section>

      {/* ── 4 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="source-material">
        <h2 className={styles.h2}>4. Source Material and third-party media</h2>
        <div className={`${styles.callout} ${styles.calloutStrict}`}>
          <p>
            <strong>You may only submit a link to video you own.</strong> We accept a link only where
            the channel or account hosting that video is one you have connected to Brandosse and
            which we have verified you control. Video published by anyone else is not accepted from a
            link in any circumstance — including video you have licensed, video you have been given
            permission to use, and video that is publicly accessible without restriction.
          </p>
        </div>
        <p>
          If you hold rights in video that you cannot verify this way, <strong>upload the file
          instead.</strong> Uploading is always available, is not restricted by this section, and is
          governed by section 7 of the <Link href="/terms">Terms of Service</Link>.
        </p>
        <p>You must also not:</p>
        <ul className={styles.bullets}>
          <li>
            Submit a URL where retrieving the media would breach the source site’s terms of service.
          </li>
          <li>
            Use the Service to build a library of other people’s content, to systematically re-upload
            another creator’s work, or to run a reaction or compilation operation on material you
            have not licensed.
          </li>
        </ul>
        <p>
          We may block domains, refuse retrievals, and terminate accounts that repeatedly trigger
          rights complaints.
        </p>
      </section>

      {/* ── 5 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="platform-conduct">
        <h2 className={styles.h2}>5. Platform and publishing conduct</h2>
        <p>You must not use the Service to:</p>
        <ul className={styles.bullets}>
          <li>
            Breach the terms, developer policies, automation rules or rate limits of any connected
            social platform.
          </li>
          <li>
            Operate <strong>bot networks, engagement pods, or coordinated inauthentic behaviour</strong>.
          </li>
          <li>
            Run <strong>spam</strong> — bulk unsolicited posting, comment spam, mass mentions, or
            repetitive near-identical posting across many accounts.
          </li>
          <li>Post to accounts you do not own or are not authorised to manage.</li>
          <li>Circumvent a platform’s suspension, ban, or geographic restriction.</li>
        </ul>
        <p>
          You are responsible for AI-disclosure labelling where a platform or your local law requires
          it.
        </p>
      </section>

      {/* ── 6 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="technical-conduct">
        <h2 className={styles.h2}>6. Technical conduct</h2>
        <p>You must not:</p>
        <ul className={styles.bullets}>
          <li>
            Probe, scan, or test the vulnerability of the Service without our written permission, or
            breach any security or authentication measure.
          </li>
          <li>Access another user’s or workspace’s data.</li>
          <li>Scrape the Service, or access it by automated means outside a documented API.</li>
          <li>Circumvent Credit accounting, rate limits, or quota enforcement.</li>
          <li>Create multiple accounts to obtain additional free allowances.</li>
          <li>Resell, sublicense or white-label the Service without a written agreement.</li>
          <li>
            Impose an unreasonable load on the infrastructure, or use the Service for cryptocurrency
            mining or general-purpose compute.
          </li>
        </ul>
      </section>

      {/* ── 7 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="prohibited-data">
        <h2 className={styles.h2}>7. Data you must not put into the Service</h2>
        <p>Do not upload or paste into a prompt:</p>
        <ul className={styles.bullets}>
          <li>Payment card numbers, bank credentials, or passwords.</li>
          <li>Government identifiers — passport, national ID, social security numbers.</li>
          <li>Health records or other special-category personal data.</li>
          <li>Another person’s confidential information you are not authorised to share.</li>
        </ul>
        <p>
          The Service is not designed or certified for regulated data (for example PCI, HIPAA, or
          equivalent) and must not be used to process it.
        </p>
      </section>

      {/* ── 8 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="enforcement">
        <h2 className={styles.h2}>8. Reporting and enforcement</h2>
        <p>
          <strong>
            Report abuse or a rights complaint to{" "}
            <a href="mailto:abuse@brandosse.com">abuse@brandosse.com</a>
          </strong>
          , with enough detail to identify the content and, for a rights complaint, a statement of
          your rights and your good-faith belief that the use is unauthorised.
        </p>
        <p>
          Depending on severity we may: remove content; disable a feature; suspend the account;
          terminate it permanently; refuse refunds under the{" "}
          <Link href="/refunds">Refund and Credits Policy</Link>; and report the matter to law
          enforcement or the affected platform.
        </p>
        <p>
          We aim to give notice and a chance to fix things where the breach is minor and capable of
          cure. For the categories in section 2 that involve imminent harm or illegality, enforcement
          is immediate.
        </p>
      </section>

      {/* ── 9 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="changes">
        <h2 className={styles.h2}>9. Changes</h2>
        <p>
          We may update this policy as platforms, model providers and law change. Material changes
          are notified as set out in <Link href="/terms#changes">Terms of Service section 20</Link>.
        </p>
      </section>
    </LegalShell>
  );
}
