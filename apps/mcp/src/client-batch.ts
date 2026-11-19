import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import type { ResponseOf } from './contracts/endpoint.js';
import { applyBatchDiscount as applyBatchDiscountContract } from './contracts/videos.js';

export interface ApplyBatchDiscountInput {
  batchKey: string;
  scheduleIds: string[];
}

export async function applyBatchDiscount(
  client: PostEngineerClient,
  input: ApplyBatchDiscountInput,
): Promise<ResponseOf<typeof applyBatchDiscountContract>> {
  const raw = await client.request(
    '/api/videos/batch-discount',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(input) },
    'apply batch discount',
  );
  return parseContractResponse(applyBatchDiscountContract, raw);
}
