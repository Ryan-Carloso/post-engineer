import { httpStatusOf, isUnauthorizedError } from '../account-break';

//---------------
// snapshot-failure — classifies one collector snapshot failure so the
// metrics collector knows whether to wait, skip, or retry:
//
// - `token_dead`: the connected account token is dead (Meta HTTP 400 +
//   providerCode 190, OAuthException; HTTP 401 for other providers).
//   isUnauthorizedError already treats providerCode 190 as unauthorized.
//   Keep the window open: a later run measures the video after the
//   user reconnects the account.
// - `media_gone`: the video itself is gone and no retry will ever work.
//   Meta answers a deleted/unknown media with HTTP 400 + code 100 +
//   error_subcode 33 ("Unsupported get request. Object ... does not
//   exist, cannot be loaded due to missing permissions, or does not
//   support this operation"). Code 100 alone is a generic "invalid
//   parameter" and is NOT treated as gone — only 100/33 is, so an
//   unrecognised code-100 variant stays transient and retries.
//   HTTP 404 (any provider) is also gone: a 404 means the object is
//   truly absent. Terminal skip, reusing the "snapshot skipped"
//   pattern: report once and let the window close.
// - `transient`: everything else (429, 5xx, network, timeouts,
//   unknown). Retry on the next run.
//
// The helper is pure (no server-only import), like account-break.ts,
// so the collector and its tests can import it without a cycle.
//---------------
export type SnapshotFailureKind = 'token_dead' | 'media_gone' | 'transient';

function numericField(error: unknown, key: string): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function classifySnapshotFailure(error: unknown): SnapshotFailureKind {
  if (isUnauthorizedError(error)) return 'token_dead';
  if (httpStatusOf(error) === 404) return 'media_gone';
  if (numericField(error, 'providerCode') === 100 && numericField(error, 'providerSubcode') === 33) {
    return 'media_gone';
  }
  return 'transient';
}

export interface SnapshotFailureDetails {
  status: number | undefined;
  metaCode: number | undefined;
  metaSubcode: number | undefined;
}

// The status + Meta code the collector logs on every failure branch,
// so the cause is visible without reading the code.
export function snapshotFailureDetails(error: unknown): SnapshotFailureDetails {
  return {
    status: httpStatusOf(error),
    metaCode: numericField(error, 'providerCode'),
    metaSubcode: numericField(error, 'providerSubcode'),
  };
}
