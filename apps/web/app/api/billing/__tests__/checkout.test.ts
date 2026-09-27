import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

const mockStripeCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test-session' });
const mockStripeCustomerCreate = vi.fn().mockResolvedValue({ id: 'cus_new_test' });

class MockStripe {
  public readonly checkout = {
    sessions: {
      create: mockStripeCreate,
    },
  };

  public readonly customers = {
    create: mockStripeCustomerCreate,
  };
}

vi.mock('stripe', () => ({
  default: MockStripe,
}));

import { POST } from '@/app/api/billing/checkout/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/billing/checkout', () => {
  beforeEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    mockStripeCreate.mockClear();
    // Set env vars for stripe price IDs
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3434';
    process.env.STRIPE_PRICE_PACK_10 = 'price_pack_10_test';
    process.env.STRIPE_PRICE_PACK_50 = 'price_pack_50_test';
    process.env.STRIPE_PRICE_PACK_100 = 'price_pack_100_test';
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }),
    } as never);
  });

  it('retorna 401 quando não há sessão', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no' } }) },
    } as never);

    const res = await POST(makePostRequest({ plan: 'starter' }));
    expect(res.status).toBe(401);
  });

  it('retorna 400 quando o pack é inválido', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
    } as never);

    const res = await POST(makePostRequest({ packId: 'invalid' }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('packId');
  });

  it('retorna 400 quando o pack não é informado', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
    } as never);

    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
  });

  it('cria sessão de checkout e retorna URL', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'test@test.com' } }, error: null }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: 'cus_existing' }, error: null }),
          }),
        }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }),
    } as never);

    // MockStripe já está configurado no topo do arquivo
    const res = await POST(makePostRequest({ packId: 'pack_50' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { url: string };
    expect(body.url).toBe('https://checkout.stripe.com/test-session');
  });
});
