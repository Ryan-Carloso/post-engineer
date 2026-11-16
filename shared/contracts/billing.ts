// Billing contract: the single source of truth for GET /api/billing/tokens
// and GET /api/billing/transactions. Both apps generate a copy of this file
// (see scripts/sync-contracts.mjs); never edit a generated copy by hand.
//
// GET /api/billing/tokens returns the prepaid wallet balance (paid + free).
// GET /api/billing/transactions returns the token ledger, newest first,
// paginated. The paging query is LENIENT by design (long-standing route
// behavior): an invalid or out-of-range limit/offset falls back to the
// default instead of failing, so the query schema below only names the
// params and the parse helpers carry the fallback. `success` is a literal
// `true`: the routes never return success:false with a 200.
import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

/** Ledger paging defaults (also the MCP client's fail-fast bound). */
export const TOKEN_TRANSACTIONS_DEFAULT_LIMIT = 20;
export const TOKEN_TRANSACTIONS_MAX_LIMIT = 100;
export const TOKEN_TRANSACTIONS_DEFAULT_OFFSET = 0;

//---------------
// parseTransactionsLimit — validates the ?limit= query param; invalid or
// out-of-range values fall back to the default instead of failing.
//---------------
export function parseTransactionsLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return TOKEN_TRANSACTIONS_DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return TOKEN_TRANSACTIONS_DEFAULT_LIMIT;
  return Math.min(parsed, TOKEN_TRANSACTIONS_MAX_LIMIT);
}

//---------------
// parseTransactionsOffset — validates the ?offset= query param; invalid or
// negative values fall back to 0 instead of failing.
//---------------
export function parseTransactionsOffset(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return TOKEN_TRANSACTIONS_DEFAULT_OFFSET;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return TOKEN_TRANSACTIONS_DEFAULT_OFFSET;
  return parsed;
}

export const TokenBalanceResponseSchema = z.object({
  success: z.literal(true),
  balance: z.number(),
  free: z.number(),
});

export const TokenTransactionSchema = z.object({
  id: z.string(),
  amount: z.number(),
  type: z.string(),
  description: z.string().nullable(),
  reason: z.string().nullable(),
  generationId: z.string().nullable(),
  createdAt: z.string(),
});

export const ListTokenTransactionsResponseSchema = z.object({
  success: z.literal(true),
  transactions: z.array(TokenTransactionSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

/** Raw paging params as the MCP sends them (strings in the query). Plain
 * object, not strict: the route ignores unknown query params. */
export const ListTokenTransactionsQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
});

export const getTokenBalance = defineEndpoint({
  method: 'GET',
  path: '/api/billing/tokens',
  response: TokenBalanceResponseSchema,
});

export const listTokenTransactions = defineEndpoint({
  method: 'GET',
  path: '/api/billing/transactions',
  query: ListTokenTransactionsQuerySchema,
  response: ListTokenTransactionsResponseSchema,
});
