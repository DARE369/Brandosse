# Legal documents

**Status: DRAFTS. Not reviewed by a lawyer. Not publishable.**

I am not a lawyer and these are not legal advice. They are structured, factually
accurate first drafts written from the actual codebase, intended to cut a
lawyer's review time — and bill — down to checking judgement calls rather than
reconstructing what the product does. Have a Nigerian lawyer review them before
publishing.

## What is here

| Document | Purpose | Status |
|---|---|---|
| [DECISIONS-MADE.md](DECISIONS-MADE.md) | Record of all 31 decisions and the reasoning | Complete |
| [DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) | What is still open | 2 values |
| [BUILD-TASKS.md](BUILD-TASKS.md) | Where the code must catch up to a promise | 15 items |
| [TERMS-OF-SERVICE.md](TERMS-OF-SERVICE.md) | The main contract | Drafted |
| [PRIVACY-POLICY.md](PRIVACY-POLICY.md) | Required by law; linked at signup | Drafted |
| [ACCEPTABLE-USE-POLICY.md](ACCEPTABLE-USE-POLICY.md) | What users may not do | Drafted |
| [REFUND-AND-CREDITS-POLICY.md](REFUND-AND-CREDITS-POLICY.md) | Credits, expiry, refunds | Drafted |
| [SUBPROCESSORS.md](SUBPROCESSORS.md) | Every third party that touches user data | Drafted |
| *Data Processing Agreement* | For agency customers | Deferred until an agency asks |

## Outstanding values

Two, both waiting on you:

- `{{EFFECTIVE_DATE}}` and the CAC registration number — set when Lordsway Energy
  Limited is registered.
- `{{VERCEL_REGION}}` — see [DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) item 1.

```bash
grep -rn "{{" legal/     # everything still unfilled
```

## The shape of the agreement

- **Lordsway Energy Limited**, a private company limited by shares, Nigeria
- **Nigerian law**, exclusive jurisdiction of the Lagos State courts
- **Open to consumers and businesses**, with FCCPA consumer rights preserved and a
  dormant EEA/UK withdrawal clause for later
- **Paystack**, naira, VAT-inclusive
- **NDPA 2023 and GDPR** both, with NDPC registration under way
- Data in **Ireland** (primary) and the **United Kingdom** (video processing)

## How these were written

Against the codebase, per repo rule 2 — *code is the source of truth,
documentation is a claim.* Every factual assertion about what the product does,
what data it collects, and who it goes to is cited to `file:line` in
[SUBPROCESSORS.md](SUBPROCESSORS.md) or traceable to the audit behind these
drafts. Nothing was inferred from a filename, a README, or a UI label.

Where the product does less than a user might assume — account deletion is a
manual request, scheduling is best-effort, fal.ai's training posture is unknown —
the drafts say so plainly. An overstated privacy policy is a misrepresentation,
not a marketing win, and the one claim we cannot verify is left marked as
unverified rather than upgraded to a promise.

## Before any of this goes live

[BUILD-TASKS.md](BUILD-TASKS.md) lists 15 places where a document currently
promises something the code does not do. Seven of them block publication — the
documents are untrue until those ship. The first is that
[Register.jsx:397-399](../src/pages/Auth/Register.jsx#L397-L399) already makes
every new user agree to a Terms of Service and Privacy Policy that link to
`href="#"`.
