// src/lib/video-engine/credit-packages.ts
// Defines available credit packages for purchase.
// 1 credit = 1 minute of source video processing.

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  price_display: string;
  description: string;
  popular: boolean;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'starter_100',
    name: 'Starter',
    credits: 100,
    price_cents: 1500,
    price_display: '$15',
    description: '100 minutes of video - roughly 7 long-form videos',
    popular: false,
  },
  {
    id: 'creator_300',
    name: 'Creator',
    credits: 300,
    price_cents: 3500,
    price_display: '$35',
    description: '300 minutes of video - roughly 20 long-form videos',
    popular: true,
  },
  {
    id: 'pro_1000',
    name: 'Pro',
    credits: 1000,
    price_cents: 9900,
    price_display: '$99',
    description: '1000 minutes of video - for serious content teams',
    popular: false,
  },
];

export function getPackageById(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((creditPackage) => creditPackage.id === id);
}

export const MIN_CREDITS_TO_SUBMIT = 5;
