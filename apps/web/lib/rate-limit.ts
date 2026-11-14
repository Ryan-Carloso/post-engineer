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
  // Video download proxy: a list page loads one thumbnail per row and a player
  // issues a range request per seek, so playback needs far more headroom than
  // an upload. Separate bucket so browsing never eats the upload budget.
  videoDownload: { name: 'video-download', limit: 120, windowMs: 60_000 },
  // Voice clone registration: GPU/registry cost — stricter than media upload.
  voiceCloneCreate: { name: 'voice-clone-create', limit: 3, windowMs: 60 * 60 * 1000 },
  voiceCloneDenoisePreview: { name: 'voice-clone-denoise-preview', limit: 20, windowMs: 60 * 60 * 1000 },
  // Cloned-voice TTS preview (optional caller text): free, so capped per user per day
  // across all clones to keep it from becoming a free TTS service.
  voiceClonePreview: { name: 'voice-clone-preview', limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  // House-voice TTS preview (optional caller text): same daily cap as the
  // cloned preview, but a separate bucket — comparing house voices must
  // never eat the clone budget, or vice versa.
  voicePreview: { name: 'voice-preview', limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  // Instagram content posting
  instagramPost: { name: 'instagram-post', limit: 10, windowMs: 60_000 },
  // Pinterest video Pin publishing (register + S3 upload + poll + pin create)
  pinterestUpload: { name: 'pinterest-upload', limit: 10, windowMs: 60_000 },
  // Pinterest board listing for the board picker (bounded read, no writes)
  pinterestBoards: { name: 'pinterest-boards', limit: 60, windowMs: 60_000 },
  // OAuth token endpoint: brute-force / token-farming protection
  oauthToken: { name: 'oauth-token', limit: 30, windowMs: 60_000 },
  // OAuth dynamic client registration: abuse/registration-flood protection
  oauthRegister: { name: 'oauth-register', limit: 10, windowMs: 60_000 },
  // API key management (minting): key-farming protection
  apiKeyManage: { name: 'api-key-manage', limit: 20, windowMs: 60_000 },
  // Bluesky credential exchange: credential-stuffing protection
  blueskyConnect: { name: 'bluesky-connect', limit: 10, windowMs: 60_000 },
  // 3Speak credential exchange (Hive posting key): same protection as
  // the Bluesky app-password exchange — a new route gets its own profile
  // (never a reused semantic profile).
  threespeakConnect: { name: 'threespeak-connect', limit: 10, windowMs: 60_000 },
  // Rumble token connect: same shape as Bluesky (a pasted credential)
  rumbleConnect: { name: 'rumble-connect', limit: 10, windowMs: 60_000 },
  // Billing checkout session creation: abuse protection
  billingCheckout: { name: 'billing-checkout', limit: 10, windowMs: 60_000 },
  // Video generation job submission: cost protection
  videoJob: { name: 'video-job', limit: 20, windowMs: 60_000 },
  // Unified generate+schedule: one call is one video. 12 per minute so a
  // full MCP batch (MAX_BATCH_VIDEOS, lib/billing/batch-discount.ts) fits
  // in one window. Keyed by user id (falling back to API-key id, then IP
  // inside applyRateLimit).
  generateAndSchedule: { name: 'generate-and-schedule', limit: 12, windowMs: 60_000 },
  // Batch discount: one call per MCP batch (plus retries). Each call reads
  // up to MAX_BATCH_VIDEOS slots and credits at most two of them.
  batchDiscount: { name: 'batch-discount', limit: 10, windowMs: 60_000 },
  // OAuth connect-url issuance (starts provider OAuth flows)
  connectUrl: { name: 'connect-url', limit: 30, windowMs: 60_000 },
  // OAuth /start routes (provider authorization redirects)
  oauthStart: { name: 'oauth-start', limit: 30, windowMs: 60_000 },
  // Persona delete preview: fans out to the engine (one lookup per video),
  // so it is capped and rate-limited like the other expensive surfaces.
  // Keyed by user id (falling back to API-key id, then IP inside
  // applyRateLimit).
  deletePreview: { name: 'delete-preview', limit: 30, windowMs: 60_000 },
  // Persona delete: multi-table destructive cascade plus engine fan-out.
  // Lower than the preview — a delete is rare and irreversible.
  personaDelete: { name: 'persona-delete', limit: 10, windowMs: 60_000 },
  // Persona POST/PATCH: remote ingest can fetch attacker-chosen URLs (10s).
  personaWrite: { name: 'persona-write', limit: 20, windowMs: 60_000 },
  // Unified post detail: a cheap GET, but polled by the detail page while
  // a video generates — the limit is generous enough for polling.
  postDetail: { name: 'post-detail', limit: 120, windowMs: 60_000 },
  // Per-persona default publishing accounts: tiny rows, no fan-out. The UI
  // saves on button click (not per keystroke), so 60/min is generous.
  publishingAccounts: { name: 'publishing-accounts', limit: 60, windowMs: 60_000 },
  // Metrics dashboard: one bounded read per filter change.
  metrics: { name: 'metrics', limit: 60, windowMs: 60_000 },
  // Content experiments (issue #476): creating one is a write, reading the
  // results fans out to three tables — both bounded per user.
  experimentCreate: { name: 'experiment-create', limit: 10, windowMs: 60_000 },
  experimentRead: { name: 'experiment-read', limit: 60, windowMs: 60_000 },
  // Retention curve: two live Google calls (Data API ownership check +
  // Analytics report) per request, opened on demand per video.
  retentionCurve: { name: 'retention-curve', limit: 30, windowMs: 60_000 },
  // Draft scoring: one capped metrics read per call, no writes, no
  // engine call — cheaper than metrics, so it shares the same budget.
  draftScore: { name: 'draft-score', limit: 60, windowMs: 60_000 },
  // Signed video uploads (issue #561): minting a signed URL and verifying
  // an uploaded object (one storage download of up to 2GB per complete).
  signedVideoUpload: { name: 'signed-video-upload', limit: 10, windowMs: 60_000 },
  // Publish-by-id (issue #561): one provider publish fan-out per call,
  // same weight as the direct multipart publish.
  publishById: { name: 'publish-by-id', limit: 10, windowMs: 60_000 },
  // Hosted remote MCP (issue #561): per-subject limit mirrors the MCP
  // package's DEFAULT_RATE_LIMIT_PER_MINUTE (apps/mcp/src/http-auth.ts),
  // pinned by the sync test in app/mcp/__tests__/rate-limit-sync.test.ts.
  mcpRemote: { name: 'mcp-remote', limit: 120, windowMs: 60_000 },
  // Hosted remote MCP, pre-auth per-IP budget: checked before any token
  // verification, so unauthenticated traffic cannot force unlimited
  // asymmetric verifies. Mirrors PRE_AUTH_IP_LIMIT_PER_MINUTE
  // (apps/mcp/src/http-rate-limit.ts), pinned by the same sync test.
  mcpRemotePreAuth: { name: 'mcp-remote-pre-auth', limit: 300, windowMs: 60_000 },
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
