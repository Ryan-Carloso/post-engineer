import 'server-only';

import { NextResponse } from 'next/server';

//---------------
// Rate Limit — in-memory fixed-window limiter, zero dependencies.
//
// ⚠️ Known limitation: on serverless (Vercel) each instance has its own
// ephemeral memory, so the limit is PER INSTANCE — under horizontal
// scaling the effective ceiling is limit × instances. It still blocks
// trivial abuse with no cost and no external service.
//
// Usage in a route:
//   const limited = await applyRateLimit(request, RATE_LIMITS.upload, identifier);
//   if (limited) return limited;
//---------------

export interface RateLimitProfile {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  // YouTube video upload: heavy (API quota + memory)
  youtubeUpload: { name: 'youtube-upload', limit: 5, windowMs: 60_000 },
  // Instagram media upload: writes up to 100MB to disk
  mediaUpload: { name: 'media-upload', limit: 10, windowMs: 60_000 },
  // Instagram content posting
  instagramPost: { name: 'instagram-post', limit: 10, windowMs: 60_000 },
  // OAuth token endpoint: brute-force / token-farming protection
  oauthToken: { name: 'oauth-token', limit: 30, windowMs: 60_000 },
  // OAuth dynamic client registration: abuse/registration-flood protection
  oauthRegister: { name: 'oauth-register', limit: 10, windowMs: 60_000 },
  // API key management (minting): key-farming protection
  apiKeyManage: { name: 'api-key-manage', limit: 20, windowMs: 60_000 },
  // Bluesky credential exchange: credential-stuffing protection
  blueskyConnect: { name: 'bluesky-connect', limit: 10, windowMs: 60_000 },
  // Billing checkout session creation: abuse protection
  billingCheckout: { name: 'billing-checkout', limit: 10, windowMs: 60_000 },
  // Video generation job submission: cost protection
  videoJob: { name: 'video-job', limit: 20, windowMs: 60_000 },
  // Unified generate+schedule: one call can mint up to 10 videos, so the
  // limit is lower than the single video-job profile. Keyed by user id
  // (falling back to API-key id, then IP inside applyRateLimit).
  generateAndSchedule: { name: 'generate-and-schedule', limit: 10, windowMs: 60_000 },
  // OAuth connect-url issuance (starts provider OAuth flows)
  connectUrl: { name: 'connect-url', limit: 30, windowMs: 60_000 },
  // OAuth /start routes (provider authorization redirects)
  oauthStart: { name: 'oauth-start', limit: 30, windowMs: 60_000 },
  // Persona delete preview: fans out to the engine (one lookup per video),
  // so it is capped and rate-limited like the other expensive surfaces.
  // Keyed by user id (falling back to API-key id, then IP inside
  // applyRateLimit).
  deletePreview: { name: 'delete-preview', limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitProfile>;

//---------------
// In-memory counters: key = `${profile}:${identifier}`, value =
// { count, windowStart }. Lazy cleanup: expired entries are removed when
// found or when the table exceeds its maximum size.
//---------------

interface WindowCounter {
  count: number;
  windowStart: number;
}

// Store on globalThis to survive Next.js dev hot-reload
// (each reload recreates the module, but not the global scope).
interface RateLimitGlobal {
  __rateLimitStore?: Map<string, WindowCounter>;
}

const globalForRateLimit = globalThis as unknown as RateLimitGlobal;
const store: Map<string, WindowCounter> =
  globalForRateLimit.__rateLimitStore ?? new Map<string, WindowCounter>();
globalForRateLimit.__rateLimitStore = store;

const MAX_TRACKED_KEYS = 10_000;

function hit(key: string, profile: RateLimitProfile, now: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  // Defensive cleanup against unbounded table growth
  if (store.size >= MAX_TRACKED_KEYS) {
    for (const [k, entry] of store) {
      if (now - entry.windowStart >= profile.windowMs) store.delete(k);
    }
    if (store.size >= MAX_TRACKED_KEYS) store.clear();
  }

  const existing = store.get(key);
  const isNewWindow = !existing || now - existing.windowStart >= profile.windowMs;

  if (isNewWindow) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: profile.limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= profile.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStart + profile.windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  existing.count += 1;
  return { allowed: true, remaining: profile.limit - existing.count, retryAfterSeconds: 0 };
}

//---------------
// getClientIp — resolves the client IP for rate-limit bucketing.
//
// Trust order:
//  1. x-vercel-forwarded-for — ONLY when running on Vercel (VERCEL=1,
//     platform-set). Outside Vercel this header is client-controlled and
//     must never be trusted.
//  2. The LAST x-forwarded-for entry — the hop appended by the trusted
//     proxy closest to us. The FIRST entry is client-controlled and must
//     never be trusted: anyone could spoof it to reset their own bucket.
//     Self-hosting: the front proxy must OVERWRITE (not append to)
//     x-forwarded-for, otherwise buckets collapse into the proxy IP.
//  3. x-real-ip, then 'unknown'.
//---------------

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

//---------------
// applyRateLimit — checks the limit. Returns a 429 NextResponse when
// exceeded, or null when the request may proceed.
//---------------

export async function applyRateLimit(
  request: Request,
  profile: RateLimitProfile,
  identifier?: string
): Promise<NextResponse | null> {
  const id = identifier ?? getClientIp(request);
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
