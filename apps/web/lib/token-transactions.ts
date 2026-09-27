//---------------
// TokenTransaction — public shape of one token_transactions ledger row
// as served by GET /api/billing/transactions. Shared by the API route
// and the billing page so the wire contract lives in exactly one place.
//---------------

export interface TokenTransaction {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  reason: string | null;
  generationId: string | null;
  createdAt: string;
}

export interface TokenTransactionsPage {
  success: boolean;
  transactions: TokenTransaction[];
  total: number;
  limit: number;
  offset: number;
}
