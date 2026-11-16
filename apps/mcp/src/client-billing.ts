import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  TOKEN_TRANSACTIONS_MAX_LIMIT,
  getTokenBalance as getTokenBalanceContract,
  listTokenTransactions as listTokenTransactionsContract,
} from './contracts/billing.js';
import type { ResponseOf } from './contracts/endpoint.js';

//---------------
// Billing (GET /api/billing/tokens, GET /api/billing/transactions) —
// standalone functions because client.ts is grandfathered over the
// 500-line cap and may not grow. Inputs and responses are typed from the
// shared contract (shared/contracts/billing.ts), so a renamed contract
// field fails typecheck here and in the web route together. The request
// sites stay literal for the parity gate. The client keeps its fail-fast
// paging validation: the server silently falls back to its defaults on
// invalid paging, so the client names the bad field instead of sending a
// value the caller never meant.
//---------------

export async function getTokenBalance(
  client: PostEngineerClient,
): Promise<ResponseOf<typeof getTokenBalanceContract>> {
  const raw = await client.request(
    '/api/billing/tokens',
    { method: 'GET', headers: client.getHeaders() },
    'get token balance',
  );
  return parseContractResponse(getTokenBalanceContract, raw);
}

export async function listTokenTransactions(
  client: PostEngineerClient,
  limit?: number,
  offset?: number,
): Promise<ResponseOf<typeof listTokenTransactionsContract>> {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > TOKEN_TRANSACTIONS_MAX_LIMIT)) {
    throw new Error(`limit must be an integer between 1 and ${TOKEN_TRANSACTIONS_MAX_LIMIT}.`);
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error('offset must be a non-negative integer.');
  }
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const query = params.size > 0 ? `?${params.toString()}` : '';
  const raw = await client.request(
    `/api/billing/transactions${query}`,
    { method: 'GET', headers: client.getHeaders() },
    'list token transactions',
  );
  return parseContractResponse(listTokenTransactionsContract, raw);
}
