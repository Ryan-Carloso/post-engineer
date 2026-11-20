import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { deleteInsertedSlots } from '../rollback-slots';

function fakeClient(): { client: SupabaseClient; inIds: unknown[][]; eqs: Array<[string, unknown]>; from: ReturnType<typeof vi.fn> } {
  const inIds: unknown[][] = [];
  const eqs: Array<[string, unknown]> = [];
  const chain = {
    delete: () => chain,
    in: (_column: string, ids: unknown[]) => {
      inIds.push(ids);
      return chain;
    },
    eq: (column: string, value: unknown) => {
      eqs.push([column, value]);
      return Promise.resolve({ error: null });
    },
  };
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, inIds, eqs, from };
}

describe('deleteInsertedSlots', () => {
  it('deletes only the slot ids that were inserted, scoped to the user', async () => {
    const { client, inIds, eqs, from } = fakeClient();
    await deleteInsertedSlots(client, 'user-1', [{ id: 'slot-new' }]);
    expect(from).toHaveBeenCalledWith('scheduled_posts');
    expect(inIds).toEqual([['slot-new']]);
    expect(eqs).toEqual([['user_id', 'user-1']]);
  });

  it('does not touch the database when nothing was inserted', async () => {
    const { client, from } = fakeClient();
    await deleteInsertedSlots(client, 'user-1', null);
    await deleteInsertedSlots(client, 'user-1', []);
    expect(from).not.toHaveBeenCalled();
  });
});
