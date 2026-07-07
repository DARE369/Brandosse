-- Adds real per-category credit spend tracking (Images/Video/Carousels/Edits)
-- so the dashboard's "credit balance" card can show a real breakdown instead
-- of no breakdown at all.
--
-- Rolls deduct_credits/refund_credits into the single source of truth for
-- BOTH the balance update AND the ledger row — previously deduct_credits only
-- touched user_credits.balance and no ledger row was written for image/video
-- generation at all (only the Python video-worker wrote consumption rows,
-- and only for job-based video processing, with no category).
--
-- Backward compatible: p_category/p_description are optional (DEFAULT NULL),
-- so any existing caller that only passes p_user_id/p_amount keeps working
-- exactly as before, just without a category tag.

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS category TEXT
    CHECK (category IN ('image', 'video', 'carousel', 'edit', 'other'));

COMMENT ON COLUMN public.credit_transactions.category IS
  'What kind of generation this transaction paid for. NULL for legacy rows recorded before category tracking existed (2026-07-06) and for non-generation transactions (purchase/refund/bonus/adjustment without a specific category).';

CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id     UUID,
  p_amount      INT,
  p_category    TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(new_balance INT, ok BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  UPDATE public.user_credits
  SET
    balance           = balance - p_amount,
    lifetime_consumed = lifetime_consumed + p_amount,
    updated_at        = NOW()
  WHERE user_id = p_user_id
    AND balance >= p_amount
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT COALESCE(
               (SELECT uc.balance FROM public.user_credits uc WHERE uc.user_id = p_user_id),
               0
             )::INT,
             FALSE;
  ELSE
    INSERT INTO public.credit_transactions (user_id, amount, balance_after, transaction_type, category, description)
    VALUES (p_user_id, -p_amount, v_new_balance, 'consumption', p_category, p_description);

    RETURN QUERY SELECT v_new_balance, TRUE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_credits(
  p_user_id     UUID,
  p_amount      INT,
  p_category    TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  UPDATE public.user_credits
  SET
    balance           = balance + p_amount,
    lifetime_consumed = GREATEST(0, lifetime_consumed - p_amount),
    updated_at        = NOW()
  WHERE user_id = p_user_id
  RETURNING balance INTO v_new_balance;

  IF FOUND THEN
    INSERT INTO public.credit_transactions (user_id, amount, balance_after, transaction_type, category, description)
    VALUES (p_user_id, p_amount, v_new_balance, 'refund', p_category, p_description);
  END IF;
END;
$$;
