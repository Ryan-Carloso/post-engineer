import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(() => 'warn-id'), error: vi.fn(() => 'error-id'), info: vi.fn(), debug: vi.fn() },
}));

import { DELETE } from '../route';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createFakeSupabase, slotRow } from '@/app/api/videos/batch-discount/__tests__/fake-supabase';

//---------------
// DELETE /api/schedule on a video of a discounted batch (issue #487): the
// refund the route sends is the clawback-adjusted amount, end to end.
//---------------

const USER_ID = 'user-1';
const BATCH = '33333333-3333-4333-8333-333333333333';

function batchOfSix() {
  const paid = ['1', '2', '3', '4', '5'].map((id) => slotRow(id, { batch_id: BATCH, status: 'ready' }));
  const free = slotRow('6', { batch_id: BATCH, status: 'ready', charged_tokens: 0, discount_tokens: 2 });
  const slots = [...paid, free];
  const schedules = slots.map((slot) => ({ id: slot.schedule_id, user_id: USER_ID, persona_id: null }));
  const fake = createFakeSupabase({ tables: { scheduled_posts: slots, schedules } });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(fake.client as never);
  return { fake, paid, free };
}

function cancel(scheduleId: unknown): Promise<Response> {
  return DELETE(new Request(`http://localhost/api/schedule?id=${String(scheduleId)}`, { method: 'DELETE' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_test', isApiKey: true, personaIds: null },
    error: null,
  } as never);
});

describe('DELETE /api/schedule on a discounted batch', () => {
  it('withholds the free video discount from the cancelled paid video', async () => {
    const { fake, paid } = batchOfSix();
    const res = await cancel(paid[0]?.schedule_id);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { refunds: unknown[]; batchDiscountWithheld: number; cancelledSlotIds: string[] };
    expect(json.cancelledSlotIds).toEqual(['1']);
    expect(json.batchDiscountWithheld).toBe(2);
    // The whole 2-token charge was withheld, so no refund call was made.
    expect(json.refunds).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.tables.scheduled_posts?.find((row) => row.id === '6')).toMatchObject({
      charged_tokens: 2,
      discount_tokens: 0,
    });
  });

  it('refunds the next cancelled video in full once the discount is gone', async () => {
    const { fake, paid } = batchOfSix();
    await cancel(paid[0]?.schedule_id);
    const res = await cancel(paid[1]?.schedule_id);
    const json = (await res.json()) as { batchDiscountWithheld: number };
    expect(json.batchDiscountWithheld).toBe(0);
    expect(fake.rpcCalls.map((call) => call.params.p_amount)).toEqual([2]);
  });

  it('cancelling the free video makes no refund call and keeps the paid ones paid', async () => {
    const { fake, free } = batchOfSix();
    const res = await cancel(free.schedule_id);
    const json = (await res.json()) as { batchDiscountWithheld: number; cancelledSlotIds: string[] };
    expect(json.cancelledSlotIds).toEqual(['6']);
    expect(json.batchDiscountWithheld).toBe(0);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.tables.scheduled_posts?.every((row) => row.charged_tokens === 2)).toBe(true);
  });
});
