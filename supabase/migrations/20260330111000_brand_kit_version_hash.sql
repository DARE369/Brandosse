ALTER TABLE public.brand_kit
  ADD COLUMN IF NOT EXISTS version_hash text;

