//---------------
// Provider validation for POST /api/videos/generate-and-schedule. Runs
// BEFORE any token is charged. Every unknown provider is reported, not just
// the first one.
//---------------

import { VALID_SCHEDULE_PROVIDERS } from '@/app/api/schedule/route';
import { invalid, MAX_REPORTED_ISSUES, type Checked } from './validation-issues';

export type Provider = (typeof VALID_SCHEDULE_PROVIDERS)[number];

// A provider value is caller-controlled and is echoed in the 400 message.
// Keep the "use one of" hint by shortening the name, not the whole sentence.
const MAX_PROVIDER_CHARS = 100;

function shownProvider(provider: string): string {
  return provider.length > MAX_PROVIDER_CHARS ? `${provider.slice(0, MAX_PROVIDER_CHARS)}…` : provider;
}

export function validateProviders(rawProviders: string[]): Checked<Provider[]> {
  // Stop before building one issue per entry. The route also rejects this
  // length at the schema, so a normal request never reaches the map below
  // with more than MAX_REPORTED_ISSUES values.
  if (rawProviders.length > MAX_REPORTED_ISSUES) {
    return {
      ok: false,
      issues: [invalid(`At most ${MAX_REPORTED_ISSUES} providers.`, 'publishing.providers')],
    };
  }
  const providers = [...new Set(rawProviders.map((p) => p.trim()).filter((p) => p.length > 0))];
  if (providers.length === 0) {
    return { ok: false, issues: [invalid('Select at least one provider.', 'publishing.providers')] };
  }
  const known = VALID_SCHEDULE_PROVIDERS as ReadonlyArray<string>;
  const issues = providers
    .filter((provider) => !known.includes(provider))
    .map((provider) =>
      invalid(
        `Invalid provider: "${shownProvider(provider)}". Use one of ${VALID_SCHEDULE_PROVIDERS.join(', ')}.`,
        'publishing.providers',
      ),
    );
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: providers as Provider[] };
}

// A Pinterest publish needs exactly one board for the batch (a pin
// cannot exist without one, and the schedule carries one board id).
// The board id is a numeric Pinterest id; anything longer than the
// column the route writes is a caller bug, not a board.
export function validatePinterestBoard(
  providers: string[],
  boardId: string | undefined,
): Checked<string | null> {
  if (!providers.includes('pinterest')) return { ok: true, value: null };
  if (boardId === undefined || boardId.trim() === '') {
    return {
      ok: false,
      issues: [invalid('Pinterest publishing needs a board: set publishing.pinterestBoardId.', 'publishing.pinterestBoardId')],
    };
  }
  if (boardId.trim().length > 100) {
    return {
      ok: false,
      issues: [invalid('Pinterest board id is too long.', 'publishing.pinterestBoardId')],
    };
  }
  return { ok: true, value: boardId.trim() };
}
