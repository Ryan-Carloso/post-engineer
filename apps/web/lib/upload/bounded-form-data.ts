import { NextResponse } from 'next/server';

export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

type BoundedFormDataErrorCode = 'LENGTH_REQUIRED' | 'PAYLOAD_TOO_LARGE' | 'INVALID_MULTIPART';

export interface BoundedFormDataFailure {
  ok: false;
  status: 400 | 411 | 413;
  code: BoundedFormDataErrorCode;
  error: string;
}

export type BoundedFormDataResult = { ok: true; formData: FormData } | BoundedFormDataFailure;

const FAILURES: Record<BoundedFormDataErrorCode, BoundedFormDataFailure> = {
  LENGTH_REQUIRED: {
    ok: false,
    status: 411,
    code: 'LENGTH_REQUIRED',
    error: 'A Content-Length header is required.',
  },
  PAYLOAD_TOO_LARGE: {
    ok: false,
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    error: 'Request body is too large.',
  },
  INVALID_MULTIPART: {
    ok: false,
    status: 400,
    code: 'INVALID_MULTIPART',
    error: 'Invalid multipart body.',
  },
};

const DIGITS_ONLY = /^\d+$/;

class BodyLimitExceededError extends Error {}

function declaredLength(request: Request): number | null {
  const header = request.headers.get('content-length');
  if (header === null) return null;
  const trimmed = header.trim();
  if (!DIGITS_ONLY.test(trimmed)) return null;
  const length = Number(trimmed);
  return Number.isSafeInteger(length) ? length : null;
}

function countingStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          controller.error(new BodyLimitExceededError());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

function isLimitError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current instanceof BodyLimitExceededError) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<BoundedFormDataResult> {
  const length = declaredLength(request);
  if (length === null) return FAILURES.LENGTH_REQUIRED;
  if (length > maxBytes) return FAILURES.PAYLOAD_TOO_LARGE;
  const contentType = request.headers.get('content-type');
  if (request.body === null || contentType === null) return FAILURES.INVALID_MULTIPART;

  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: countingStream(request.body, maxBytes),
    duplex: 'half',
  };
  try {
    const formData = await new Request(request.url, init).formData();
    return { ok: true, formData };
  } catch (error) {
    return isLimitError(error) ? FAILURES.PAYLOAD_TOO_LARGE : FAILURES.INVALID_MULTIPART;
  }
}

export function boundedFormDataFailureResponse(failure: BoundedFormDataFailure): NextResponse {
  return NextResponse.json(
    { success: false, error: failure.error, code: failure.code },
    { status: failure.status },
  );
}
