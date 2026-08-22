# 01 — Versioning

> **The failure this prevents:** the audit found **89 tables/views live vs 65 `CREATE TABLE` statements in migrations**, plus ~24 live-only objects including `trending_topics`, `content_pillars`, and `optimal_posting_times`. Live-only RPCs and RLS policies existed that no migration described — and one of those undocumented policies is the cross-tenant data leak (P10s-001). **The deployed state of this system was not knowable from the repository.** That is the single most expensive class of defect found.

---

## 1. Database schema

### The rule

**The migration directory is the only mechanism by which live schema changes.** No SQL Editor changes, no dashboard edits, no manual policy tweaks — ever. If it isn't in `supabase/migrations/`, it must not exist in the database.

### Migration file standard

`supabase/migrations/YYYYMMDDHHMMSS_short_snake_description.sql`

Every migration begins with a header block stating:

```sql
-- <filename>
--
-- WHAT: one line
-- WHY: the defect or requirement, with a citation (finding ID, or file:line)
-- SAFE TO RE-RUN: yes/no  (aim for yes — use IF EXISTS / IF NOT EXISTS)
-- VERIFY: the exact command or query that proves it worked
```

**Requirements:**

- **Idempotent by default.** `DROP ... IF EXISTS` before `CREATE`. A migration you cannot re-run is a migration you cannot recover with.
- **Wrapped in `BEGIN; ... COMMIT;`** so a partial apply is impossible.
- **Post-condition assertions.** End with a `DO $$ ... RAISE EXCEPTION ... $$` block that fails loudly if the end state is wrong. See `20260821090000_fix_cross_tenant_rls_posts_generations.sql` for the pattern — it asserts an exact policy count.
- **Assert the end state, don't assume the start state.** Because drift is real, prefer "drop everything not on this allowlist, then create the correct set" over "drop the one policy I think is there."

### ⚠️ RLS: never fix by dropping named policies

> **RLS policies are OR-ed. The policy causing your problem is, by definition, the one you do not know about.**

Dropping and recreating the policies you *can* see leaves any additional permissive policy intact — and it still grants. The migration applies cleanly, reports success, and changes nothing observable.

This is not hypothetical; it cost two migrations on 2026-08-21:

| | Approach | Result |
|---|---|---|
| `20260821120000` | Dropped 2 policies on `profiles` **by name**, recreated correctly | Applied cleanly. **Exploit still worked.** |
| `20260821140000` | **Allowlist sweep** + asserted exactly 2 UPDATE policies survive | Exploit returns **403** |

**The required pattern:**

```sql
-- 1. Drop everything not on the allowlist, and LOG what you removed —
--    that log is how the unknown policy finally gets identified.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='<table>'
      AND policyname NOT IN ('<known>', '<good>', '<set>')
  LOOP
    RAISE WARNING 'dropping unexpected policy -> %', pol.policyname;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.<table>', pol.policyname);
  END LOOP;
END; $$;

-- 2. Recreate the intended set.
-- 3. Assert the exact count — a third policy would OR around your fix.
```

**And verify behaviourally, never by reading the policy.** A `204` from PostgREST does not mean the write landed — it is also what you get when RLS filters the row out of the UPDATE. Re-read the value. `scripts/security/cross-tenant-probe.mjs` does exactly this and is the reference implementation.

### Drift detection — mandatory

> `supabase db push` is **forbidden without a preceding diff**. The CLI's migration-history table is known to be out of sync with this project's live schema; a blind push can drop or recreate objects unexpectedly.

Before any schema work:

```bash
node scripts/security/cross-tenant-probe.mjs      # behavioural check
# and capture live schema truth:
curl -s "$SUPABASE_URL/rest/v1/" -H "apikey: $SERVICE_KEY" \
     -H "Authorization: Bearer $SERVICE_KEY" > /tmp/openapi.json
```

The PostgREST OpenAPI document is readable with the service-role key and no DB password. It gives **tables, columns, types, and RPCs** — but **not RLS policies**. Policies require `pg_policies` via SQL access, and their absence from routine tooling is precisely how the leak went unseen. **A drift check that cannot see policies is not a complete drift check.**

### Schema version marker

Every migration that changes schema shape appends to a `schema_versions` record (table, migration filename, applied_at, live-object counts). The point is a queryable answer to *"what is actually deployed?"* that does not depend on the CLI's history table.

---

## 2. Edge functions

51 functions in `supabase/functions/` deploy independently of the app. **Deployed ≠ committed** unless verified.

### The rules

- Every function carries a header comment with its purpose, callers, and last-reviewed date.
- **`scripts/check-edge-functions.cjs` must run in CI.** It exists and currently runs nowhere — a guard that never executes is theatre.
- Deploys are scripted, never ad hoc from a laptop.
- A function that no code calls is **deleted**, not left deployed. The audit found `generate-caption` fully wired, correct, and invoked by no UI.

### Shared-module discipline

`supabase/functions/_shared/` is the versioning hot spot: a change to `llm.ts` or `seo.ts` alters behaviour across many functions simultaneously, with no per-function version pin. Treat every `_shared/` change as a **breaking change across all consumers** and review accordingly.

---

## 3. Application releases

Semantic versioning in `package.json`, with a `CHANGELOG.md` maintained per release.

```
MAJOR — breaking change to a user-facing contract or data shape
MINOR — new capability (blocked entirely during the completion lockdown)
PATCH — fix, with no contract change
```

Each entry links the finding ID or issue it closes. A release note that cannot cite what changed is not a release note.

---

## 4. Model and provider versioning

> **The failure this prevents:** `_shared/llm.ts:51` defaulted to `claude-3-5-sonnet-latest` — a 2024 model — with `ANTHROPIC_MODEL` unset in every environment inspected. Combined with a silent Groq outage, **every piece of content the product generated was produced by a two-generation-old model nobody had chosen.**

### The rules

- **Model IDs are pinned explicitly in configuration.** Never rely on a code default, and never on a `-latest` alias for production output quality.
- **Model choice is a versioned decision.** Record which model serves which task, and why, in the changelog.
- **A provider fallback firing is an alerting event, not a silent success.** Groq failed 100% for days while Claude quietly absorbed it — correct behaviour, invisible consequence, inverted cost.
- Prompts are versioned with the model they were tuned against. A model change requires a prompt re-validation pass.

---

## 5. Configuration and secrets

- `.env.example` is the contract and must list **every** variable the code reads. The audit found `FAL_API_KEY` in the example but not in `.env.local`, and `REPLICATE_API_TOKEN` in `.env.local` but not the example.
- **Startup validation over runtime discovery.** A missing credential for an enabled feature must refuse to boot. See `video-worker/config.py:validate_runtime_credentials()`.
- **Fail-closed defaults, always.** `use_mock_anthropic` defaulted to `True`: omitting one variable silently produced fabricated AI output while reporting healthy. Mock modes are opt-in, never default.
- Secrets never enter git. A live `WORKER_WEBHOOK_SECRET` sat in `docs/VIDEO_LAB_COMPLETE_GUIDE.md:538` and matched the current value in two environment files.

---

## Checklist — any change touching versioned state

- [ ] Change is in a migration / committed function / pinned config — not applied by hand
- [ ] Migration is idempotent, transactional, and asserts its post-condition
- [ ] Drift checked before and after; the behavioural probe re-run
- [ ] `.env.example` updated if a variable was added or removed
- [ ] Model or prompt changes are pinned and recorded
- [ ] `CHANGELOG.md` entry cites the finding or issue
- [ ] A guard exists proving it stays correct (see [04](04-production-readiness.md))
