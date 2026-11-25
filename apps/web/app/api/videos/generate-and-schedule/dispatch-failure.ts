import { ERROR_CODES, type ErrorCode } from '@/lib/error-codes';

export interface DispatchFailureResult {
  errorCode?: string;
}

export interface DispatchFailureClassification {
  status: number;
  code: ErrorCode;
}

const TRANSIENT_ENGINE_CODES = ['engine_unavailable', 'no_task_id'];

export function isEngineRejection(upstreamStatus: number | undefined): boolean {
  return upstreamStatus !== undefined && upstreamStatus >= 400 && upstreamStatus < 500;
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
