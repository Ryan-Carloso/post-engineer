import type { NextResponse } from 'next/server';
import { apiErrorResponse, type ApiErrorOptions } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import type { LibraryImagesError } from '@/lib/persona-images';

export function libraryImagesErrorField(error: string): string | undefined {
  if (error.startsWith('tag ')) return 'tag';
  if (error.startsWith('description ')) return 'description';
  if (error.startsWith('Image library is full')) return undefined;
  return 'file';
}

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
