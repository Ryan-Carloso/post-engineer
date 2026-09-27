//---------------
// Prepaid token packs — the single source of truth for wallet purchases.
// Prices are display values; Stripe Price IDs remain server-only env vars.
//---------------

export const TOKEN_PACKS = {
  pack_10: {
    id: 'pack_10',
    tokens: 10,
    price: 7,
    stripePriceEnv: 'STRIPE_PRICE_PACK_10',
  },
  pack_50: {
    id: 'pack_50',
    tokens: 50,
    price: 29,
    stripePriceEnv: 'STRIPE_PRICE_PACK_50',
  },
  pack_100: {
    id: 'pack_100',
    tokens: 100,
    price: 49,
    stripePriceEnv: 'STRIPE_PRICE_PACK_100',
  },
} as const;

export type TokenPackId = keyof typeof TOKEN_PACKS;

export function isTokenPackId(value: unknown): value is TokenPackId {
  return typeof value === 'string' && value in TOKEN_PACKS;
}

export function getStripePriceId(packId: TokenPackId): string {
  const environmentName = TOKEN_PACKS[packId].stripePriceEnv;
  const priceId = process.env[environmentName];
  if (!priceId) throw new Error(`${environmentName} is not defined`);
  return priceId;
}
