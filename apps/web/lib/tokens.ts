import { create } from 'zustand';

//---------------
// Token pricing model for the persona video, keyed by the one video mode
// (video_type, issue #542 follow-up):
//  - faceless (no face, only the agent's images) = 1 token
//  - hook_lipsync, face "ok" (480p)    = 2 tokens
//  - hook_lipsync, face "very_good" (720p) = 3 tokens
//  - full_lipsync, face "ok"               = 8 tokens
//  - full_lipsync, face "very_good"        = 15 tokens
//
// Full lip-sync renders every narration window as talking head, so its GPU
// cost is a multiple of the hook-only intro; the flat hook prices above do
// not cover it. There is no face MIX anymore (migration 007 dropped the
// persona column): a persona always has a face, and the mode is one enum
// the caller picks per post — so the price is a straight lookup, not a
// weighted average.
//---------------

export const VIDEO_TYPES = ['full_lipsync', 'hook_lipsync', 'faceless'] as const;

export type VideoType = (typeof VIDEO_TYPES)[number];

/** Narrow an untrusted value to a video mode (DB rows, request bodies). */
export function isVideoType(value: unknown): value is VideoType {
  return typeof value === 'string' && (VIDEO_TYPES as readonly string[]).includes(value);
}

/**
 * The invalid-video_type message suffix: every valid type WITH its token
 * cost, so the agent can choose knowing the price. Kept short on purpose:
 * the MCP caps upstream error bodies at 200 chars (apps/mcp/src/errors.ts
 * MAX_ERROR_BODY_CHARS), so a long message would arrive truncated.
 * Must stay identical to the engine's VIDEO_TYPE_ERROR_SUFFIX
 * (apps/engine/app/models/schema.py) — the video-type sync test pins the
 * two together, and the numbers must match the price tables below.
 */
export const VIDEO_TYPE_ERROR_SUFFIX =
  'use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)';

/** Short invalid-video_type error, costs included, under 200 chars. */
export function unknownVideoTypeMessage(value: unknown): string {
  const shown = value === null || value === undefined ? '' : String(value).slice(0, 32);
  return `unknown video_type '${shown}'; ${VIDEO_TYPE_ERROR_SUFFIX}`;
}

/** Missing-video_type error: same suffix, so the agent sees values + costs. */
export const VIDEO_TYPE_REQUIRED_MESSAGE = `videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`;

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
// computeVideoTokens — cost of ONE video, from the one video mode: the
// faceless price for faceless, otherwise the persona's face quality, or
// the full lip-sync price for full_lipsync. This is the only copy of the
// formula: generate-and-schedule charges with it and stores the result on
// the slot (scheduled_posts.charged_tokens, migration 045), and every
// refund, engine included, reads that stored amount. The cost is always
// computed by the server from video_type — the request never carries a
// price, so a caller cannot under-charge a video.
//---------------
export function computeVideoTokens(
  videoType: VideoType,
  faceQuality: FaceQuality,
): number {
  if (videoType === 'faceless') return FACELESS_PRICE;
  if (videoType === 'full_lipsync') return FULL_LIPSYNC_PRICES[faceQuality];
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
