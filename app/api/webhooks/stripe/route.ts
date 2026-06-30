// src/app/api/webhooks/stripe/route.ts
// Handles Stripe webhook events.
// Important: read the raw body. Do not call request.json() before signature verification.

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/video-engine/supabase-admin';
import { getPackageById } from '@/lib/video-engine/credit-packages';

export const runtime = 'nodejs';

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  return new Stripe(secretKey, {
    apiVersion: '2024-06-20' as any,
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const stripeSignature = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripeClient();

  if (!stripeSignature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  if (!webhookSecret || !stripe) {
    console.error('[StripeWebhook] Stripe webhook credentials are not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
  } catch (signatureError) {
    console.error('[StripeWebhook] Signature verification failed:', signatureError);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  handleWebhookEvent(event).catch((error) => {
    console.error('[StripeWebhook] Event handling failed:', event.type, error);
  });

  return NextResponse.json({ received: true }, { status: 200 });
}

async function handleWebhookEvent(event: any): Promise<void> {
  if (event.type !== 'checkout.session.completed') {
    return;
  }

  const session = event.data.object;
  const userId = session.metadata?.user_id;
  const creditsStr = session.metadata?.credits;
  const packageId = session.metadata?.package_id;
  const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.id;

  if (!userId || !creditsStr || !packageId) {
    console.error('[StripeWebhook] Missing metadata in session:', session.id, session.metadata);
    return;
  }

  const creditsToAdd = Number.parseInt(creditsStr, 10);
  if (!Number.isFinite(creditsToAdd) || creditsToAdd <= 0) {
    console.error('[StripeWebhook] Invalid credits value:', creditsStr);
    return;
  }

  const { data: existingTransaction, error: existingError } = await supabaseAdmin
    .from('credit_transactions')
    .select('id')
    .eq('stripe_payment_id', paymentId)
    .maybeSingle();

  if (existingError) {
    console.error('[StripeWebhook] Duplicate check failed:', existingError);
    return;
  }

  if (existingTransaction) {
    console.log('[StripeWebhook] Duplicate payment ignored:', paymentId);
    return;
  }

  const { data: currentCredits, error: fetchError } = await supabaseAdmin
    .from('user_credits')
    .select('balance, lifetime_purchased')
    .eq('user_id', userId)
    .single();

  if (fetchError || !currentCredits) {
    console.error('[StripeWebhook] Could not fetch credits for user:', userId, fetchError);
    return;
  }

  const newBalance = currentCredits.balance + creditsToAdd;
  const newLifetimePurchased = currentCredits.lifetime_purchased + creditsToAdd;

  const { error: updateError } = await supabaseAdmin
    .from('user_credits')
    .update({
      balance: newBalance,
      lifetime_purchased: newLifetimePurchased,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('[StripeWebhook] Balance update failed:', userId, updateError);
    return;
  }

  const { error: transactionError } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount: creditsToAdd,
    balance_after: newBalance,
    transaction_type: 'purchase',
    description: `Purchased ${creditsToAdd} credits - ${getPackageById(packageId)?.name ?? packageId} package`,
    stripe_payment_id: paymentId,
  });

  if (transactionError) {
    console.error('[StripeWebhook] Transaction insert failed:', userId, transactionError);
    return;
  }

  console.log(`[StripeWebhook] Added ${creditsToAdd} credits to user ${userId}. New balance: ${newBalance}`);
}
