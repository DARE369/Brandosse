-- Atomic credit deduction RPC for generateImage / generateVideo edge functions.
-- Called via adminClient (service role bypasses RLS).
-- Returns (new_balance INT, ok BOOLEAN):
--   ok=true  → deduction succeeded, new_balance is the post-deduction balance
--   ok=false → insufficient balance (or no row), new_balance is current balance

CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id UUID,
  p_amount  INT
)
RETURNS TABLE(new_balance INT, ok BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.user_credits
  SET
    balance           = balance - p_amount,
    lifetime_consumed = lifetime_consumed + p_amount,
    updated_at        = NOW()
  WHERE user_id = p_user_id
    AND balance >= p_amount;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT COALESCE(
               (SELECT uc.balance FROM public.user_credits uc WHERE uc.user_id = p_user_id),
               0
             )::INT,
             FALSE;
  ELSE
    RETURN QUERY
      SELECT (SELECT uc.balance FROM public.user_credits uc WHERE uc.user_id = p_user_id)::INT,
             TRUE;
  END IF;
END;
$$;

-- Refund: called by edge functions when generation fails after a successful deduction.
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_user_id UUID,
  p_amount  INT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.user_credits
  SET
    balance           = balance + p_amount,
    lifetime_consumed = GREATEST(0, lifetime_consumed - p_amount),
    updated_at        = NOW()
  WHERE user_id = p_user_id;
END;
$$;

-- One-time backfill: seed user_credits from profiles.credits for users who
-- have a profile but no user_credits row yet.
INSERT INTO public.user_credits (user_id, balance, lifetime_purchased, lifetime_consumed)
SELECT
  p.id,
  GREATEST(COALESCE(p.credits, 0), 0),
  0,
  0
FROM public.profiles p
INNER JOIN auth.users u ON u.id = p.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_credits uc WHERE uc.user_id = p.id
)
ON CONFLICT (user_id) DO NOTHING;
