import type { z } from 'zod';

//---------------
// Response side of a shared endpoint contract (shared/contracts/*). The
// request sites stay literal `client.request(path, init)` calls in each
// client-*.ts module, because the MCP parity gate proves reachability from
// those literals. The contract types the request input (BodyOf/QueryOf at
// the function signature) and this helper parses the response: a malformed
// 200 is an error, never a silent success.
//---------------

export function parseContractResponse<Schema extends z.ZodType>(
  endpoint: { method: string; path: string; response: Schema },
  raw: unknown,
): z.output<Schema> {
  const parsed = endpoint.response.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue === undefined ? '' : issue.path.join('.');
    throw new Error(
      `Malformed response from ${endpoint.method} ${endpoint.path}${field.length > 0 ? ` at ${field}` : ''}.`,
    );
  }
  return parsed.data;
}
