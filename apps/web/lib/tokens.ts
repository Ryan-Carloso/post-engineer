import { create } from 'zustand';

export const VIDEO_TYPES = ['full_lipsync', 'hook_lipsync', 'voiceover'] as const;

export type VideoType = (typeof VIDEO_TYPES)[number];

export function isVideoType(value: unknown): value is VideoType {
  return typeof value === 'string' && (VIDEO_TYPES as readonly string[]).includes(value);
}

export const VIDEO_TYPE_ERROR_SUFFIX =
  'use full_lipsync (8/15), hook_lipsync (2/3) or voiceover (1)';

export function unknownVideoTypeMessage(value: unknown): string {
  const shown = value === null || value === undefined ? '' : String(value).slice(0, 32);
  return `unknown video_type '${shown}'; ${VIDEO_TYPE_ERROR_SUFFIX}`;
}

export const VIDEO_TYPE_REQUIRED_MESSAGE = `videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`;

export const VOICEOVER_PRICE = 1;

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

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function netLedgerSpent(rows: Array<{ type: unknown; amount: unknown }>): number {
  let net = 0;
  for (const row of rows) {
    if (row.type === 'video_generation') net += Math.abs(toFiniteNumber(row.amount, 0));
    if (row.type === 'generation_refund') net -= toFiniteNumber(row.amount, 0);
  }
  return net;
}

export function computeTokenPercentage(balance: unknown, maxTokens: unknown): number {
  const safeBalance = toFiniteNumber(balance, 0);
  const safeMax = toFiniteNumber(maxTokens, 0);
  if (!Number.isFinite(safeBalance) || !Number.isFinite(safeMax) || safeMax <= 0) return 0;
  return Math.min(100, Math.max(0, (safeBalance / safeMax) * 100));
}

export function computeVideoTokens(
  videoType: VideoType,
  faceQuality: FaceQuality,
): number {
  if (videoType === 'voiceover') return VOICEOVER_PRICE;
  if (videoType === 'full_lipsync') return FULL_LIPSYNC_PRICES[faceQuality];
  return FACE_QUALITY_PRICES[faceQuality];
}

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
