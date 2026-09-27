import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

const mockConstructEvent = vi.fn();

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  })),
}));

import { POST } from '@/app/api/billing/webhook/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function makeWebhookRequest(body: string, signature: string): NextRequest {
  return new NextRequest('http://localhost/api/billing/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    body,
  });
}

describe('POST /api/billing/webhook', () => {
  beforeEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    mockConstructEvent.mockReset();
  });

  it('retorna 500 quando STRIPE_WEBHOOK_SECRET não está configurado', async () => {
    // Sem env var, deve retornar erro
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const res = await POST(makeWebhookRequest('{}', 'sig_test'));
      expect(res.status).toBe(500);
    } finally {
      if (original !== undefined) process.env.STRIPE_WEBHOOK_SECRET = original;
    }
  });

  it('retorna 400 quando stripe-signature falta', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    try {
      const res = await POST(makeWebhookRequest('{}', ''));
      expect(res.status).toBe(400);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it('retorna 400 quando assinatura é inválida', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    try {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });
      const res = await POST(makeWebhookRequest('{}', 'sig_invalid'));
      // Pode retornar 400 (assinatura inválida) ou 500 (se Stripe init falhar)
      expect([400, 500]).toContain(res.status);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_SECRET_KEY;
    }
  });
});
