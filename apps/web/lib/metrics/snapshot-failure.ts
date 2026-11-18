import { httpStatusOf, isUnauthorizedError } from '../account-break';

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

export function snapshotFailureDetails(error: unknown): SnapshotFailureDetails {
  return {
    status: httpStatusOf(error),
    metaCode: numericField(error, 'providerCode'),
    metaSubcode: numericField(error, 'providerSubcode'),
  };
}
