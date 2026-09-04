/**
 * TermsOfService.jsx — the published Terms of Service.
 *
 * Transcribed from the approved document. Four changes were made in the course
 * of publishing it, all of them non-substantive, and all of them recorded here
 * rather than left for someone to discover by diffing:
 *
 *   1. The "Draft for legal review" header badge is removed. This is the
 *      published version; a badge saying otherwise would be false.
 *   2. Mojibake from the source file (em dashes and curly quotes that had been
 *      double-encoded) is repaired.
 *   3. The registered address is normalised to "8 Venia Place" — clause 1.1 of
 *      the source read "8 The Venia Place" while its own contact block and
 *      every other document read "8 Venia Place".
 *   4. Cross-references to the Acceptable Use Policy, Privacy Policy, Refund
 *      and Credits Policy and Subprocessors list are now links to the real
 *      published pages. In the source they were plain text.
 *
 * No clause wording was altered. If a clause needs to change, change it here
 * and move the "Last updated" date in legalDocs.js in the same commit.
 */

import Link from "next/link";
import LegalShell from "./LegalShell";
import { getLegalDoc } from "./legalDocs";
import styles from "./Legal.module.css";

const DOC = getLegalDoc("terms");

const CONTENTS = [
  { id: "agreement", label: "Agreement to these Terms" },
  { id: "definitions", label: "Definitions" },
  { id: "eligibility", label: "Eligibility and your Account" },
  { id: "service", label: "The Service" },
  { id: "payment", label: "Plans, Credits and payment" },
  { id: "refunds", label: "Refunds and cancellation" },
  { id: "your-content", label: "Your Content" },
  { id: "source-material", label: "Source Material retrieved from URLs" },
  { id: "ai-output", label: "AI Output" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "connected-accounts", label: "Connected Accounts and platforms" },
  { id: "our-ip", label: "Our intellectual property" },
  { id: "confidentiality", label: "Confidentiality" },
  { id: "availability", label: "Availability" },
  { id: "termination", label: "Suspension and termination" },
  { id: "disclaimers", label: "Disclaimers" },
  { id: "liability", label: "Limitation of liability" },
  { id: "indemnity", label: "Indemnity" },
  { id: "governing-law", label: "Governing law and disputes" },
  { id: "changes", label: "Changes to these Terms" },
  { id: "general", label: "General" },
  { id: "contact", label: "Contact" },
];

export default function TermsOfService() {
  return (
    <LegalShell
      slug="terms"
      eyebrow="The agreement"
      title="Terms of Service"
      lede="An agreement between you and Lordsway Energy Limited governing your use of Brandosse."
      meta={[
        { label: "Effective date", value: DOC.effective },
        { label: "Last updated", value: DOC.updated },
        { label: "Governing law", value: "Nigeria — Lagos State courts" },
      ]}
      contents={CONTENTS}
    >
      <p className={styles.intro}>
        Please read these Terms carefully. They limit our liability, allocate responsibility for the
        content you publish, and place strict conditions on material you ask us to retrieve from a
        link. Defined terms appear in section 2.
      </p>

      <div className={styles.callout}>
        <p>
          <strong>Summary, not a substitute.</strong> You own what you upload and what the Service
          generates for you. We do not train models on your content. Credits are prepaid, consumed
          when a job starts, and expire 12 months after purchase. You are the publisher of everything
          you post, and you may only submit links to video you own. The sections below govern; this
          box does not.
        </p>
      </div>

      {/* ── 1 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="agreement">
        <h2 className={styles.h2}>1. Agreement to these Terms</h2>
        <p>
          <span className={styles.num}>1.1</span> These Terms of Service (“<strong>Terms</strong>”)
          are a binding agreement between you and Lordsway Energy Limited, a private company limited
          by shares registered in Nigeria, at 8 Venia Place, Lekki Phase 1, Lagos, Nigeria (“
          <strong>Brandosse</strong>”, “we”, “us”, “our”).
        </p>
        <p>
          <span className={styles.num}>1.2</span> They govern your access to and use of Brandosse at
          brandosse.com and all related applications, APIs and services (together, the “
          <strong>Service</strong>”).
        </p>
        <p>
          <span className={styles.num}>1.3</span> By creating an account, clicking “Create Account”,
          or using the Service, you accept these Terms, our{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link> and our{" "}
          <Link href="/privacy">Privacy Policy</Link>, each incorporated here by reference. If you do
          not accept them, do not use the Service.
        </p>
        <p>
          <span className={styles.num}>1.4</span> If you are accepting on behalf of a company or
          other organisation, you represent that you are authorised to bind it, and “you” means that
          organisation.
        </p>
      </section>

      {/* ── 2 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="definitions">
        <h2 className={styles.h2}>2. Definitions</h2>
        <p>
          <strong>Account</strong> — your registered user account on the Service.
        </p>
        <p>
          <strong>Workspace</strong> — a personal or organisation area in which Content is created
          and stored.
        </p>
        <p>
          <strong>Your Content</strong> — anything you upload, submit, connect or provide: brand
          assets, logos, images, video files, text, prompts, briefs, links and credentials for
          Connected Accounts.
        </p>
        <p>
          <strong>Source Material</strong> — third-party media you direct the Service to retrieve
          from a URL you supply, for example a video you ask us to clip.
        </p>
        <p>
          <strong>Output</strong> — captions, images, videos, plans, schedules, scores and other
          material the Service generates, in whole or part, using artificial intelligence, in
          response to Your Content.
        </p>
        <p>
          <strong>Connected Account</strong> — a third-party social media account you authorise the
          Service to post to or read from.
        </p>
        <p>
          <strong>Credits</strong> — the prepaid units the Service consumes when you run a
          generation, render or publishing action.
        </p>
      </section>

      {/* ── 3 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="eligibility">
        <h2 className={styles.h2}>3. Eligibility and your Account</h2>
        <p>
          <span className={styles.num}>3.1</span> You must be at least 18 years old to use the
          Service. The Service is not directed at children and we do not knowingly collect their
          personal data.
        </p>
        <p>
          <span className={styles.num}>3.2</span> You must provide accurate registration information
          and keep it current.
        </p>
        <p>
          <span className={styles.num}>3.3</span> You are responsible for all activity under your
          Account and for keeping your credentials secure. Tell us at{" "}
          <a href="mailto:security@brandosse.com">security@brandosse.com</a> without undue delay if
          you suspect unauthorised access.
        </p>
        <p>
          <span className={styles.num}>3.4</span> One person or organisation per Account. Do not
          share, sell or transfer an Account.
        </p>
      </section>

      {/* ── 4 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="service">
        <h2 className={styles.h2}>4. The Service</h2>
        <p>
          <strong>4.1 What the Service does.</strong> The Service helps you produce and schedule
          social media content. Depending on your plan and workspace it may let you store a brand
          kit; generate captions, images and video clips using third-party AI models; plan and
          schedule posts on a calendar; connect social media accounts; and publish or queue posts to
          those accounts.
        </p>
        <p>
          <strong>4.2 The Service is a tool, not an adviser.</strong> Output is generated
          automatically. We do not review it before it reaches you, and we do not verify its
          accuracy, originality, legality or suitability. You are solely responsible for reviewing
          everything before you publish it.
        </p>
        <p>
          <strong>4.3 Beta and limited features.</strong> No feature of the Service is simulated,
          mocked or non-functional: every capability offered performs the action it describes. If we
          later introduce a feature that is simulated or in preview, it will be labelled as such in
          the interface and named in this section before you can use it. Such features are provided
          without any commitment, may change or be withdrawn at any time, and are excluded from any
          availability commitment.
        </p>
        <p>
          <strong>4.4 Connection limits.</strong> The number of Connected Accounts available to you
          is limited by your plan and by the capacity of our upstream publishing provider. On the
          free plan you may connect one social account. Paid plans allow more, as stated on the
          pricing page at the time you subscribe. We may cap or queue connections and will tell you
          the current limit in the Service.
        </p>
        <p>
          <strong>4.5 Changes.</strong> We may add, change or remove features. If we materially
          reduce a feature you are paying for, section 20 applies.
        </p>
      </section>

      {/* ── 5 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="payment">
        <h2 className={styles.h2}>5. Plans, Credits and payment</h2>
        <p>
          <strong>5.1 Charges.</strong> Paid plans and Credit packages are described in the Service.
          Prices are stated in United States Dollars (USD) and are inclusive of Nigerian VAT at 7.5%.
        </p>
        <p>
          <strong>5.2 Payment processing.</strong> Payments are processed by Paystack. We do not
          store your full card details. Your use of the payment processor is also subject to its own
          terms.
        </p>
        <p>
          <strong>5.3 Credits.</strong> Credits are a prepaid licence to use compute capacity. They
          are not money, not a deposit, not redeemable for cash, and carry no interest.
        </p>
        <p>
          <strong>5.4 Consumption.</strong> Credits are consumed when a job starts, not when it
          succeeds to your satisfaction. A generation you dislike has still consumed compute and is
          not refundable on that basis. Where a job fails because of a fault on our side, we will
          restore the Credits.
        </p>
        <p>
          <strong>5.5 Expiry.</strong> Purchased Credits expire 12 months after the date of purchase.
          Free or promotional Credits granted as a monthly allowance expire at the end of the month
          in which they are granted and are replaced by the following month’s allowance; they do not
          accumulate.
        </p>
        <p>
          <strong>5.6 Free allowance.</strong> Any free Credits or trial allowance is granted at our
          discretion, is personal to you, and may be changed or withdrawn for future grants at any
          time. Abuse of free allowances — including creating multiple Accounts to obtain them — is a
          breach of these Terms.
        </p>
        <p>
          <strong>5.7 Failed payment.</strong> If a payment fails or is charged back we may suspend
          paid features until it is resolved.
        </p>
        <p>
          <strong>5.8 Price changes.</strong> We may change prices with at least 30 days of notice,
          effective at your next renewal or purchase. Credits already purchased are unaffected.
        </p>
      </section>

      {/* ── 6 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="refunds">
        <h2 className={styles.h2}>6. Refunds and cancellation</h2>
        <p>
          <span className={styles.num}>6.1</span> Our refund position is set out in the{" "}
          <Link href="/refunds">Refund and Credits Policy</Link>, which forms part of these Terms.
        </p>
        <p>
          <span className={styles.num}>6.2</span> You may cancel a subscription at any time from the
          Service. Cancellation stops future renewals; it does not retroactively refund the current
          period unless the Refund and Credits Policy says otherwise.
        </p>
        <p>
          <strong>6.3 Consumers in Nigeria.</strong> The Federal Competition and Consumer Protection
          Act 2018 gives you rights that these Terms do not and cannot remove — in particular the
          right to a refund where a service is not rendered as agreed. No term of these Terms
          operates to waive that right, and our Refund and Credits Policy is intended to be more
          generous than that statutory minimum, not less.
        </p>
        <p>
          <strong>6.4 Consumers outside Nigeria.</strong> You may have further statutory rights.
          Where a right to withdraw from a distance contract within 14 days applies to you, then by
          starting a generation, render or publishing job before that period ends you expressly ask
          us to begin performance immediately and acknowledge that you lose the right of withdrawal
          as to the Credits that job consumes. Credits you have not consumed remain refundable.
        </p>
      </section>

      {/* ── 7 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="your-content">
        <h2 className={styles.h2}>7. Your Content</h2>
        <p>
          <strong>7.1 You keep ownership.</strong> You retain all rights in Your Content. These Terms
          transfer no ownership of it to us.
        </p>
        <p>
          <strong>7.2 Licence to us.</strong> You grant us a worldwide, non-exclusive, royalty-free
          licence to host, store, copy, transmit, reformat, transcode and display Your Content, and
          to transmit it to the third-party providers listed in our{" "}
          <Link href="/subprocessors">Subprocessors list</Link>, strictly to the extent necessary to
          operate the Service for you, to publish on your instruction, and to comply with law. This
          licence ends when you delete the relevant Content or your Account, subject to section 15.4.
        </p>
        <p>
          <strong>7.3 Your warranties.</strong> You represent and warrant that you own or have all
          rights, licences and consents needed for Your Content, and that our processing of it on
          your instruction will not infringe any third-party right or breach any law. This includes
          model and property releases for identifiable people and places, and rights in any music,
          footage, logo or typeface you supply.
        </p>
        <p>
          <strong>7.4 No training on Your Content by us.</strong> We do not train any model on your
          content, prompts or Output, and we do not sell, license or otherwise make them available to
          anyone for training.
        </p>
        <p>
          Your content is transmitted to the AI providers listed in our{" "}
          <Link href="/subprocessors">Subprocessors list</Link> solely to generate your Output. We
          can only pass on what those providers commit to, so we state each position rather than
          making a single blanket promise. Positions verified against their published terms on 25
          August 2026:
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
          We will update this section, and the Subprocessors list, if any of these positions changes.
        </p>
        <p>
          <strong>7.5 Backups.</strong> You are responsible for keeping your own copies of anything
          important. We are not an archival service.
        </p>
      </section>

      {/* ── 8 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="source-material">
        <h2 className={styles.h2}>8. Source Material retrieved from URLs</h2>
        <div className={`${styles.callout} ${styles.calloutStrict}`}>
          <p>
            <strong>This section is deliberately strict.</strong> You may only submit a link to video
            you own, on a channel we have verified you control. For anything else, upload the file.
          </p>
        </div>
        <p>
          <span className={styles.num}>8.1</span> Some features let you paste a link and have the
          Service retrieve the media at that link for processing. We accept a link only where the
          channel or account hosting that video is one you have connected to Brandosse and which we
          have verified you control. Video published by anyone else is not accepted from a link, in
          any circumstance — including video you have licensed, video you have been given permission
          to use, and video that is publicly accessible without restriction. If you hold rights in
          video that you cannot verify this way, upload the file instead. Uploading is always
          available, is not restricted by this section, and is governed by section 7.
        </p>
        <p>
          <span className={styles.num}>8.2</span> When you submit such a link you represent and
          warrant that:
        </p>
        <ol className={styles.alpha}>
          <li>
            you own the media at that URL, or hold a written licence covering the copying,
            downloading, editing and republication you are asking us to do;
          </li>
          <li>
            your instruction does not breach the terms of service of the site the media is hosted on;
          </li>
          <li>
            the media contains no third-party rights you have not cleared, including music, footage,
            trademarks and personal likenesses; and
          </li>
          <li>
            the media is lawful and does not breach our{" "}
            <Link href="/acceptable-use">Acceptable Use Policy</Link>.
          </li>
        </ol>
        <p>
          <span className={styles.num}>8.3</span> We act purely on your instruction as a technical
          intermediary. We do not select, curate or verify Source Material.
        </p>
        <p>
          <span className={styles.num}>8.4</span> We may refuse, cancel or delete any retrieval
          request, with or without reason, and we may block domains entirely.
        </p>
        <p>
          <span className={styles.num}>8.5</span> Retrieved Source Material is cached for up to 24
          hours after the job reaches a final state and then deleted.
        </p>
        <p>
          <span className={styles.num}>8.6</span> Your indemnity at section 18 applies in full to
          Source Material, and it is the clause most likely to be invoked. If you are not certain you
          have the rights, upload your own file instead.
        </p>
      </section>

      {/* ── 9 ─────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="ai-output">
        <h2 className={styles.h2}>9. AI Output</h2>
        <p>
          <strong>9.1 Ownership.</strong> As between you and us, and conditional on your Account
          being in good standing and any amounts due having been paid, we assign to you all right,
          title and interest we may hold in the Output generated for you, and we make no claim of
          ownership over it. You may use Output for any lawful purpose, including commercially,
          including after you stop using the Service.
        </p>
        <p>
          We must be equally clear about the limit of that assignment: we can only assign rights we
          actually have. Material generated by an AI model may attract limited or no copyright
          protection in your jurisdiction — in several jurisdictions, material produced without
          sufficient human authorship is not protectable at all. We therefore make no representation
          that Output is protectable, that you can stop anyone else using identical or similar
          material, or that the same or similar Output has not been and will not be generated for
          another user. This section transfers whatever we have; it does not warrant that what we
          have is worth anything. Section 9.2 governs originality and infringement.
        </p>
        <p>
          We will not use your Output as a portfolio piece, case study, or marketing example without
          your prior written consent.
        </p>
        <p>
          <strong>9.2 No warranty of originality or accuracy.</strong> AI models are probabilistic.
          Output may be inaccurate, misleading, offensive, or substantially similar to material
          generated for someone else or to existing third-party work. We do not warrant that Output
          is original, non-infringing, accurate, or fit for any purpose, and we do not warrant that
          it can be protected by copyright in your jurisdiction.
        </p>
        <p>
          <strong>9.3 You must review before publishing.</strong> You are the publisher. Every
          factual claim, price, statistic, legal or health statement, hashtag, mention and image in
          Output is your responsibility once you post it.
        </p>
        <p>
          <strong>9.4 Likeness and real people.</strong> You may generate depictions of yourself —
          your own face, body or voice — and, with their documented written consent, members of your
          own team or organisation whose likeness you are authorised to use. You may not generate, or
          attempt to generate, a depiction of any other real, identifiable person. This includes
          public figures, celebrities, politicians, competitors, and private individuals, whether or
          not the depiction is flattering, and whether or not it is labelled as AI-generated. If the
          Service produces an image resembling a real person you did not set out to depict, that is
          an artefact of how the model works, not permission to use it. Do not publish it.
        </p>
        <p>
          <strong>9.5 Disclosure.</strong> You are responsible for any AI-disclosure labelling
          required by the platform you publish to or by law in your market.
        </p>
        <p>
          <strong>9.6 Third-party models.</strong> Output is produced by the model providers listed
          in our <Link href="/subprocessors">Subprocessors list</Link>. Your use of the Service is
          also subject to their usage policies, and we pass their restrictions through to you.
        </p>
      </section>

      {/* ── 10 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="acceptable-use">
        <h2 className={styles.h2}>10. Acceptable use</h2>
        <p>
          You must comply with the <Link href="/acceptable-use">Acceptable Use Policy</Link>. Breach
          of it is a material breach of these Terms and may result in immediate suspension under
          section 15.
        </p>
      </section>

      {/* ── 11 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="connected-accounts">
        <h2 className={styles.h2}>11. Connected Accounts and third-party platforms</h2>
        <p>
          <span className={styles.num}>11.1</span> When you connect a social media account you
          authorise us to act on your behalf on that platform, within the scope you approve, until
          you disconnect.
        </p>
        <p>
          <span className={styles.num}>11.2</span> Each platform has its own terms, rate limits,
          content rules and API restrictions. You remain bound by them. Nothing in the Service
          overrides them.
        </p>
        <p>
          <span className={styles.num}>11.3</span> Platforms change, deprecate and revoke API access
          without notice, and may suspend accounts for automated posting. We are not responsible for
          a platform rejecting, delaying, throttling, removing or de-ranking your content, or for a
          platform suspending your account.
        </p>
        <p>
          <span className={styles.num}>11.4</span> We may disconnect an account that repeatedly
          fails, that a platform tells us to disconnect, or whose behaviour puts our provider access
          at risk.
        </p>
        <p>
          <span className={styles.num}>11.5</span> Scheduling is best-effort. A scheduled time is a
          target, not a guarantee.
        </p>
      </section>

      {/* ── 12 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="our-ip">
        <h2 className={styles.h2}>12. Our intellectual property</h2>
        <p>
          <span className={styles.num}>12.1</span> The Service, including its software, design, brand
          and documentation, is owned by us and our licensors. Except for the rights expressly
          granted here, no licence is given.
        </p>
        <p>
          <span className={styles.num}>12.2</span> You must not copy, modify, reverse engineer,
          scrape, resell, or use the Service to build a competing product, or attempt to extract its
          models, prompts or system instructions.
        </p>
        <p>
          <strong>12.3 Feedback.</strong> If you send us suggestions we may use them freely, without
          obligation or compensation.
        </p>
      </section>

      {/* ── 13 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="confidentiality">
        <h2 className={styles.h2}>13. Confidentiality</h2>
        <p>
          Each party will protect the other’s non-public information disclosed in connection with the
          Service with at least reasonable care, and use it only for the purposes of these Terms.
        </p>
      </section>

      {/* ── 14 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="availability">
        <h2 className={styles.h2}>14. Availability</h2>
        <p>
          <strong>14.1 We make no uptime commitment.</strong> The Service is provided on a
          best-effort basis. We do not offer a service level agreement, service credits, or any
          guaranteed availability figure, and none should be inferred from our performance in
          practice.
        </p>
        <p>
          <span className={styles.num}>14.2</span> We may take the Service down for maintenance, and
          will try to give notice for planned downtime.
        </p>
        <p>
          <span className={styles.num}>14.3</span> The Service depends on third parties — hosting,
          model providers, publishing providers, payment processors. Their outage is not our breach.
        </p>
      </section>

      {/* ── 15 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="termination">
        <h2 className={styles.h2}>15. Suspension and termination</h2>
        <p>
          <span className={styles.num}>15.1</span> You may stop using the Service and delete your
          Account at any time from Settings.
        </p>
        <p>
          <span className={styles.num}>15.2</span> We may suspend or terminate your Account
          immediately if you materially breach these Terms or the Acceptable Use Policy, if we are
          required to by law or by an upstream provider, or if your use creates a legal, security or
          financial risk to us or other users.
        </p>
        <p>
          <span className={styles.num}>15.3</span> Where the breach is capable of cure and the risk
          allows, we will give you notice and a chance to fix it first.
        </p>
        <p>
          <span className={styles.num}>15.4</span> On termination your right to use the Service ends.
          We will delete or de-identify Your Content within 30 days, except where we must keep
          records for legal, tax, security or dispute purposes.
        </p>
        <p>
          <span className={styles.num}>15.5</span> If we terminate your Account for a reason other
          than your breach, we will refund unused Credits and any unexpired prepaid period on a
          pro-rata basis. If we terminate for your breach, section 6 of the{" "}
          <Link href="/refunds">Refund and Credits Policy</Link> applies.
        </p>
        <p>
          <span className={styles.num}>15.6</span> Sections 7.3, 9, 12, 13, 16, 17, 18, 19 and 21
          survive termination.
        </p>
      </section>

      {/* ── 16 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="disclaimers">
        <h2 className={styles.h2}>16. Disclaimers</h2>
        <p>
          <span className={styles.num}>16.1</span> To the fullest extent permitted by law, the
          Service and all Output are provided “as is” and “as available”, without warranties of any
          kind, express or implied, including merchantability, fitness for a particular purpose,
          non-infringement, accuracy, and quiet enjoyment.
        </p>
        <p>
          <span className={styles.num}>16.2</span> We do not warrant that the Service will be
          uninterrupted, secure or error-free, that Output will be accurate or original, or that the
          Service will produce any particular commercial result — reach, engagement, followers, or
          revenue.
        </p>
        <p>
          <span className={styles.num}>16.3</span> Nothing in these Terms excludes liability that
          cannot lawfully be excluded, including for death or personal injury caused by negligence,
          fraud, or the statutory rights of consumers.
        </p>
      </section>

      {/* ── 17 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="liability">
        <h2 className={styles.h2}>17. Limitation of liability</h2>
        <p>
          <span className={styles.num}>17.1</span> To the fullest extent permitted by law, neither
          party is liable for indirect, incidental, special, consequential or punitive damages, or
          for loss of profits, revenue, goodwill, data, or business opportunity, however caused.
        </p>
        <p>
          <span className={styles.num}>17.2</span> Our total aggregate liability arising out of or
          relating to the Service in any twelve-month period is limited to the greater of (a) the
          total amount you paid us in that period, or (b) US$100.
        </p>
        <p>
          <span className={styles.num}>17.3</span> Sections 17.1 and 17.2 do not limit your
          obligations under section 18, or amounts you owe us under section 5.
        </p>
        <p>
          <span className={styles.num}>17.4</span> These limits apply even if a limited remedy fails
          of its essential purpose.
        </p>
      </section>

      {/* ── 18 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="indemnity">
        <h2 className={styles.h2}>18. Indemnity</h2>
        <p>
          <span className={styles.num}>18.1</span> You will defend, indemnify and hold us harmless
          against all claims, damages, losses, liabilities, fines and reasonable legal costs arising
          from:
        </p>
        <ol className={styles.alpha}>
          <li>Your Content;</li>
          <li>Source Material you directed us to retrieve;</li>
          <li>your publication or use of Output;</li>
          <li>your breach of these Terms or the Acceptable Use Policy;</li>
          <li>your breach of a third-party platform’s terms; and</li>
          <li>your infringement of any third-party right.</li>
        </ol>
        <p>
          <span className={styles.num}>18.2</span> We will notify you of the claim, give you control
          of the defence (subject to our right to participate with our own counsel), and cooperate
          reasonably. You may not settle in a way that admits our liability without our consent.
        </p>
      </section>

      {/* ── 19 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="governing-law">
        <h2 className={styles.h2}>19. Governing law and disputes</h2>
        <p>
          <span className={styles.num}>19.1</span> These Terms are governed by the laws of the
          Federal Republic of Nigeria, without regard to conflict-of-law rules.
        </p>
        <p>
          <span className={styles.num}>19.2</span> The courts of Lagos State, Nigeria have exclusive
          jurisdiction over any dispute arising out of or relating to these Terms, and both parties
          submit to that jurisdiction.
        </p>
        <p>
          <span className={styles.num}>19.3</span> Before starting formal proceedings, please contact
          us at <a href="mailto:legal@brandosse.com">legal@brandosse.com</a> and give us 30 days to
          resolve the matter informally.
        </p>
        <p>
          <span className={styles.num}>19.4</span> Nothing in this section deprives you of the
          protection of any mandatory consumer-protection law of the country in which you habitually
          reside, including any right to bring proceedings in your local courts that cannot lawfully
          be excluded. For consumers in Nigeria, the Federal Competition and Consumer Protection Act
          2018, and the jurisdiction of the Federal Competition and Consumer Protection Commission,
          apply regardless of section 19.1.
        </p>
      </section>

      {/* ── 20 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="changes">
        <h2 className={styles.h2}>20. Changes to these Terms</h2>
        <p>
          <span className={styles.num}>20.1</span> We may update these Terms. The current version is
          always at brandosse.com/terms with its effective date.
        </p>
        <p>
          <span className={styles.num}>20.2</span> For material changes that reduce your rights or
          increase your obligations we will give at least 30 days of notice by email or in-product
          notice before they take effect.
        </p>
        <p>
          <span className={styles.num}>20.3</span> Continuing to use the Service after the effective
          date accepts the change. If you do not accept it, stop using the Service and cancel;
          section 6 applies.
        </p>
      </section>

      {/* ── 21 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="general">
        <h2 className={styles.h2}>21. General</h2>
        <p>
          <strong>21.1 Entire agreement.</strong> These Terms, the{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link>, the{" "}
          <Link href="/privacy">Privacy Policy</Link> and the{" "}
          <Link href="/refunds">Refund and Credits Policy</Link> are the entire agreement between us
          on this subject and replace any prior understanding.
        </p>
        <p>
          <strong>21.2 Assignment.</strong> You may not assign these Terms without our written
          consent. We may assign them to an affiliate or in connection with a merger, acquisition or
          sale of assets.
        </p>
        <p>
          <strong>21.3 Severability.</strong> If a provision is unenforceable, it is limited or
          severed to the minimum extent necessary and the rest remains in force.
        </p>
        <p>
          <strong>21.4 No waiver.</strong> Not enforcing a provision is not a waiver of it.
        </p>
        <p>
          <strong>21.5 Force majeure.</strong> Neither party is liable for failure caused by events
          beyond its reasonable control.
        </p>
        <p>
          <strong>21.6 Notices.</strong> We will send notices to your Account email. You send notices
          to <a href="mailto:legal@brandosse.com">legal@brandosse.com</a>.
        </p>
        <p>
          <strong>21.7 No third-party beneficiaries.</strong> Except for our affiliates and licensors
          under sections 16 to 18, no one else may enforce these Terms.
        </p>
        <p>
          <strong>21.8 Relationship.</strong> Nothing here creates a partnership, agency, employment
          or joint venture.
        </p>
      </section>

      {/* ── 22 ────────────────────────────────────────────────────────────── */}
      <section className={styles.section} id="contact">
        <h2 className={styles.h2}>22. Contact</h2>
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
              General — <a href="mailto:support@brandosse.com">support@brandosse.com</a>
              <br />
              Legal — <a href="mailto:legal@brandosse.com">legal@brandosse.com</a>
              <br />
              Privacy — <a href="mailto:privacy@brandosse.com">privacy@brandosse.com</a>
              <br />
              Security — <a href="mailto:security@brandosse.com">security@brandosse.com</a>
            </p>
          </div>
        </div>
      </section>
    </LegalShell>
  );
}
