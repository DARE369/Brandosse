// src/app/api/credits/purchase/route.ts
// Creates a Stripe Checkout session for purchasing credits.

import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';
import {
  getAuthenticatedUser,
  UNAUTHORIZED_RESPONSE,
  errorResponse,
  successResponse,
} from '../../../../lib/video-engine/auth-helpers';
import { getPackageById, CREDIT_PACKAGES } from '../../../../lib/video-engine/credit-packages';

const purchaseSchema = z.object({
  package_id: z.string().min(1),
});

function useMockPayments(): boolean {
  return process.env.VIDEO_ENGINE_USE_MOCK_PAYMENTS === 'true';
}

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  return new Stripe(secretKey, {
    apiVersion: '2024-06-20' as any,
  });
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return UNAUTHORIZED_RESPONSE;

  let body: z.infer<typeof purchaseSchema>;

  try {
    body = purchaseSchema.parse(await request.json());
  } catch {
    return errorResponse('Invalid request body', 'INVALID_BODY', 400);
  }

  const creditPackage = getPackageById(body.package_id);
  if (!creditPackage) {
    return errorResponse(
      `Invalid package. Available packages: ${CREDIT_PACKAGES.map((pkg) => pkg.id).join(', ')}`,
      'INVALID_PACKAGE',
      400,
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (useMockPayments()) {
    return successResponse({
      checkout_url: `${appUrl}/billing/credits?mock_checkout=true&package_id=${creditPackage.id}&credits=${creditPackage.credits}`,
      mock: true,
    });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return errorResponse(
      'Stripe is not configured. Add STRIPE_SECRET_KEY or enable VIDEO_ENGINE_USE_MOCK_PAYMENTS=true.',
      'STRIPE_NOT_CONFIGURED',
      500,
    );
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${creditPackage.credits} Video Credits`,
              description: creditPackage.description,
            },
            unit_amount: creditPackage.price_cents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${appUrl}/billing/credits?success=true&credits=${creditPackage.credits}`,
      cancel_url: `${appUrl}/billing/credits?canceled=true`,
      metadata: {
        user_id: user.id,
        package_id: creditPackage.id,
        credits: creditPackage.credits.toString(),
        price_cents: creditPackage.price_cents.toString(),
      },
      customer_email: user.email ?? undefined,
    });

    if (!session.url) {
      return errorResponse('Stripe did not return a checkout URL. Please try again.', 'STRIPE_SESSION_FAILED', 500);
    }

    return successResponse({ checkout_url: session.url });
  } catch (stripeError) {
    console.error('[CreditsPurchase] Stripe session creation failed:', stripeError);
    return errorResponse('Failed to create payment session. Please try again.', 'STRIPE_SESSION_FAILED', 500);
  }
}
