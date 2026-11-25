import { ERROR_CODES, type ErrorCode } from '@/lib/error-codes';

export interface DispatchFailureResult {
  errorCode?: string;
}

export interface DispatchFailureClassification {
  status: number;
  code: ErrorCode;
}

const TRANSIENT_ENGINE_CODES = ['engine_unavailable', 'no_task_id'];

const TRANSIENT_UPSTREAM_STATUSES: ReadonlySet<number> = new Set([401, 403, 408, 425, 429]);

export function isEngineRejection(upstreamStatus: number | undefined): boolean {
  return (
    upstreamStatus !== undefined &&
    upstreamStatus >= 400 &&
    upstreamStatus < 500 &&
    !TRANSIENT_UPSTREAM_STATUSES.has(upstreamStatus)
  );
}

export function classifyDispatchFailure(
  results: DispatchFailureResult[],
): DispatchFailureClassification {
  if (results.length === 0) {
    return { status: 500, code: ERROR_CODES.INTERNAL_ERROR };
  }
  const codes = results.map((result) => result.errorCode ?? '');
  if (codes.every((code) => code === 'engine_rejected')) {
    return { status: 400, code: ERROR_CODES.ENGINE_REJECTED };
  }
  if (codes.every((code) => code === 'engine_rejected' || TRANSIENT_ENGINE_CODES.includes(code))) {
    return { status: 502, code: ERROR_CODES.ENGINE_UNAVAILABLE };
  }
  return { status: 500, code: ERROR_CODES.INTERNAL_ERROR };
}
