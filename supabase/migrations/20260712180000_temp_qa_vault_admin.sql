-- TEMPORARY — a parameterized Vault secret setter (the secret VALUE is
-- passed at call time via RPC, never embedded in this file), so the
-- service_role_key Vault secret can be resynced to the current
-- platform-injected value without ever writing the secret itself into a
-- git-tracked file. Deleted immediately after use, alongside the other
-- qa_introspect_* helpers.
CREATE OR REPLACE FUNCTION public.qa_upsert_vault_secret(p_name text, p_value text, p_description text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name, p_description);
  ELSE
    PERFORM vault.update_secret(v_id, p_value);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.qa_upsert_vault_secret(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_upsert_vault_secret(text, text, text) TO service_role;
