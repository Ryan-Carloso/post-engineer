import type { SocialTokenPayload } from '@/lib/social-accounts';

export const TOKEN_REFRESH_PROVIDERS = ['instagram', 'threads'] as const;
export type TokenRefreshProvider = (typeof TOKEN_REFRESH_PROVIDERS)[number];

export const TOKEN_REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export const TOKEN_REFRESH_BATCH_LIMIT = 50;

export const TOKEN_REFRESH_FAILED_EVENT = 'social_token_refresh_failed';

export interface TokenRefreshCandidate {
  id: string;
  userId: string;
  provider: TokenRefreshProvider;
  providerAccountId: string;
  tokens: SocialTokenPayload;
  updatedAt: string;
}

export interface RefreshedToken {
  accessToken: string;
  expiresInSeconds: number;
}

export type SaveRefreshedResult = 'saved' | 'row_changed';

export interface TokenRefreshStore {
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

function validateRefreshed(provider: TokenRefreshProvider, refreshed: RefreshedToken): RefreshedToken {
  if (typeof refreshed.accessToken !== 'string' || refreshed.accessToken === '') {
    throw new Error(`${provider} token refresh returned no access token`);
  }
  if (!Number.isFinite(refreshed.expiresInSeconds) || refreshed.expiresInSeconds <= 0) {
    throw new Error(`${provider} token refresh returned an invalid expires_in`);
  }
  return refreshed;
}

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
