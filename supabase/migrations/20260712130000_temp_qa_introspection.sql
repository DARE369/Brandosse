-- TEMPORARY, read-only introspection helper — created to diagnose live-only
-- RLS/config drift discovered during QA verification (see audit-brief/qa-kit).
-- Deleted (via a follow-up migration) immediately after use. Not meant to be
-- permanent product code — SECURITY DEFINER, granted to service_role ONLY.
CREATE OR REPLACE FUNCTION public.qa_introspect_policies(p_table text, p_schema text DEFAULT 'public')
RETURNS TABLE(policyname text, cmd text, permissive text, roles text[], qual text, with_check text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT policyname::text, cmd::text, permissive::text, roles, qual::text, with_check::text
  FROM pg_policies
  WHERE schemaname = p_schema AND tablename = p_table;
$$;

REVOKE ALL ON FUNCTION public.qa_introspect_policies(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_introspect_policies(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.qa_introspect_grants(p_table text, p_schema text DEFAULT 'public')
RETURNS TABLE(grantee text, privilege_type text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT grantee::text, privilege_type::text
  FROM information_schema.role_table_grants
  WHERE table_schema = p_schema AND table_name = p_table;
$$;

REVOKE ALL ON FUNCTION public.qa_introspect_grants(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_introspect_grants(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.qa_introspect_extension(p_name text)
RETURNS TABLE(extname text, extversion text, extnamespace_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.extname::text, e.extversion::text, n.nspname::text
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = p_name;
$$;

REVOKE ALL ON FUNCTION public.qa_introspect_extension(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_introspect_extension(text) TO service_role;

CREATE OR REPLACE FUNCTION public.qa_introspect_cron_jobs()
RETURNS TABLE(jobname text, schedule text, active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY EXECUTE 'SELECT jobname::text, schedule::text, active FROM cron.job';
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.qa_introspect_cron_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_introspect_cron_jobs() TO service_role;

CREATE OR REPLACE FUNCTION public.qa_introspect_vault_secret_names()
RETURNS TABLE(name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY EXECUTE 'SELECT name::text FROM vault.decrypted_secrets';
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.qa_introspect_vault_secret_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_introspect_vault_secret_names() TO service_role;

CREATE OR REPLACE FUNCTION public.qa_introspect_fk_constraints(p_table text, p_schema text DEFAULT 'public')
RETURNS TABLE(conname text, confdeltype text, definition text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.conname::text,
         c.confdeltype::text,
         pg_get_constraintdef(c.oid)::text
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = p_schema AND t.relname = p_table AND c.contype = 'f';
$$;

REVOKE ALL ON FUNCTION public.qa_introspect_fk_constraints(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_introspect_fk_constraints(text, text) TO service_role;
