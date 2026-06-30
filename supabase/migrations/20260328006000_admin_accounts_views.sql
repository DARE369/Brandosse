CREATE OR REPLACE VIEW public.platform_account_health_overview AS
SELECT
  COUNT(*) FILTER (
    WHERE coalesce(connection_status, 'active') NOT IN ('revoked', 'disconnected')
  ) AS total_connected,
  COUNT(*) FILTER (
    WHERE health_score > 70
      AND coalesce(connection_status, 'active') IN ('active', 'mock')
      AND coalesce(consecutive_failure_count, 0) = 0
  ) AS healthy,
  COUNT(*) FILTER (
    WHERE (
      health_score BETWEEN 30 AND 70
      OR coalesce(consecutive_failure_count, 0) BETWEEN 1 AND 2
    )
      AND coalesce(connection_status, 'active') NOT IN ('revoked', 'disconnected')
  ) AS degraded,
  COUNT(*) FILTER (
    WHERE health_score < 30
      OR coalesce(consecutive_failure_count, 0) >= 3
      OR coalesce(connection_status, 'active') IN ('error', 'expired', 'reconnecting')
  ) AS critical
FROM public.connected_accounts
WHERE coalesce(connection_status, 'active') NOT IN ('revoked', 'disconnected');
