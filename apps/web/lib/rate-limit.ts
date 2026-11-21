import 'server-only';

import { NextResponse } from 'next/server';
import { clientBucket } from '@/lib/rate-limit-ip';

export interface RateLimitProfile {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  youtubeUpload: { name: 'youtube-upload', limit: 5, windowMs: 60_000 },
  mediaUpload: { name: 'media-upload', limit: 10, windowMs: 60_000 },
  videoDownload: { name: 'video-download', limit: 120, windowMs: 60_000 },
  voiceCloneCreate: { name: 'voice-clone-create', limit: 3, windowMs: 60 * 60 * 1000 },
  voiceCloneDenoisePreview: { name: 'voice-clone-denoise-preview', limit: 20, windowMs: 60 * 60 * 1000 },
  voiceClonePreview: { name: 'voice-clone-preview', limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  voicePreview: { name: 'voice-preview', limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  instagramPost: { name: 'instagram-post', limit: 10, windowMs: 60_000 },
  pinterestUpload: { name: 'pinterest-upload', limit: 10, windowMs: 60_000 },
  pinterestBoards: { name: 'pinterest-boards', limit: 60, windowMs: 60_000 },
  oauthToken: { name: 'oauth-token', limit: 30, windowMs: 60_000 },
  oauthRegister: { name: 'oauth-register', limit: 10, windowMs: 60_000 },
  apiKeyManage: { name: 'api-key-manage', limit: 20, windowMs: 60_000 },
  blueskyConnect: { name: 'bluesky-connect', limit: 10, windowMs: 60_000 },
  threespeakConnect: { name: 'threespeak-connect', limit: 10, windowMs: 60_000 },
  rumbleConnect: { name: 'rumble-connect', limit: 10, windowMs: 60_000 },
  telegramConnect: { name: 'telegram-connect', limit: 10, windowMs: 60_000 },
  billingCheckout: { name: 'billing-checkout', limit: 10, windowMs: 60_000 },
  videoJob: { name: 'video-job', limit: 20, windowMs: 60_000 },
  generateAndSchedule: { name: 'generate-and-schedule', limit: 12, windowMs: 60_000 },
  publishExisting: { name: 'publish-existing', limit: 10, windowMs: 60_000 },
  batchDiscount: { name: 'batch-discount', limit: 10, windowMs: 60_000 },
  connectUrl: { name: 'connect-url', limit: 30, windowMs: 60_000 },
  oauthStart: { name: 'oauth-start', limit: 30, windowMs: 60_000 },
  deletePreview: { name: 'delete-preview', limit: 30, windowMs: 60_000 },
  personaDelete: { name: 'persona-delete', limit: 10, windowMs: 60_000 },
  personaWrite: { name: 'persona-write', limit: 20, windowMs: 60_000 },
  postDetail: { name: 'post-detail', limit: 120, windowMs: 60_000 },
  publishingAccounts: { name: 'publishing-accounts', limit: 60, windowMs: 60_000 },
  toolConfig: { name: 'tool-config', limit: 60, windowMs: 60_000 },
  metrics: { name: 'metrics', limit: 60, windowMs: 60_000 },
  experimentRead: { name: 'experiment-read', limit: 60, windowMs: 60_000 },
  retentionCurve: { name: 'retention-curve', limit: 30, windowMs: 60_000 },
  draftScore: { name: 'draft-score', limit: 60, windowMs: 60_000 },
  signedVideoUpload: { name: 'signed-video-upload', limit: 10, windowMs: 60_000 },
  publishById: { name: 'publish-by-id', limit: 10, windowMs: 60_000 },
  mcpRemote: { name: 'mcp-remote', limit: 120, windowMs: 60_000 },
  mcpRemotePreAuth: { name: 'mcp-remote-pre-auth', limit: 300, windowMs: 60_000 },
  promptsRead: { name: 'prompts-read', limit: 120, windowMs: 60_000 },
  promptsWrite: { name: 'prompts-write', limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitProfile>;

interface WindowCounter {
  count: number;
  expiresAt: number;
}

interface RateLimitGlobal {
  __rateLimitStore?: Map<string, WindowCounter>;
}

const globalForRateLimit = globalThis as unknown as RateLimitGlobal;

function rateLimitStore(): Map<string, WindowCounter> {
  const existing = globalForRateLimit.__rateLimitStore;
  if (existing !== undefined) return existing;
  const created = new Map<string, WindowCounter>();
  globalForRateLimit.__rateLimitStore = created;
  return created;
}

export const MAX_TRACKED_KEYS = 10_000;

function makeRoom(store: Map<string, WindowCounter>, now: number): void {
  for (const [key, entry] of store) {
    if (now >= entry.expiresAt) store.delete(key);
  }
  for (const key of store.keys()) {
    if (store.size < MAX_TRACKED_KEYS) return;
    store.delete(key);
  }
}

function hit(key: string, profile: RateLimitProfile, now: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const store = rateLimitStore();
  const existing = store.get(key);
  store.delete(key);

  if (existing === undefined || now >= existing.expiresAt) {
    if (store.size >= MAX_TRACKED_KEYS) makeRoom(store, now);
    store.set(key, { count: 1, expiresAt: now + profile.windowMs });
    return { allowed: true, remaining: profile.limit - 1, retryAfterSeconds: 0 };
  }

  store.set(key, existing);
  if (existing.count >= profile.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  existing.count += 1;
  return { allowed: true, remaining: profile.limit - existing.count, retryAfterSeconds: 0 };
}

function isRunningOnVercel(): boolean {
  return process.env.VERCEL === '1';
}

export function getClientIp(request: Request): string {
  if (isRunningOnVercel()) {
    const vercelForwarded = request.headers.get('x-vercel-forwarded-for');
    if (vercelForwarded) {
      const clientIp = vercelForwarded.split(',')[0]?.trim();
      if (clientIp) return clientIp;
    }
  }
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const trusted = entries[entries.length - 1];
    if (trusted) return trusted;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function applyRateLimit(
  request: Request,
  profile: RateLimitProfile,
  identifier?: string
): Promise<NextResponse | null> {
  const id = identifier ?? clientBucket(getClientIp(request));
  const result = hit(`${profile.name}:${id}`, profile, Date.now());

  if (!result.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many requests. Please wait before trying again.',
        errorType: 'RATE_LIMITED',
        retryAfterSeconds: result.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.retryAfterSeconds),
          'X-RateLimit-Limit': String(profile.limit),
          'X-RateLimit-Remaining': String(result.remaining),
        },
      }
    );
  }

  return null;
}
