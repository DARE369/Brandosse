# 03 — Documentation

> **The failure this prevents is the opposite of the usual one.** This repository has **107 markdown files in `docs/`**, a 112KB `FUNCTIONAL-SPEC.md`, twelve `audit-brief/` files, and per-stage implementation reports. The audit could not use any of it as evidence, because documents described features that had never worked, migrations that had never run, and mitigations that were never configured.
>
> **Too much documentation is worse than too little**, because it produces confident wrong answers. A reader who trusts a stale doc is worse off than one who reads the code.

---

## The rule

> **Code is the source of truth. A document is a claim about code.**
>
> Where they disagree, **the document is a bug** — fix it or delete it. Never leave both standing.

---

## What to write

Only four kinds of document earn their keep:

### 1. Why — decisions and their reasoning

The one thing code genuinely cannot express.

> *"Zernio is the only real publishing provider. The direct per-platform OAuth path was removed because no platform ever had app credentials configured, so it could never publish."*

That comment at `publish-post/index.ts:161-163` answered a question the audit would otherwise have spent hours on. **This is the highest-value documentation in the repository.**

Where it goes: **in the code, at the decision site.** Not in a separate file that will drift away from it.

### 2. Operational runbooks

What to do when something breaks, written for 3am. Concrete commands, not prose.

### 3. Contracts

`.env.example`, API shapes, the DB schema. **These must be exact** — they are checked against reality, so drift is detectable.

### 4. Onboarding — exactly one document

A single `README.md` that gets a new person running. Not eleven overlapping guides.

---

## What NOT to write

| Don't | Why |
|---|---|
| Status reports (`STAGE_7_IMPLEMENTATION_REPORT.md`) | Stale within days. Git history already records this, accurately |
| Feature descriptions duplicating code | Drifts silently; the code is more accurate and always available |
| Plans for work not yet started | Becomes a claim about the present the moment it is skimmed |
| "Complete" reports | The audit found several describing features that had never once run |
| Anything a test could assert | Write the test — it cannot go stale without failing |

---

## Every document carries a header

```markdown
---
status: current | superseded | historical
owner: <who keeps this true>
last-verified: YYYY-MM-DD   # verified against code, not merely edited
supersedes: <path>          # if applicable
---
```

**`last-verified` is the important field.** It records the last time someone checked the document against the code — not the last time someone edited a typo.

**Anything unverified for 90 days is presumed stale** and must be re-verified or deleted.

---

## Deletion is maintenance

Deleting a stale document is a **contribution**, not a loss. Git retains it.

Bias hard toward deletion:

- Superseded → delete, don't mark. `docs/` currently holds multiple superseded design-system documents that still read as authoritative.
- Duplicated by code → delete.
- Nobody has opened it in six months → delete.
- Contradicted by the code → **delete immediately**, then decide whether it needs rewriting.

### Debt to clear during lockdown

`docs/` needs an explicit pass under the [Completion Lockdown](../audit/11-lockdown-plan.md): 107 files, each triaged to **keep-and-verify / rewrite / delete**. Known contradictions already found — the `GRAPHICS_*.md` set, the stage reports, superseded design-system docs, and `VIDEO_LAB_COMPLETE_GUIDE.md` (which additionally contains a live secret at line 538).

---

## Code comments

Comment the **why**, never the what.

```python
# BAD  — restates the code
# Set the client with the API key
client = AsyncAnthropic(api_key=config.anthropic_api_key)

# GOOD — records a decision and its consequence
# Key comes from config, not os.environ, so startup validation protects this
# stage. This stage has NO mock branch: clip scoring is the product's core
# intelligence, and a silent fallback to fabricated scores is never an
# acceptable degradation.
client = AsyncAnthropic(api_key=config.anthropic_api_key)
```

**Comments that record a defect and its fix are especially valuable.** The migration comment at `20260710090000_baseline_core_tables.sql:118-119` — *"confirm live whether #2 still exists and should be explicitly dropped"* — pointed directly at the cross-tenant leak, five months before anyone looked. It was right. Nobody acted on it.

**If you write a comment like that, open an issue in the same commit.** An unactioned warning in a comment is a finding nobody owns.

---

## Checklist

- [ ] Does this belong in code as a comment instead?
- [ ] Could a test assert this instead?
- [ ] Header present with `status`, `owner`, `last-verified`?
- [ ] Does it contradict any existing doc? If so, delete that one.
- [ ] Does it describe intent as though it were reality? Rewrite.
- [ ] Any secret, key, or token in the body?
