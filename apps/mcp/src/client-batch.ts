import type { PostEngineerClient } from './client.js';

//---------------
// POST /api/videos/batch-discount — the batch discount of issue #487.
// A standalone function (not a client method) because client.ts is
// grandfathered over the 500-line cap and may not grow.
//---------------

export interface ApplyBatchDiscountInput {
  batchKey: string;
  scheduleIds: string[];
}

export async function applyBatchDiscount(client: PostEngineerClient, input: ApplyBatchDiscountInput): Promise<unknown> {
  return client.request(
    '/api/videos/batch-discount',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(input) },
    'apply batch discount',
  );
}
