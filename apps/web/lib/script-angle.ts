//---------------
// Script angle narrowing — shared by the client payload narrowing
// (lib/api.ts) so the "what counts as an angle" rule lives in one place.
//---------------

// Only a non-empty string is an angle; anything else (absent key from an
// older server, null, malformed) renders as "no angle".
export function narrowScriptAngle(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
