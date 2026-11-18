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
