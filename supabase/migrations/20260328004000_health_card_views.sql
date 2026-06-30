CREATE OR REPLACE VIEW public.user_account_health_summary AS
SELECT
  ca.user_id,
  COUNT(*) FILTER (
    WHERE coalesce(ca.connection_status, 'active') IN ('active', 'mock')
      AND coalesce(ca.consecutive_failure_count, 0) = 0
  ) AS healthy_count,
  COUNT(*) FILTER (
    WHERE coalesce(ca.connection_status, 'active') NOT IN ('active', 'mock')
      OR coalesce(ca.consecutive_failure_count, 0) > 0
  ) AS issues_count,
  COUNT(*) FILTER (
    WHERE coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
  ) AS total_count,
  MAX(ca.last_successful_publish_at) AS last_publish_at,
  BOOL_OR(coalesce(ca.consecutive_failure_count, 0) >= 3) AS has_critical
FROM public.connected_accounts ca
WHERE ca.scope = 'personal'
  AND coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
GROUP BY ca.user_id;

CREATE OR REPLACE VIEW public.org_account_health_summary AS
SELECT
  ca.organization_id,
  COUNT(*) FILTER (
    WHERE coalesce(ca.connection_status, 'active') IN ('active', 'mock')
      AND coalesce(ca.consecutive_failure_count, 0) = 0
  ) AS healthy_count,
  COUNT(*) FILTER (
    WHERE coalesce(ca.connection_status, 'active') NOT IN ('active', 'mock')
      OR coalesce(ca.consecutive_failure_count, 0) > 0
  ) AS issues_count,
  COUNT(*) FILTER (
    WHERE coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
  ) AS total_count,
  MAX(ca.last_successful_publish_at) AS last_publish_at
FROM public.connected_accounts ca
WHERE ca.scope = 'organization'
  AND coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
GROUP BY ca.organization_id;
