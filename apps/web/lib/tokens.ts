import { create } from 'zustand';

//---------------
// Token pricing model for the persona video.
//  - Faceless (no face)         = 1 token
//  - Face "ok" (480p)           = 2 tokens
//  - Face "very_good" (720p)    = 3 tokens
// Hybrid = weighted average, rounded up to whole tokens.
//---------------

export const FACELESS_PRICE = 1;

export const FACE_QUALITY_PRICES = {
  ok: 2,
  very_good: 3,
} as const;

export type FaceQuality = keyof typeof FACE_QUALITY_PRICES;

export const DEFAULT_TOKEN_BALANCE = 100;

function clampMix(percent: number): number {
  return Math.min(100, Math.max(0, percent));
}

//---------------
// toFiniteNumber — safe coercion of values coming from the API/Supabase.
// Postgres numerics arrive as strings via PostgREST; null/undefined/NaN → fallback.
//---------------
export function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
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

// Estimated cost of a video with faceMixPercent% face at the given quality.
export function computeVideoTokens(faceMixPercent: number, faceQuality: FaceQuality): number {
  const mix = clampMix(faceMixPercent) / 100;
  const price = mix * FACE_QUALITY_PRICES[faceQuality] + (1 - mix) * FACELESS_PRICE;
  return Math.max(1, Math.ceil(price));
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
