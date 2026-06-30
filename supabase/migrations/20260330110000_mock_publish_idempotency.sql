ALTER TABLE public.mock_publish_logs
  ADD COLUMN IF NOT EXISTS publish_request_id text;

CREATE INDEX IF NOT EXISTS idx_mock_publish_logs_request_id
  ON public.mock_publish_logs(publish_request_id, post_id, connected_account_id);

