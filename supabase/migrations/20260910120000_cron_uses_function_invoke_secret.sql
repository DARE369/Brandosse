-- 20260910120000_cron_uses_function_invoke_secret.sql
--
-- Re-point every scheduled function call at the new caller-auth scheme.
--
-- ── The defect this closes ───────────────────────────────────────────────────
-- Every cron job in this product has been silently failing with 401. Nothing
-- raised, nothing retried, and nothing anywhere reported it: pg_cron records the
-- job as having run, because issuing the HTTP request IS the job. A 401 in the
-- response body is not a failed cron run.
--
-- Root cause, diagnosed 2026-09-10: this project has Supabase's NEW API key
-- system enabled. The edge runtime is injected with the new-style keys — its
-- SUPABASE_ANON_KEY holds the `sb_publishable_…` value and its
-- SUPABASE_SERVICE_ROLE_KEY holds the `sb_secret_…` value. Every caller,
-- including these cron jobs, still presents the LEGACY service_role JWT from
-- Vault. PostgREST accepts that JWT, so the database kept working perfectly and
-- only the functions broke — which is why this looked inexplicable for so long.
--
-- Affected, all of them: refresh-social-tokens (so no OAuth token was ever
-- refreshed), process-jobs (the video pipeline's own sweeper) and
-- process-risk-alerts.
--
-- ── Why the secret is NOT in the Authorization header ───────────────────────
-- Because Supabase's API gateway validates that header as a JWT before the
-- function runs. An opaque secret there is rejected upstream with
-- UNAUTHORIZED_INVALID_JWT_FORMAT and never reaches our code. Verified live.
--
-- So a machine caller sends both:
--   Authorization:   Bearer <service_role_key from Vault>  -- satisfies the
--                    gateway. Any valid project JWT does; it authorises nothing.
--   X-Invoke-Secret: <function_invoke_secret from Vault>   -- the real check,
--                    performed by requireInvokeSecret() in
--                    supabase/functions/_shared/connectionHelpers.ts.
--
-- ── No secret value appears in this file ────────────────────────────────────
-- Both are read from Vault at execution time, so nothing sensitive enters git
-- or `cron.job.command`.
--
-- PREREQUISITE — Vault must hold a secret named `function_invoke_secret` whose
-- value is EXACTLY the FUNCTION_INVOKE_SECRET set on the edge functions.
--
-- Deliberately not written here as ready-to-run SQL with a placeholder in it.
-- That is how this went wrong on 2026-09-10: the placeholder text was pasted
-- verbatim into vault.create_secret, Vault stored the literal string
-- "<FUNCTION_INVOKE_SECRET from .env.local>", and every cron kept being refused
-- while this migration reported success. Section 0 now rejects such a value,
-- but the better fix is not to hand anyone a loaded template.
--
-- Build the statement with the real value substituted BEFORE it reaches an
-- editor — and check it afterwards, do not assume:
--
--   SELECT length(decrypted_secret),
--          encode(digest(decrypted_secret, 'sha256'), 'hex')
--   FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret';
--
-- Rotating means changing BOTH sides: the Vault secret and
-- `npx supabase secrets set FUNCTION_INVOKE_SECRET=…`. They must match exactly.
--
-- VERIFY:
--   SELECT jobname, schedule FROM cron.job ORDER BY jobname;
--   SELECT j.jobname, d.status, d.start_time
--   FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
--   ORDER BY d.start_time DESC LIMIT 10;
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ── 0. Refuse to proceed without the secret ─────────────────────────────────
--
-- Fail closed, loudly. Re-registering the jobs without the secret in Vault
-- would replace three currently-broken jobs with three differently-broken jobs
-- and report success — which is precisely the silence being fixed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is not installed. Enable it via Database > Extensions, then re-apply.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret'
  ) THEN
    RAISE EXCEPTION
      'Vault has no secret named function_invoke_secret. Create it first, using the '
      'FUNCTION_INVOKE_SECRET value from .env.local. Without it every scheduled run '
      'would keep failing, and this migration would hide that behind a success.';
  END IF;

  -- Reject a value that is obviously not a secret.
  --
  -- This exists because it happened: on 2026-09-10 the literal placeholder text
  -- from these instructions was stored in Vault instead of the secret. Vault
  -- accepted it, this migration's existence check passed, and every cron kept
  -- being refused — the same silence the migration was written to end. An
  -- existence check is not a validity check.
  --
  -- The 32-character floor mirrors MIN_INVOKE_SECRET_LENGTH in
  -- _shared/connectionHelpers.ts, so a value this migration accepts is one the
  -- functions will also accept.
  PERFORM 1
  FROM vault.decrypted_secrets
  WHERE name = 'function_invoke_secret'
    AND (
      length(decrypted_secret) < 32
      OR decrypted_secret ~ '[<>[:space:]]'
    );

  IF FOUND THEN
    RAISE EXCEPTION
      'The Vault secret function_invoke_secret is not a usable secret: it is shorter '
      'than 32 characters, or contains whitespace or angle brackets. That is the shape '
      'of placeholder text or a quoted/newline-padded paste, not a generated secret. '
      'Replace it with the exact FUNCTION_INVOKE_SECRET value from .env.local and re-apply.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key'
  ) THEN
    RAISE EXCEPTION
      'Vault has no secret named service_role_key. It is still needed — not as '
      'authorisation, but as a valid JWT to satisfy the API gateway.';
  END IF;
END
$$;

-- ── 1. Re-register each job with both headers ───────────────────────────────

DO $$
DECLARE
  jobname_v  text;
  fn_v       text;
  schedule_v text;
  job_id     bigint;
  base_url   text;
BEGIN
  -- Derived from an existing job rather than hardcoded, so this migration
  -- cannot point a re-registered job at the wrong project.
  SELECT substring(command from 'https://[a-z0-9]+\.supabase\.co')
    INTO base_url
  FROM cron.job
  WHERE command LIKE '%functions/v1/%'
  LIMIT 1;

  IF base_url IS NULL THEN
    RAISE EXCEPTION
      'Could not determine the project URL from any existing cron job. Refusing '
      'to guess: a job pointed at the wrong host would fail silently forever.';
  END IF;

  FOREACH jobname_v IN ARRAY ARRAY['refresh-social-tokens', 'process-jobs', 'process-risk-alerts']
  LOOP
    fn_v := jobname_v;   -- job name and function name coincide for all three

    -- Defaults used only if the job does not exist yet. If it does, its own
    -- cadence is preserved — silently changing a schedule somebody chose would
    -- be its own small betrayal.
    schedule_v := CASE jobname_v
                    WHEN 'process-jobs'        THEN '* * * * *'
                    WHEN 'process-risk-alerts' THEN '*/15 * * * *'
                    ELSE '*/30 * * * *'
                  END;

    SELECT j.jobid, j.schedule INTO job_id, schedule_v
    FROM cron.job j WHERE j.jobname = jobname_v LIMIT 1;

    IF job_id IS NOT NULL THEN
      PERFORM cron.unschedule(job_id);
    ELSE
      schedule_v := CASE jobname_v
                      WHEN 'process-jobs'        THEN '* * * * *'
                      WHEN 'process-risk-alerts' THEN '*/15 * * * *'
                      ELSE '*/30 * * * *'
                    END;
    END IF;

    PERFORM cron.schedule(
      jobname_v,
      schedule_v,
      format($job$
        SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
            'X-Invoke-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret' LIMIT 1)
          ),
          body := '{}'::jsonb
        )
      $job$, base_url || '/functions/v1/' || fn_v)
    );

    RAISE NOTICE 're-registered % on %', jobname_v, schedule_v;
  END LOOP;
END
$$;

-- ── 2. Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE
  missing text;
  stale   text;
BEGIN
  -- 2a. All three exist and are active.
  SELECT string_agg(n, ', ') INTO missing
  FROM unnest(ARRAY['refresh-social-tokens', 'process-jobs', 'process-risk-alerts']) AS n
  WHERE NOT EXISTS (
    SELECT 1 FROM cron.job j WHERE j.jobname = n AND j.active
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'post-condition failed: job(s) missing or inactive: %', missing;
  END IF;

  -- 2b. Every one of them now sends the invoke secret. A job that still relies
  --     on the Authorization header alone is a job that will keep 401ing, and
  --     the whole point of this migration is that such a job looks healthy.
  SELECT string_agg(j.jobname, ', ') INTO stale
  FROM cron.job j
  WHERE j.jobname IN ('refresh-social-tokens', 'process-jobs', 'process-risk-alerts')
    AND j.command NOT LIKE '%X-Invoke-Secret%';

  IF stale IS NOT NULL THEN
    RAISE EXCEPTION 'post-condition failed: job(s) still lack X-Invoke-Secret: %', stale;
  END IF;

  -- 2c. No secret leaked into the stored command. cron.job is readable by more
  --     roles than Vault is, so a literal here would be a real exposure.
  SELECT string_agg(j.jobname, ', ') INTO stale
  FROM cron.job j
  WHERE j.jobname IN ('refresh-social-tokens', 'process-jobs', 'process-risk-alerts')
    AND j.command NOT LIKE '%vault.decrypted_secrets%';

  IF stale IS NOT NULL THEN
    RAISE EXCEPTION
      'post-condition failed: job(s) do not read from Vault, so a secret may be '
      'stored literally in cron.job.command: %', stale;
  END IF;

  RAISE NOTICE 'all three cron jobs now authenticate with X-Invoke-Secret, read from Vault.';
END
$$;

COMMIT;
