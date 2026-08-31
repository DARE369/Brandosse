# Still open — 2 values and 1 question

Everything else is settled and written. See [DECISIONS-MADE.md](DECISIONS-MADE.md).

---

## 1. Vercel's function region — how to find it, and what I recommend

`vercel.json` sets **no `regions` key**, so your Next.js server functions run in
whatever the project default is. That is why the dashboard is not showing you a
region — nothing has pinned one.

**Where to look:** Vercel Dashboard → your project → **Settings** → **Functions**
→ **Function Region**. That single value is the answer.

**Why it matters.** Vercel's default for new projects is `iad1` — Washington DC,
**United States**. If that is what yours says, your application server functions
are processing EU and UK personal data in the US, and the Privacy Policy has to
disclose a US transfer with Standard Contractual Clauses behind it. That is a
materially bigger disclosure than the one currently drafted.

**Recommendation: pin it to Dublin and stop guessing.** Add to `vercel.json`:

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build:next",
  "installCommand": "npm ci",
  "regions": ["dub1"]
}
```

`dub1` is Dublin — the **same country as your Supabase instance** (`eu-west-1`,
Ireland). Three benefits at once: every database round-trip becomes local instead
of transatlantic, all your primary data stays in one jurisdiction, and the
transfer section of the Privacy Policy gets simpler rather than more complicated.

Redeploy after adding it. Then tell me the region and I will fill
`{{VERCEL_REGION}}`.

*(Note: on the Hobby plan, function region is a single choice; Pro allows
multiple. One is what you want here regardless.)*

---

## 2. The CAC registration number

Confirmed: **Lordsway Energy is a private company limited by shares.** Written
into both documents that name the entity.

Outstanding: the registration number, once the CAC issues it. It goes in one line
of the Terms and one line of the Privacy Policy, and it sets
`{{EFFECTIVE_DATE}}` — the documents take effect the day the company exists.

---

## 3. The one thing from your last message I still could not read

> *"what if it must be read or needs to be backed and $30 for sale?"*

I could not make this out, and the "$30" makes me think it concerns pricing or a
package. I am not going to guess a number that ends up in a contract, so it is
still waiting. If it no longer matters, say so and I will drop it.

---

## Your Fly.io region raised something worth knowing

Your screenshot and [fly.toml:47](../video-worker/fly.toml#L47) both confirm
`primary_region = "lhr"` — **London**.

The UK left the EU, so the video worker is in a **third country** as far as EU
data protection is concerned. This is not a problem: the UK holds a European
Commission adequacy decision, which means transfers there are permitted without
extra safeguards. The Privacy Policy now says so explicitly, with a table showing
Ireland for your primary data and the UK for video processing.

It does mean **both EU GDPR and UK GDPR are in play**, which the policy already
handles. No decision needed — just do not move the worker somewhere without
adequacy without telling me.

**Separately, and not a legal matter:** that screenshot also shows *one machine in
one region*, with Fly's own notice that there is no redundancy. Consistent with
having no uptime commitment, which you chose — but if the video worker dies, the
whole clipping product is down until you notice.

---

## Tracked, no decision needed

- **fal.ai training confirmation** — one email, then sign their
  [DPA](https://fal.ai/legal/data-processing-addendum). The Privacy Policy keeps
  its honest "they do not say, and we have not confirmed" line until it comes
  back. Do not let me upgrade that claim on an assumption.
- **Groq console switches** — zero data retention, and opt out of troubleshooting
  logging under Data Controls. Two toggles, no code.
- **NDPC registration** — decided. The Privacy Policy stays silent on it until the
  certificate is issued, then I add one line.
- **Agency DPA** — drafted when an agency actually asks.
- **Direct platform APIs** — when you start, Zernio leaves the subprocessor list
  and each platform joins it.
