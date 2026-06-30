CREATE INDEX IF NOT EXISTS idx_connection_events_account_recent
  ON public.connection_events(connected_account_id, created_at DESC);

CREATE OR REPLACE VIEW public.connected_accounts_health_summary AS
SELECT
  ca.id,
  ca.user_id,
  ca.organization_id,
  ca.brand_project_id,
  ca.scope,
  ca.platform,
  ca.account_name,
  ca.display_name,
  ca.username,
  ca.profile_type,
  ca.profile_picture_url,
  ca.avatar_url,
  ca.connection_status,
  ca.health_score,
  ca.consecutive_failure_count,
  ca.last_failure_at,
  ca.last_failure_reason,
  ca.last_successful_publish_at,
  ca.total_posts_published,
  ca.total_posts_scheduled,
  ca.is_mock,
  ca.mock_token,
  ca.token_expires_at,
  ca.follower_count,
  ca.account_category,
  ca.granted_member_ids,
  pr.brand_color,
  pr.display_name AS platform_display_name,
  pr.icon_url,
  pr.supported_profile_types,
  pr.supported_content_types,
  pr.supports_stories,
  pr.supports_reels,
  pr.supports_carousels,
  pr.character_limit
FROM public.connected_accounts ca
JOIN public.platform_registry pr
  ON pr.platform_key = ca.platform
WHERE coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected');
