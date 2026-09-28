/**
 * Shared error-formatting helpers.
 *
 * Lives in its own module because both `client.ts` and `tools.ts` need it:
 * `tools.ts` already imports the exported limit constants from `client.ts`,
 * so defining it in `tools.ts` would create a client↔tools import cycle.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
