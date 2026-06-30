INSERT INTO public.organization_plans (
  plan_key,
  display_name,
  monthly_credit_allocation,
  max_members,
  max_brand_projects,
  max_connected_accounts,
  features
)
VALUES
  (
    'individual',
    'Individual',
    500,
    1,
    1,
    5,
    '{"approval_pipeline": false, "common_room": false, "shared_library": false, "brand_projects": false}'::jsonb
  ),
  (
    'organization',
    'Organization',
    2000,
    NULL,
    1,
    20,
    '{"approval_pipeline": true, "common_room": true, "shared_library": true, "brand_projects": false}'::jsonb
  ),
  (
    'agency',
    'Agency',
    10000,
    NULL,
    NULL,
    NULL,
    '{"approval_pipeline": true, "common_room": true, "shared_library": true, "brand_projects": true}'::jsonb
  )
ON CONFLICT (plan_key) DO NOTHING;

UPDATE public.organizations
SET plan_key = CASE
  WHEN lower(coalesce(plan_key, plan, 'organization')) = 'agency' THEN 'agency'
  WHEN lower(coalesce(plan_key, plan, 'organization')) = 'individual' THEN 'individual'
  ELSE 'organization'
END
WHERE plan_key IS NULL
   OR plan_key NOT IN ('individual', 'organization', 'agency');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_plan_key_fkey'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_plan_key_fkey
      FOREIGN KEY (plan_key)
      REFERENCES public.organization_plans(plan_key);
  END IF;
END
$$;
