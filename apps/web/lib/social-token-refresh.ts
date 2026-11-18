//---------------
// social-token-refresh — renews long-lived Meta tokens (Instagram, Threads)
// before they expire, so a healthy account never needs a manual reconnect.
//
// Both providers issue a ~60-day long-lived token that can be exchanged for
// a fresh 60-day token while it is still valid (Meta requires it to be at
// least 24h old). Nothing renewed them before this job, so every Instagram
// and Threads account stopped publishing ~60 days after it was connected.
//
// A token Meta already invalidated (code 190: password change, revoked app,
// security reset) cannot be refreshed — only a new OAuth consent fixes it.
// Those accounts are reported to the owner (deduped email) and skipped.
//
// Pure: the store, the provider refreshers, the reporter and the clock are
// injected. The Supabase store lives in social-token-refresh-store.ts and
// the real wiring in scheduler-jobs.ts.
//---------------

import type { SocialTokenPayload } from '@/lib/social-accounts';

export const TOKEN_REFRESH_PROVIDERS = ['instagram', 'threads'] as const;
export type TokenRefreshProvider = (typeof TOKEN_REFRESH_PROVIDERS)[number];

// Refresh a token once it is within 10 days of expiry. The job runs daily,
// so a transient provider failure gets ~10 retries before the token dies.
// A fresh 60-day token is ~50 days old when it enters the window, far past
// Meta's 24h minimum age for a refresh.
export const TOKEN_REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

// Accounts per run. Refreshes run sequentially with a 15s timeout each, so
// the worst case (50 × 15s = 12.5 min) stays inside the 30-min job lease.
// The oldest-expiring accounts come first; the rest wait for the next run.
export const TOKEN_REFRESH_BATCH_LIMIT = 50;

export const TOKEN_REFRESH_FAILED_EVENT = 'social_token_refresh_failed';

export interface TokenRefreshCandidate {
  id: string;
  userId: string;
  provider: TokenRefreshProvider;
  providerAccountId: string;
  tokens: SocialTokenPayload;
  // The row's updated_at when it was read: the save re-checks it, so a
  // reconnect that lands mid-run is never overwritten by a stale refresh.
  updatedAt: string;
}

export interface RefreshedToken {
  accessToken: string;
  expiresInSeconds: number;
}

export type SaveRefreshedResult = 'saved' | 'row_changed';

export interface TokenRefreshStore {
  // Accounts of the given providers whose token expires after `after` and
  // before `before`, soonest expiry first, at most `limit` rows.
  listExpiring(
    providers: readonly TokenRefreshProvider[],
    after: Date,
    before: Date,
    limit: number,
  ): Promise<TokenRefreshCandidate[]>;
  saveRefreshed(
    candidate: TokenRefreshCandidate,
    tokens: SocialTokenPayload,
    expiresAt: Date,
  ): Promise<SaveRefreshedResult>;
}

export type TokenRefresher = (accessToken: string) => Promise<RefreshedToken>;

export interface TokenRefreshLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, cause: unknown, metadata?: Record<string, unknown>): void;
}

export interface TokenRefreshDeps {
  store: TokenRefreshStore;
  refreshers: Record<TokenRefreshProvider, TokenRefresher>;
  isUnauthorized: (error: unknown) => boolean;
  // Emails the owner that the account must be reconnected (deduped).
  reportBroken: (candidate: TokenRefreshCandidate, error: unknown) => void;
  track: (event: string, properties: Record<string, unknown>) => void;
  logger: TokenRefreshLogger;
  now: () => Date;
}

export interface TokenRefreshReport {
  refreshed: number;
  failed: number;
  unauthorized: number;
  skipped: number;
  truncated: boolean;
}

//---------------
// validateRefreshed — a refresh answer must carry a usable token and a
// positive lifetime; anything else is a failure, never a stored blank.
//---------------
function validateRefreshed(provider: TokenRefreshProvider, refreshed: RefreshedToken): RefreshedToken {
  if (typeof refreshed.accessToken !== 'string' || refreshed.accessToken === '') {
    throw new Error(`${provider} token refresh returned no access token`);
  }
  if (!Number.isFinite(refreshed.expiresInSeconds) || refreshed.expiresInSeconds <= 0) {
    throw new Error(`${provider} token refresh returned an invalid expires_in`);
  }
  return refreshed;
}

//---------------
// refreshExpiringSocialTokens — one run: renew every token that expires
// within the window. Each account is isolated: one failure never stops the
// others. Already-expired tokens are not listed (Meta cannot refresh them).
//---------------
export async function refreshExpiringSocialTokens(deps: TokenRefreshDeps): Promise<TokenRefreshReport> {
  const now = deps.now();
  const before = new Date(now.getTime() + TOKEN_REFRESH_WINDOW_MS);
  const listed = await deps.store.listExpiring(
    TOKEN_REFRESH_PROVIDERS,
    now,
    before,
    TOKEN_REFRESH_BATCH_LIMIT + 1,
  );
  const truncated = listed.length > TOKEN_REFRESH_BATCH_LIMIT;
  const candidates = listed.slice(0, TOKEN_REFRESH_BATCH_LIMIT);
  const report: TokenRefreshReport = { refreshed: 0, failed: 0, unauthorized: 0, skipped: 0, truncated };

  for (const candidate of candidates) {
    const accessToken = candidate.tokens.access_token;
    if (typeof accessToken !== 'string' || accessToken === '') {
      report.skipped += 1;
      deps.logger.error('[token-refresh] stored token has no access_token', null, {
        provider: candidate.provider,
        accountId: candidate.providerAccountId,
      });
      continue;
    }
    try {
      const refreshed = validateRefreshed(
        candidate.provider,
        await deps.refreshers[candidate.provider](accessToken),
      );
      const expiresAt = new Date(deps.now().getTime() + refreshed.expiresInSeconds * 1000);
      const saved = await deps.store.saveRefreshed(
        candidate,
        { ...candidate.tokens, access_token: refreshed.accessToken, expiry_date: expiresAt.getTime() },
        expiresAt,
      );
      if (saved === 'row_changed') {
        // The account was reconnected or deleted during the run: its row
        // already holds a newer token (or none), so the refresh is dropped.
        report.skipped += 1;
        deps.logger.info('[token-refresh] account changed during refresh, kept the newer row', {
          provider: candidate.provider,
          accountId: candidate.providerAccountId,
        });
        continue;
      }
      report.refreshed += 1;
    } catch (error) {
      const unauthorized = deps.isUnauthorized(error);
      report.failed += 1;
      if (unauthorized) report.unauthorized += 1;
      deps.logger.error('[token-refresh] refresh failed', error, {
        provider: candidate.provider,
        accountId: candidate.providerAccountId,
        unauthorized,
      });
      deps.track(TOKEN_REFRESH_FAILED_EVENT, {
        provider: candidate.provider,
        account_id: candidate.providerAccountId,
        user_id: candidate.userId,
        unauthorized,
      });
      // A dead token will not heal on retry: tell the owner to reconnect.
      // Any other failure (5xx, timeout) retries on the next daily run.
      if (unauthorized) deps.reportBroken(candidate, error);
    }
  }

  if (truncated) {
    deps.logger.info('[token-refresh] batch limit reached, the rest waits for the next run', {
      limit: TOKEN_REFRESH_BATCH_LIMIT,
    });
  }
  return report;
}
