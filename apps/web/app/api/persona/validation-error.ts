import type { NextResponse } from 'next/server';
import { apiErrorResponse, type ApiErrorOptions } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import type { LibraryImagesError } from '@/lib/persona-images';

//---------------
// libraryImagesErrorField — the failing field for an addLibraryImages 400.
// The library errors are stable templates, so the field is read off the
// message prefix: a tag/description length error names its field, a full
// library names no field (no single input failed), and file-content errors
// fall back to 'file'.
//---------------
export function libraryImagesErrorField(error: string): string | undefined {
  if (error.startsWith('tag ')) return 'tag';
  if (error.startsWith('description ')) return 'description';
  if (error.startsWith('Image library is full')) return undefined;
  return 'file';
}

//---------------
// forwardLibraryImagesError — forwards an addLibraryImages failure as the
// route response. A 400 keeps the stable VALIDATION_FAILED code with the
// field the message names; any other status passes through as-is (a 500
// is not a validation error and must not gain the code).
//---------------
export function forwardLibraryImagesError(added: LibraryImagesError, route: string): NextResponse {
  if (added.status === 400) {
    return personaValidationError(added.error, route, {
      field: libraryImagesErrorField(added.error),
    });
  }
  return apiErrorResponse(added.status, added.error, { route });
}
export function personaValidationError(
  error: string,
  route: string,
  options?: Omit<ApiErrorOptions, 'route'>,
): NextResponse {
  return apiErrorResponse(400, error, { route, code: ERROR_CODES.VALIDATION_FAILED, ...options });
}
