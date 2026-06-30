// src/app/api/credits/balance/route.ts
// Returns the authenticated user's credit balance and transaction history.

import { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  successResponse,
} from '@/lib/video-engine/auth-helpers';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';

const MOCK_STUDIO_CREDIT_FLOOR = 1000;

export async function GET(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  const [creditsResult, transactionsResult] = await Promise.all([
    supabaseAdmin
      .from('user_credits')
      .select('balance, lifetime_purchased, lifetime_consumed, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin
      .from('credit_transactions')
      .select('id, amount, balance_after, transaction_type, description, stripe_payment_id, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (creditsResult.error) {
    console.warn('[CreditsBalance] Fetch failed; returning mock Studio credits:', creditsResult.error);
  }

  const storedBalance = Number(creditsResult.data?.balance ?? 0);
  const balance = Math.max(storedBalance, MOCK_STUDIO_CREDIT_FLOOR);

  return successResponse({
    balance,
    lifetime_purchased: creditsResult.data?.lifetime_purchased ?? 0,
    lifetime_consumed: creditsResult.data?.lifetime_consumed ?? 0,
    last_updated: creditsResult.data?.updated_at,
    mock_credit_floor: MOCK_STUDIO_CREDIT_FLOOR,
    mock_credit_grant: Math.max(0, MOCK_STUDIO_CREDIT_FLOOR - storedBalance),
    transactions: transactionsResult.data ?? [],
  });
}
