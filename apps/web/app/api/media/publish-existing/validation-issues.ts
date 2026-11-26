import { ERROR_CODES, type ErrorCode } from '@/lib/error-codes';

export { MAX_REPORTED_ISSUES } from '@/lib/contracts/videos';

export interface ValidationIssue {
  code: ErrorCode;
  message: string;
  field?: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export function invalid(
  message: string,
  field?: string,
  code: ErrorCode = ERROR_CODES.VALIDATION_FAILED,
): ValidationIssue {
  return { code, message, field };
}
