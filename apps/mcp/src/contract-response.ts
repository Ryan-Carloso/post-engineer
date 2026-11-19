import type { z } from 'zod';

export class MalformedContractResponseError extends Error {}

export function parseContractResponse<Schema extends z.ZodType>(
  endpoint: { method: string; path: string; response: Schema },
  raw: unknown,
): z.output<Schema> {
  const parsed = endpoint.response.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue === undefined ? '' : issue.path.join('.');
    throw new MalformedContractResponseError(
      `Malformed response from ${endpoint.method} ${endpoint.path}${field.length > 0 ? ` at ${field}` : ''}.`,
    );
  }
  return parsed.data;
}
