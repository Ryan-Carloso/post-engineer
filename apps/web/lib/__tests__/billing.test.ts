import { describe, expect, it } from 'vitest';
import { isTokenPackId, TOKEN_PACKS } from '@/lib/billing';

describe('TOKEN_PACKS', () => {
  it('contains the prepaid pack catalogue', () => {
    expect(TOKEN_PACKS.pack_10).toMatchObject({ tokens: 10, price: 7 });
    expect(TOKEN_PACKS.pack_50).toMatchObject({ tokens: 50, price: 29 });
    expect(TOKEN_PACKS.pack_100).toMatchObject({ tokens: 100, price: 49 });
  });

  it('validates pack IDs without trusting arbitrary client values', () => {
    expect(isTokenPackId('pack_50')).toBe(true);
    expect(isTokenPackId('100')).toBe(false);
    expect(isTokenPackId(50)).toBe(false);
  });
});
