//---------------
// Tests for POST /api/cron/billing-reconcile.
//
// The store construction and the orchestration are mocked boundaries;
// this pins the cron-secret gate and the report passthrough.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('@/lib/billing/reconcile', () => ({
  createReconcileStore: vi.fn(),
  runBillingReconciliation: vi.fn(),
}));

import { POST } from '../billing-reconcile/route';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createReconcileStore, runBillingReconciliation } from '@/lib/billing/reconcile';

const mockCreateServiceClient = vi.mocked(createSupabaseServiceClient);
const mockCreateStore = vi.mocked(createReconcileStore);
const mockRun = vi.mocked(runBillingReconciliation);

const REPORT = {
  zombiesRefunded: [],
  zombiesAlreadySettled: [],
  stuckAutoRefunded: [],
  stuckSkippedValueDelivered: [],
  queuedForReview: [],
  queuedAlready: [],
  errors: [],
};

function requestWith(secret: string | null): Request {
  const headers = new Headers();
  if (secret !== null) headers.set('Authorization', `Bearer ${secret}`);
  return new Request('https://app.example/api/cron/billing-reconcile', {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'cron-secret-value';
  mockCreateServiceClient.mockReturnValue({} as never);
  mockCreateStore.mockReturnValue({} as never);
  mockRun.mockResolvedValue(REPORT);
  delete process.env.RECONCILE_STUCK_HOURS;
});

describe('POST /api/cron/billing-reconcile', () => {
  it('runs reconciliation and returns the report with a valid secret', async () => {
    const response = await POST(requestWith('cron-secret-value'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; report: unknown };
    expect(body.success).toBe(true);
    expect(body.report).toEqual(REPORT);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing Authorization header with 401 without running', async () => {
    const response = await POST(requestWith(null));
    expect(response.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret with 401 without running', async () => {
    const response = await POST(requestWith('wrong-secret'));
    expect(response.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(requestWith('cron-secret-value'));
    expect(response.status).toBe(500);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
