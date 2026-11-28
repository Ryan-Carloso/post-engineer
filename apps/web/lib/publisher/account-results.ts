import { isRecord } from '@/lib/publisher/types';

export type AccountTarget = { kind: 'published' | 'failed'; source: Record<string, unknown> };

const LINK_FIELDS = ['videoUrl', 'permalink', 'postId'] as const;
const DEFAULT_FAILURE = 'upload API reported account failure';

function hasLink(result: Record<string, unknown>): boolean {
  return LINK_FIELDS.some((name) => {
    const value = result[name];
    return typeof value === 'string' && value !== '';
  });
}

function failure(error: string, errorCode: string | null = null): AccountTarget {
  return { kind: 'failed', source: { error, errorCode } };
}

function errorCodeOf(result: Record<string, unknown>): string | null {
  return typeof result.errorCode === 'string' ? result.errorCode : null;
}

export function interpretResult(result: Record<string, unknown>): AccountTarget {
  if (result.success === true || hasLink(result)) {
    return result.success === false ? { kind: 'failed', source: result } : { kind: 'published', source: result };
  }
  const message = typeof result.error === 'string' && result.error !== '' ? result.error : DEFAULT_FAILURE;
  return failure(message, errorCodeOf(result));
}

function placeholderTarget(results: Record<string, unknown>[]): AccountTarget {
  const [only] = results;
  if (results.length === 1 && only !== undefined) return interpretResult(only);
  const succeeded = results.find((item) => item.success === true);
  if (succeeded !== undefined) return { kind: 'published', source: succeeded };
  const withError = results.find((item) => item.success !== true && typeof item.error === 'string' && item.error !== '');
  const withCode = results.find((item) => errorCodeOf(item) !== null);
  return failure(
    typeof withError?.error === 'string' ? withError.error : DEFAULT_FAILURE,
    withCode === undefined ? null : errorCodeOf(withCode),
  );
}

export function targetsFromResults(pending: string[], rawResults: unknown): Map<string, AccountTarget> {
  const assigned = new Map<string, AccountTarget>();
  const failAll = (message: string): Map<string, AccountTarget> => {
    for (const accountId of pending) assigned.set(accountId, failure(message));
    return assigned;
  };
  if (!Array.isArray(rawResults)) return failAll('publish returned no per-account results');
  if (rawResults.length === 0) return failAll('publish returned an empty results list');
  const results = rawResults.filter(isRecord);
  if (results.length === 0) return failAll('publish returned no per-account results');

  if (pending.length === 1 && pending[0] === '') {
    assigned.set('', placeholderTarget(results));
    return assigned;
  }

  const byId = new Map<string, Record<string, unknown>>();
  const unlabeled: Record<string, unknown>[] = [];
  for (const item of results) {
    if (typeof item.accountId === 'string' && item.accountId !== '') byId.set(item.accountId, item);
    else unlabeled.push(item);
  }
  const onlyPending = pending[0];
  const onlyResult = results[0];
  if (pending.length === 1 && onlyPending !== undefined && results.length === 1 && onlyResult !== undefined && !byId.has(onlyPending)) {
    assigned.set(onlyPending, interpretResult(onlyResult));
    return assigned;
  }
  let shared = unlabeled.length === 1 ? (unlabeled[0] ?? null) : null;
  if (shared !== null && pending.length > 1 && interpretResult(shared).kind !== 'failed') shared = null;
  for (const accountId of pending) {
    const item = byId.get(accountId) ?? shared;
    assigned.set(accountId, item === null ? failure(DEFAULT_FAILURE) : interpretResult(item));
  }
  return assigned;
}
