-- TEMPORARY — see 20260712130000_temp_qa_introspection.sql header. Deleted
-- along with that file's functions once the personal_assets FK fix lands.
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
