import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/contracts/providers';
import { invalid, MAX_REPORTED_ISSUES, type Checked } from './validation-issues';

export type Provider = SocialProvider;

const MAX_PROVIDER_CHARS = 100;

function shownProvider(provider: string): string {
  return provider.length > MAX_PROVIDER_CHARS ? `${provider.slice(0, MAX_PROVIDER_CHARS)}…` : provider;
}

export function validateProviders(rawProviders: string[]): Checked<Provider[]> {
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
  const known = SOCIAL_PROVIDERS as ReadonlyArray<string>;
  const issues = providers
    .filter((provider) => !known.includes(provider))
    .map((provider) =>
      invalid(
        `Invalid provider: "${shownProvider(provider)}". Use one of ${SOCIAL_PROVIDERS.join(', ')}.`,
        'publishing.providers',
      ),
    );
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: providers as Provider[] };
}

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
