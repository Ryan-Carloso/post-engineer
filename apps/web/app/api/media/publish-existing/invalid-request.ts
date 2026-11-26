import type { NextResponse } from 'next/server';

import { trackApiEvent } from '@/lib/analytics';
import { apiErrorResponse } from '@/lib/api-error';
import { MAX_REPORTED_ISSUES, type ValidationIssue } from './validation-issues';

const ROUTE = 'POST /api/media/publish-existing';

const MAX_FIELD_PATH_CHARS = 200;

const MAX_ECHOED_MESSAGE_CHARS = 500;

function capField(field: string | undefined): string | undefined {
  return field === undefined ? undefined : field.slice(0, MAX_FIELD_PATH_CHARS);
}

function capMessage(message: string): string {
  return message.slice(0, MAX_ECHOED_MESSAGE_CHARS);
}

export function rejectInvalidRequest(issues: ValidationIssue[]): NextResponse {
  const reported = issues.slice(0, MAX_REPORTED_ISSUES);
  const [first] = reported;
  const field = capField(first.field);
  const message = capMessage(first.message);
  trackApiEvent('video_creation_validation_failed', {
    errorCode: first.code,
    field: field ?? null,
    errorCount: issues.length,
    fields: reported.map((issue) => capField(issue.field) ?? null),
  });
  return apiErrorResponse(400, message, {
    code: first.code,
    field,
    route: ROUTE,
    extra: {
      errors: reported.map((issue) => ({
        code: issue.code,
        message: capMessage(issue.message),
        field: capField(issue.field),
      })),
    },
  });
}
