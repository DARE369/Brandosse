# Privacy Policy

**Status: DRAFT — NOT LEGALLY REVIEWED. DO NOT PUBLISH.**
All decisions are settled. The only outstanding values are `{{EFFECTIVE_DATE}}`
(set on the day Lordsway Energy is registered), the CAC registration number, and
`{{VERCEL_REGION}}`.

**Effective date:** {{EFFECTIVE_DATE}}
**Last updated:** {{EFFECTIVE_DATE}}

---

## 1. Who we are

Lordsway Energy, a private company limited by shares registered in Nigeria under registration number ⟨PENDING⟩, of
8 Venia Place, Lekki Phase 1, Lagos, Nigeria, is the **data controller** for the personal data
described here.

Contact us about privacy at **privacy@brandosse.com**.

We have not appointed a Data Protection Officer. Our privacy contact is the account named below, who is responsible for handling all data protection enquiries and requests.

This policy covers Brandosse at brandosse.com and its related
services (the "Service").

## 2. A summary, in plain terms

- We collect what you give us (account details, brand assets, uploads, prompts)
  and what the Service produces for you.
- To generate content, **we send your prompts, brand kit and reference images to
  third-party AI providers.** That is unavoidable — it is how the Service works.
  Section 5 lists exactly who.
- To publish, we send your finished post and media to a publishing provider,
  which sends it to the social platform you chose.
- We do not sell your personal data, and we do not use behavioural advertising.
- We currently run no analytics or ad-tracking cookies. Verified in code as of
  2026-08-25.

## 3. What we collect

### 3.1 You give us

| Data | Examples | Why |
|---|---|---|
| Account | Email, password hash, display name, account type | Create and secure your account |
| Google sign-in | Email, name, profile picture, Google account ID | Optional sign-in method |
| Profile and workspace | Business name, role, organisation membership, invitations | Run your workspace |
| Brand kit | Logos, colours, fonts, tone-of-voice notes, product descriptions | Personalise generated content |
| Uploads | Images, video files, documents you add to a library | Store and use in your posts |
| Prompts and briefs | What you type to generate a caption, image or plan | Produce Output |
| Source Material links | URLs you paste for the Service to retrieve | Retrieve and process the media |
| Support messages | Anything you email or send us | Answer you |

### 3.2 Generated for you

Captions, images, videos, content plans, schedules, scores and analyses produced
by the Service, plus the generation history and credit ledger showing what ran
and what it cost.

### 3.3 Connected social accounts

When you connect a social account we store the access and refresh tokens, the
account identifier and handle, the platform, and the connection status. We store
tokens to act on your instruction and hold them only while the connection is
live.

### 3.4 Collected automatically

| Data | Source | Why |
|---|---|---|
| Session and authentication cookies | Our app | Keep you signed in |
| IP address, user agent, request timestamps | Server and edge logs | Security, abuse prevention, rate limiting, debugging |
| Error reports, stack traces, breadcrumbs | Sentry | Diagnose faults |
| Job and worker logs | Our processing pipeline | Run and debug generation and video jobs |

### 3.5 Payment data

Card details go **directly to our payment processor** and are never stored on our
systems. We keep the transaction record: amount, currency, status, timestamp,
package purchased, and the processor's customer and transaction identifiers.

### 3.6 Cached Source Material

If you paste a link, the media retrieved from it is stored in a private cache
bucket while your job runs and for 24 hours after the job reaches a final state.
That media may contain personal data of people appearing in it — see section 3.7.

### 3.7 Personal data of other people

Your Content may contain personal data about others (clients, staff, people in
photos, followers). Where it does, **you are the controller and we act on your
instruction.** You are responsible for having a lawful basis, giving those people
notice, and obtaining any consent or release required. If you are using Brandosse to manage social accounts on behalf of your own clients, a Data Processing Agreement is available on request from privacy@brandosse.com.

## 4. How we use it, and our legal basis

| Purpose | Legal basis (GDPR Art. 6) |
|---|---|
| Create your account, provide the Service, generate and publish content | Performance of a contract |
| Take payment, manage credits, prevent chargeback fraud | Contract; legal obligation |
| Send transactional email (confirmation, password reset, job and invitation notices) | Contract |
| Keep the Service secure, detect abuse, enforce limits | Legitimate interests |
| Diagnose faults and improve reliability | Legitimate interests |
| Comply with tax, accounting and law-enforcement obligations | Legal obligation |
| Marketing email about the Service | Consent, withdrawable at any time |

Where we rely on legitimate interests, we have weighed them against your rights
and will explain the assessment on request.

## 5. Who we share it with

We share personal data only with the processors listed in
[`SUBPROCESSORS.md`](SUBPROCESSORS.md), which is part of this policy. That list
names each provider, what it receives, and what it is used for. The categories
are:

- **Infrastructure** — application hosting, database, file storage, video
  processing.
- **AI model providers** — receive your prompts, brand kit text, and reference
  or source images and video needed to generate Output.
- **Publishing provider** — receives the post content, media and the connected
  account authorisation needed to publish.
- **Email provider** — receives your email address and the message content.
- **Error monitoring** — receives technical diagnostics, which may incidentally
  include identifiers.
- **Payment processor** — receives payment and billing details directly.

We also disclose data where legally required, to enforce our Terms, to protect
rights and safety, and to a successor in a merger or acquisition (we will tell
you first).

**We do not sell personal data and we do not share it for cross-context
behavioural advertising.**

### 5.1 Who can see and delete your content

Two categories of person can reach your content beyond you, and you should know
about both.

**Brandosse staff.** A small number of our administrators can access user
accounts and content through an internal admin console, and can delete content —
including content generated through the Service. We do this only to operate the
Service: to investigate a fault you have reported, to respond to a legal request,
to enforce the [Acceptable Use Policy](ACCEPTABLE-USE-POLICY.md), or to action a
deletion you asked for. Access is limited to staff who need it, and we do not
browse user content for any other reason.

**Your workspace administrators.** If you belong to an organisation workspace,
the administrators of that workspace can see and delete content created inside it
by any member, including content you created. If your employer or client owns the
workspace, they — not you — control that content. If you are unsure who
administers your workspace, ask them before putting personal material into it.

## 6. AI processing — read this one

To generate content, the Service transmits to third-party model providers: your
prompt text, relevant brand kit content, and any reference image, uploaded media
or retrieved Source Material the request needs.

Do not paste anything into a prompt that you would not be comfortable sending to
a third-party AI provider — passwords, payment details, health data, government
identifiers, or another person's confidential information.

**We do not train any model on your content, prompts or Output**, and we do not
sell, license or otherwise make them available to anyone for training.

Your content is transmitted to the AI providers listed in
[`SUBPROCESSORS.md`](SUBPROCESSORS.md) solely to generate your Output. We can
only pass on what those providers commit to, so we state each position rather
than making a single blanket promise. Verified against their published terms on
2026-08-25:

- **Anthropic** — contractually undertakes not to train on commercial API inputs
  or outputs, and deletes them within 30 days.
- **Groq** — contractually prohibited from using inputs or outputs for training
  or fine-tuning; does not retain inference inputs and outputs by default.
- **fal.ai** — its published privacy policy **does not address model training**,
  and we have not obtained written confirmation. Until we have, you should not
  assume any training restriction applies to material sent to image, video,
  editing or upscaling features. Generated media is held on fal.ai's CDN for a
  minimum of 7 days.

We will update this section, and the Subprocessor list, if any of these positions
changes.

Model providers apply their own retention. Where a provider offers zero- or
limited-retention terms we use them; where it does not, we say so in
[`SUBPROCESSORS.md`](SUBPROCESSORS.md).

## 7. International transfers

We are established in Nigeria and our infrastructure runs in Europe. Where your
data physically sits depends on which part of the Service you use:

| What | Where it is processed |
|---|---|
| Account, profile, workspace, brand kit, uploads, generated Output, credit ledger | **Ireland** (European Union) |
| Video clipping — source download, transcription, rendering | **United Kingdom** (London) |
| The web application and its server functions | {{VERCEL_REGION}} |
| AI generation, publishing, email, error monitoring, payments | The regions operated by the providers in [`SUBPROCESSORS.md`](SUBPROCESSORS.md) |

The United Kingdom is not part of the European Union. If you are in the EEA, your
video source material is therefore transferred to a third country. The UK holds a
European Commission adequacy decision, and that is the basis we rely on for that
transfer.

For transfers to Nigeria and to providers outside the EEA and UK, we rely on
Standard Contractual Clauses and on the transfer mechanisms available under the
Nigeria Data Protection Act 2023, and we require every processor to apply
appropriate safeguards under contract.

## 8. How long we keep it

| Data | Retention |
|---|---|
| Account and profile | While your account is open |
| Content, brand kit, uploads, generated Output | While your account is open, or until you delete the item |
| Video source material you supplied | 24 hours after the job reaches a final state |
| Rendered video clips | 7 days after the job reaches a final state, then permanently deleted |
| Connected account tokens | Until you disconnect or the token is revoked |
| Credit ledger and transaction records | 7 years, to meet tax and accounting obligations |
| Security and access logs | 90 days |
| Error reports | 90 days |
| Everything else, after account deletion | 30 days |

## 9. Your rights

Depending on where you live you may have the right to: access your data; correct
it; delete it; restrict or object to processing; receive it in a portable format;
withdraw consent; and not be subject to solely automated decisions with legal or
similarly significant effects.

**How to exercise them.** Use **Settings → Data and Privacy** in the Service to
request an export or account deletion, or email privacy@brandosse.com.

**How the request is handled — stated plainly.** Export and deletion are
currently **request-based and fulfilled manually by our team**, not automated.
When you submit a request we record it and action it within
72 hours for acknowledgement and 30 days for completion. We will confirm by email when it is done.

**Complaints.** If you are in Nigeria, you may complain to the Nigeria Data Protection Commission (NDPC). If you are in the EEA or UK, you may complain to your local supervisory authority. You may always
complain to us first at privacy@brandosse.com.

## 10. Security

We use encryption in transit, hashed credentials, row-level access control that
isolates each workspace, scoped API keys held server-side, signed webhooks, and
private storage buckets.

No system is perfectly secure. If a breach affects your personal data and is
likely to result in a risk to your rights, we will notify you and the relevant
authority as the law requires.

Report a vulnerability to security@brandosse.com.

## 11. Cookies

We set only what the Service needs to function:

| Cookie type | Purpose | Essential |
|---|---|---|
| Authentication / session | Keep you signed in | Yes |
| Security / CSRF state | Protect sign-in and account-connection flows | Yes |
| Preference | Remember theme and layout choices | Yes, functional |

**We currently run no analytics, advertising or third-party tracking cookies** —
verified against the codebase on 2026-08-25. If that changes, we will
update this policy and ask for consent where required before setting them.

## 12. Children

The Service is not for anyone under 18. We do not knowingly
collect their data. If you believe a child has given us data, contact
privacy@brandosse.com and we will delete it.

## 13. Changes to this policy

We will post updates here with a new effective date, and give notice by email or
in-product notice for material changes.

## 14. Contact

Lordsway Energy
8 Venia Place, Lekki Phase 1, Lagos, Nigeria
Privacy: privacy@brandosse.com · Security: security@brandosse.com · General: support@brandosse.com
