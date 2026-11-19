import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

export const TOKEN_TRANSACTIONS_DEFAULT_LIMIT = 20;
export const TOKEN_TRANSACTIONS_MAX_LIMIT = 100;
export const TOKEN_TRANSACTIONS_DEFAULT_OFFSET = 0;

export function parseTransactionsLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return TOKEN_TRANSACTIONS_DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return TOKEN_TRANSACTIONS_DEFAULT_LIMIT;
  return Math.min(parsed, TOKEN_TRANSACTIONS_MAX_LIMIT);
}

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
