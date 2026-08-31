# Build tasks created by the legal documents

**Every item here is a place where a document makes a promise the code does not
yet keep.** Until each is done, the corresponding document is a claim rather than
a description — which is exactly the failure mode the repo's second law names.

Ordered by whether it blocks launch. Each cites the code it concerns, or says
UNVERIFIED.

---

## Blocking — the documents are untrue without these

### 1. Publish and route the legal pages, and fix the dead consent links
[src/pages/Auth/Register.jsx:397-399](../src/pages/Auth/Register.jsx#L397-L399)

Every user who signs up today agrees to a "Terms of Service" and "Privacy Policy"
that link to `href="#"`. There are no `/terms`, `/privacy`, `/acceptable-use`,
`/refund-policy` or `/subprocessors` routes anywhere in the app.

Needed: five routes, real links, and the pages rendered from these documents.

### 2. Record what each user accepted, and when
**No consent record exists.** Grepping the 100 migrations for
`terms_accepted`, `tos_version` or a consent column returns nothing relevant —
the one `accepted_at` hit is
[org_workspace_foundation.sql:118](../supabase/migrations/20260324100000_org_workspace_foundation.sql#L118),
which is organisation invitations, not terms acceptance.

Needed: store the **version** of the Terms and Privacy Policy each user accepted
and the timestamp. Without it you cannot prove what anyone agreed to, and the
30-day change-notice mechanism in Terms §20 has nothing to compare against.

### 3. Age declaration at signup — 18+
[src/pages/Auth/Register.jsx](../src/pages/Auth/Register.jsx)

Terms §3.1 and Privacy §12 now state a hard 18+ minimum. The signup form collects
no date of birth and asks for no age confirmation. A checkbox is sufficient; it
must be recorded with the consent record from item 2.

### 4. Warn before clips are deleted
[video-worker/retention.py:53](../video-worker/retention.py#L53)

Clips are deleted 7 days after a job finishes. **Nothing in the interface says
so** — not on the results screen, not on the job list, not in an email. A user
who returns on day 10 finds their work gone with no warning ever given.

Needed at minimum: the deletion date shown on the results and job list. Better: a
prompt to save anything worth keeping. Gated on open decision **D**.

### 5. Delete source video 24 hours after the job finishes
Storage bucket `video-source-cache`; retention job UNVERIFIED — I found the clip
reaper at `retention.py` but **no deletion path for the source cache**.

Terms §8.5 and Privacy §3.6 now promise 24-hour deletion. Build the reaper, and
assert its post-condition, or the promise is false the day it publishes.

### 6. Nothing simulated at launch
[src/services/platforms/mockPublishService.js](../src/services/platforms/mockPublishService.js),
[supabase/functions/_shared/mockPublish.ts](../supabase/functions/_shared/mockPublish.ts),
[supabase/functions/mock-publish/](../supabase/functions/mock-publish/)

Terms §4.3 now states that **no feature is simulated at launch.** Mock publishing
must be removed, or hard-gated off in production and unreachable — not merely
labelled. If any mocked path can execute for a real user, §4.3 is false.

### 7. Rebuild billing on Paystack
[src/pages/Billing/BillingPage.jsx](../src/pages/Billing/BillingPage.jsx),
[src/lib/video-engine/types.ts](../src/lib/video-engine/types.ts); `STRIPE_SECRET_KEY`
and `STRIPE_WEBHOOK_SECRET` in `.env.example`

**Decided: Paystack.** Stripe does not operate in Nigeria, so the existing Stripe
checkout cannot serve Lordsway Energy and is rebuilt, not adapted.

Needed: Paystack initialise-transaction + verify flow, Paystack webhook signature
verification replacing the Stripe one, NGN amounts in kobo, and the Stripe env
vars retired. Note Paystack settles in NGN only — pricing is naira, as decided.

---

## Required by a decision you made, not blocking launch day

### 8. Channel-ownership verification for video links
[video-worker/stages/download.py](../video-worker/stages/download.py),
[app/api/video/submit/route.ts](../app/api/video/submit/route.ts)

Terms §8.1 now says links are accepted **only** for video hosted on a channel the
user has connected and we have verified they control. Today, `submit` accepts any
YouTube or Twitter/X URL.

Needed: at submission, resolve the source channel and check it against the user's
verified connected accounts. Reject everything else with a message pointing at
upload.

**Also remove the burner-cookie authentication** while you are in here. Once
links are restricted to the user's own channels, authenticating as a throwaway
account has no legitimate purpose left, and it is the part that converts a terms
breach into deliberate circumvention.

### 9. Credit expiry
**No expiry logic exists** — no `expires_at` or equivalent in
[credit-monthly-reset](../supabase/functions/credit-monthly-reset/) or
[videoEngineData.js](../src/services/videoEngineData.js).

Terms §5.5 now promises purchased Credits expire at 12 months and the free
allowance resets monthly without accumulating. Both need implementing, and
**confirm what `credit-monthly-reset` actually does today** before the policy
describes it as a monthly reset.

### 10. Connected-account limits
**No enforcement found** — no `max_accounts`, `account_limit` or equivalent
anywhere in `src/` or `supabase/`.

Terms §4.4 states a free-tier connection cap. It must be enforced server-side, and
the refusal must name the limit rather than failing generically. Gated on open
decision **G**.

### 11. User-deletable content
[src/pages/Settings/DataPrivacyTab.jsx](../src/pages/Settings/DataPrivacyTab.jsx)

You decided users delete their **own posts, chats and sessions** directly, while
**account** deletion stays a request. Privacy §9 is written that way. Verify each
of those three delete paths actually exists and hard-deletes; account deletion
stays as the existing request row.

### 12. Admin deletion of generated data
You said admins should be able to delete data they generated. Not written into
the Privacy Policy yet, because I do not know whether you mean platform admins or
organisation admins — they have different disclosure consequences. Tell me which
and I will add it.

### 13. Turn on every no-training / zero-retention control the providers offer
**Decided.** Three different things, only one of which is code:

- **Groq — two console toggles, no code.** Enable **zero data retention**, and
  **opt out of troubleshooting logging** under Data Controls. Groq is already
  contractually barred from training on inputs; these switches remove the
  residual 30-day troubleshooting logs.
- **Anthropic — already covered by default.** The commercial API does not train
  on inputs or outputs and deletes within 30 days. Zero Data Retention is an
  enterprise-tier agreement — worth requesting, not worth blocking on.
- **fal.ai — see item 14.** No training commitment exists to enable.

### 14. fal.ai media lifecycle header
[supabase/functions/_shared/fal.service.ts](../supabase/functions/_shared/fal.service.ts)

fal.ai holds generated media on its CDN for a minimum of 7 days by default, but
accepts an `X-Fal-Object-Lifecycle-Preference` header per request. You are not
setting it. Setting it shortens third-party retention of your users' generated
images and video for the cost of one header.

---

## Known, tracked, not created by this work

### 14. Organisation / business dashboard
You noted it is not fully built. Nothing in the legal documents depends on it,
**except** the agency DPA (open decision **K**) — agencies are the users who will
ask for one.

### 15. Direct platform API integrations
Open decision **H**. When you start, the Subprocessor list changes: Zernio comes
out, each platform goes in. Note that Meta and TikTok app review both require a
**live privacy policy URL** — which items 1 and 2 above produce, so this work
depends on them rather than competing with them.

---

## Verification standard

Per the repo's first law, each of these is done when it is **fixed + proven +
guarded** — not when the code is written. For the ones that are promises to
users, the guard matters more than usual: a retention job that silently stops is
indistinguishable from a retention policy that was never true, and item 5 and
item 4 are both the kind of background work that has degraded silently in this
codebase before.
