# Decisions made — record

Every decision taken across 2026-08-25, as written into the documents. Check it:
if a row does not say what you meant, that is the row to correct, and the
documents follow from it.

**Status:** ✅ settled and written · ⏳ awaiting a value you will supply

---

## Identity

| # | Decision | Status |
|---|---|---|
| 1 | Entity: **Lordsway Energy**, a **private company limited by shares**, Nigeria, single owner | ✅ ⏳ reg. number |
| 2 | Governing law **Nigeria**; exclusive jurisdiction **courts of Lagos State** | ✅ |
| 3 | Address **8 Venia Place, Lekki Phase 1, Lagos**. Contacts `support@` `privacy@` `legal@` `security@` `abuse@brandosse.com` | ✅ |
| 4 | Product **Brandosse** at **brandosse.com** | ✅ |

> I spelled it **Lekki**; you wrote "Leki". Correct me if the registration differs
> — it appears in every document.

## Money

| # | Decision | Status |
|---|---|---|
| 5 | **Paystack.** Stripe is off the table — it does not operate in Nigeria | ✅ — billing rebuild, BUILD-TASKS 7 |
| 6 | **NGN**, prices **inclusive of 7.5% VAT** | ✅ |
| 7 | Refunds rewritten on Paystack mechanics. **We absorb the Paystack fee** — customer gets 100% back | ✅ |
| 8 | Paid Credits expire at **12 months**; free allowance **resets monthly**, does not accumulate | ✅ |

### The refund terms, and why each one is what it is

You asked me to plan these properly rather than pick a number, so here is the
reasoning. All of it is now in
[REFUND-AND-CREDITS-POLICY.md](REFUND-AND-CREDITS-POLICY.md).

**Nigerian law sets the floor and you cannot go below it.** Under the FCCPA 2018
a blanket "no refund" term is void against a consumer, and a refund is owed
wherever a service is not rendered as agreed. So §2 of the policy states that
explicitly and says the FCCPA wins where the two differ. Writing it that way is
not generosity — a clause that tries to exclude it is simply unenforceable, and
including it signals you know the law.

**Automatic restoration, no request needed (§3).** Your worker already refunds
credits when a job fails ([job_runner.py:165,177](../video-worker/job_runner.py)).
The policy now says so. This was previously invisible to users, which meant you
were doing the right thing and getting no credit for it.

**First purchase, 7 days, no questions (§4).** Your decision. I added two
guardrails: **once per account**, and consumed credits deducted at the rate
charged. Without the first, someone can buy-and-refund repeatedly for free
compute; without the second, the window is a free-compute coupon.

**Paystack keeps its processing fee on a refund** — Paystack refunds the customer
in full and retains its fee (1.5% + ₦100, capped ₦2,000). So every refund costs
you the fee. I wrote it so **you absorb it and the customer gets the full amount
back** — your decision. On a ₦15,000 package that fee is about ₦325.

**180-day hard limit (§8).** Paystack can only reverse a charge within 180 days.
Past that, refunds go by manual bank transfer. The policy says so rather than
promising something the rails cannot do.

**Chargebacks (§9).** If you do not respond to a Paystack dispute within its SLA,
it is **auto-accepted** — the customer is refunded and you forfeit the funds. So
the policy asks people to email first, and there is an ops requirement behind it:
a monitored inbox. That is not a legal task, it is a "money leaves silently" task.

## Customers

| # | Decision | Status |
|---|---|---|
| 9 | **Open to both consumers and businesses**, with an FCCPA carve-out and a dormant EEA/UK withdrawal clause | ✅ confirmed |

## AI

| # | Decision | Status |
|---|---|---|
| 10 | **We assign you all rights we hold in Output**, and state plainly we cannot warrant those rights amount to anything | ✅ |
| 11 | **Pollinations removed everywhere.** You were right — no live call exists | ✅ |
| 12 | Provider training posture stated **per provider**, not as one blanket claim | ✅ |
| 13 | **Turn on every no-training / zero-retention setting the providers offer** | ✅ decided — BUILD-TASKS 13 |
| 14 | Likeness: **your own face only**, plus team members with documented written consent | ✅ |

**What item 13 means in practice**, since the providers differ:

- **Anthropic** — already contractually no-training on the commercial API, deletes
  within 30 days. Zero Data Retention exists but is for qualifying enterprise
  accounts; worth asking for, not worth blocking on.
- **Groq** — already contractually no-training. Two switches to flip in the
  console: **zero data retention**, and **opt out of troubleshooting logging** in
  Data Controls. Both are account settings, not code.
- **fal.ai** — the gap. Its privacy policy is silent on training. Two actions:
  ask for written confirmation and sign their DPA, and set the
  `X-Fal-Object-Lifecycle-Preference` header so generated media is not held on
  their CDN for the 7-day default.

## Video pipeline

| # | Decision | Status |
|---|---|---|
| 15 | Links accepted **only for video the user owns**, verified via a connected channel. Everything else uploads | ✅ — BUILD-TASKS 8 |
| 16 | **Source video deleted 24 hours** after the job reaches a final state; **clips deleted at 7 days** | ✅ |
| 17 | Burner-cookie authentication removed alongside item 15 | ✅ — BUILD-TASKS 8 |

## Privacy

| # | Decision | Status |
|---|---|---|
| 18 | Hosting: Supabase **Ireland `eu-west-1`** · Fly.io **London `lhr` (UK)** · Vercel **unpinned** | ✅ ⏳ Vercel region |
| 19 | Purge 30 days after deletion · requests ack 72h, complete 30 days · logs and errors 90 days · financial records 7 years | ✅ |
| 20 | Users delete **their own posts, chats and sessions** directly; **account deletion stays a request** | ✅ — BUILD-TASKS 11 |
| 20b | **Both** Brandosse staff and workspace admins can delete content — each disclosed separately in Privacy §5.1 | ✅ |
| 21 | **NDPA 2023 and GDPR both** | ✅ |
| 22 | **Register with the NDPC** as a Data Controller of Major Importance | ✅ decided |
| 23 | No DPO appointed; founder is the named privacy contact. Policy stays **silent on NDPC registration until the certificate issues** | ✅ |
| 24 | Minimum age **18** | ✅ |

## Operations

| # | Decision | Status |
|---|---|---|
| 25 | **No uptime commitment.** No SLA, no service credits | ✅ |
| 26 | Liability cap: **greater of 12-month fees paid or ₦150,000** | ✅ |
| 27 | **30 days** notice for Terms and price changes | ✅ |
| 28 | **Nothing simulated at launch** — mock publishing must be removed, not labelled | ✅ — BUILD-TASKS 6 |
| 29 | Free tier: **one** connected account | ✅ |
| 30 | Customer output **not** used as Brandosse marketing without written consent | ✅ defaulted |
| 31 | Agency DPA **available on request**, drafted when one is asked for | ✅ defaulted |

---

## Sources

- Stripe country coverage — [Countries where Stripe isn't available](https://usllcglobal.com/guides/countries-where-stripe-not-available) · [Is Stripe available in Nigeria in 2026?](https://mazinooyolo.com/blog/stripe-account-in-nigeria/)
- Paystack refunds — [Refunds (developer docs)](https://paystack.com/docs/payments/refunds/) · [Initiating and completing a refund](https://support.paystack.com/en/articles/2127106) · [How to resolve chargebacks](https://support.paystack.com/en/articles/2125698) · [Handling disputes at scale](https://paystack.com/blog/operations/the-paystack-guide-to-handling-disputes-at-scale) · [Transactions pricing](https://support.paystack.com/en/articles/2130306)
- NDPA / NDPC — [NDPC](https://ndpc.gov.ng/) · [NDPC registration guidance (Andersen)](https://ng.andersen.com/ndpc-issues-guidance-notice-on-the-registration-of-data-controllers-and-processors-of-major-importance/) · [KPMG Nigeria](https://kpmg.com/ng/en/home/insights/2024/03/nigeria-data-protection-commissions-guidance-notice-on-registration-of-data-processors-controllers-of-major-importance.html)
- FCCPA — [Omaplex](https://omaplex.com.ng/the-legality-of-no-refund-policies-under-nigerian-consumer-protection-law/) · [The Firma](https://thefirmaadvisory.com/new-blog/2024/2/14/the-concept-of-no-returns-no-refunds-in-e-commerce-and-consumer-rights-under-the-federal-competition-and-consumer-protection-act-fccpa-2018)
- AI providers — [Anthropic data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) · [Groq Services Agreement](https://console.groq.com/docs/legal/services-agreement) · [Your data in GroqCloud](https://console.groq.com/docs/your-data) · [fal.ai Privacy Policy](https://www.fal.ai/legal/privacy-policy) · [fal.ai DPA](https://fal.ai/legal/data-processing-addendum)
