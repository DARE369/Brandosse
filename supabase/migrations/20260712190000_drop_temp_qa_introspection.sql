-- Removes the temporary, read-only introspection/admin helper functions
-- created in 20260712130000_temp_qa_introspection.sql,
-- 20260712160000_temp_qa_introspection_fk.sql, and
-- 20260712180000_temp_qa_vault_admin.sql — used only to diagnose live-only
-- drift during the 2026-07-12 QA pass (see audit-brief/qa-kit and FIXLOG).
-- Not meant to be permanent product code.
DROP FUNCTION IF EXISTS public.qa_introspect_policies(text, text);
DROP FUNCTION IF EXISTS public.qa_introspect_grants(text, text);
DROP FUNCTION IF EXISTS public.qa_introspect_extension(text);
DROP FUNCTION IF EXISTS public.qa_introspect_cron_jobs();
DROP FUNCTION IF EXISTS public.qa_introspect_vault_secret_names();
DROP FUNCTION IF EXISTS public.qa_introspect_fk_constraints(text, text);
DROP FUNCTION IF EXISTS public.qa_upsert_vault_secret(text, text, text);
