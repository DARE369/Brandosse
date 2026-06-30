DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connected_accounts'
      AND policyname = 'ca_super_admin_read'
  ) THEN
    CREATE POLICY "ca_super_admin_read"
      ON public.connected_accounts
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_roles ar
          WHERE ar.user_id = auth.uid()
            AND ar.role = 'super_admin'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connection_events'
      AND policyname = 'conn_events_super_admin_read'
  ) THEN
    CREATE POLICY "conn_events_super_admin_read"
      ON public.connection_events
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_roles ar
          WHERE ar.user_id = auth.uid()
            AND ar.role = 'super_admin'
        )
      );
  END IF;
END
$$;
