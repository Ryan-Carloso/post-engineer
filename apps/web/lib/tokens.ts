import { create } from 'zustand';

//---------------
// Token pricing model for the persona video.
//  - Faceless (no face, 100% stock)   = 1 token
//  - With the persona's face "ok" (480p)    = 2 tokens
//  - With the persona's face "very_good" (720p) = 3 tokens
//  - Full lip-sync, face "ok"               = 8 tokens
//  - Full lip-sync, face "very_good"        = 15 tokens
//
// Full lip-sync renders every narration window as talking head, so its GPU
// cost is a multiple of the hook-only intro; the flat hook prices above do
// not cover it. There is no face MIX anymore (migration 007 dropped the
// persona column): a persona always has a face, and "no face" is a boolean
// the user picks per post — so the price is a straight lookup, not a
// weighted average.
//---------------

export const FACELESS_PRICE = 1;

export const FACE_QUALITY_PRICES = {
  ok: 2,
  very_good: 3,
} as const;

export const FULL_LIPSYNC_PRICES = {
  ok: 8,
  very_good: 15,
} as const;

export type FaceQuality = keyof typeof FACE_QUALITY_PRICES;

export const DEFAULT_TOKEN_BALANCE = 100;

//---------------
// toFiniteNumber — safe coercion of values coming from the API/Supabase.
// Postgres numerics arrive as strings via PostgREST; null/undefined/NaN → fallback.
//---------------
export function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

//---------------
// netLedgerSpent — net tokens still spent for one generation_id, from the
// ledger rows under it. A refund inserts a generation_refund credit row and
// never deletes the video_generation spend row (see refund_batch_tokens in
// migration 017, which mirrors refund_generation_tokens), so a generation
// counts as already spent only while its spends exceed its refunds. Spend
// rows carry a negative amount, refunds a positive one. Rows of any other
// type are ignored; a non-numeric amount counts as 0.
//---------------
export function netLedgerSpent(rows: Array<{ type: unknown; amount: unknown }>): number {
  let net = 0;
  for (const row of rows) {
    if (row.type === 'video_generation') net += Math.abs(toFiniteNumber(row.amount, 0));
    if (row.type === 'generation_refund') net -= toFiniteNumber(row.amount, 0);
  }
  return net;
}

//---------------
// computeTokenPercentage — % of tokens remaining, always 0–100, never NaN.
// maxTokens <= 0 (e.g. free plan with 0 tokens/month) → 0 instead of 0/0 = NaN.
//---------------
export function computeTokenPercentage(balance: unknown, maxTokens: unknown): number {
  const safeBalance = toFiniteNumber(balance, 0);
  const safeMax = toFiniteNumber(maxTokens, 0);
  if (!Number.isFinite(safeBalance) || !Number.isFinite(safeMax) || safeMax <= 0) return 0;
  return Math.min(100, Math.max(0, (safeBalance / safeMax) * 100));
}

//---------------
// computeVideoTokens — cost of ONE video: the faceless price when the post
// asked for no face, otherwise the persona's face quality, or the full
// lip-sync price when the post asked for full lip-sync. The server calls
// the same formula (apps/engine .../fill_schedule/support.py token_cost), so
// an estimate that disagrees with the charge is a bug in one of the two.
// A full lip-sync request is never faceless (the route rejects the
// combination before charging), so faceless still wins here and the full
// price never applies to a faceless post.
//---------------
export function computeVideoTokens(
  faceless: boolean,
  faceQuality: FaceQuality,
  fullLipsync = false,
): number {
  if (faceless) return FACELESS_PRICE;
  if (fullLipsync) return FULL_LIPSYNC_PRICES[faceQuality];
  return FACE_QUALITY_PRICES[faceQuality];
}

//---------------
// Token Store — mocked user balance.
//---------------

interface TokenState {
  balance: number;
  spendTokens: (cost: number) => boolean;
  addTokens: (amount: number) => void;
  resetTokens: () => void;
}

export const useTokenStore = create<TokenState>((set, get) => ({
  balance: DEFAULT_TOKEN_BALANCE,

  spendTokens: (cost) => {
    const { balance } = get();
    if (balance < cost) return false;
    set({ balance: Math.round((balance - cost) * 100) / 100 });
    return true;
  },

  addTokens: (amount) => {
    const { balance } = get();
    set({ balance: Math.round((balance + amount) * 100) / 100 });
  },

  resetTokens: () => set({ balance: DEFAULT_TOKEN_BALANCE }),
}));
