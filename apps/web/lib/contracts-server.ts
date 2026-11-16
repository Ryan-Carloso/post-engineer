// Server-side helpers for shared endpoint contracts. `readBody` reads and
// validates a request body against the contract body schema, reproducing
// the 400 behavior of the first contract route (POST /api/experiments)
// exactly: invalid JSON, VALIDATION_FAILED, the first-issue message and
// the field extra. The route identifier is `${method} ${path}`.
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiErrorResponse } from './api-error';

export type ReadBodyResult<Body> =
  | { ok: true; body: Body }
  | { ok: false; response: NextResponse };

export async function readBody<Endpoint extends { method: string; path: string; body?: z.ZodType | undefined }>(
  contract: Endpoint,
  request: Request,
  options?: { logMessage?: string },
): Promise<ReadBodyResult<z.output<Exclude<Endpoint['body'], undefined>>>> {
  const route = `${contract.method} ${contract.path}`;
  const schema = contract.body;
  if (schema === undefined) {
    throw new Error(`readBody: contract ${route} has no body schema.`);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: apiErrorResponse(400, 'Invalid JSON payload.', { route, code: 'VALIDATION_FAILED' }),
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.join('.');
    const logMessage = options?.logMessage ?? `Invalid ${contract.path} request.`;
    return {
      ok: false,
      response: apiErrorResponse(
        400,
        `Invalid request: ${field.length > 0 ? `${field}: ` : ''}${issue.message}`.slice(0, 500),
        {
          route,
          code: 'VALIDATION_FAILED',
          logMessage,
          extra: { field: field.slice(0, 200) },
        },
      ),
    };
  }
  return { ok: true, body: parsed.data as z.output<Exclude<Endpoint['body'], undefined>> };
}
