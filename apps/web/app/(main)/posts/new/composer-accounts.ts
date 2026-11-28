import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/contracts/providers';
import { providersForMedia, type ComposerMediaKind } from '@/lib/post-composer/compose';
import type { PersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';

export function pruneAccounts(
  accounts: Partial<Record<SocialProvider, string[]>>,
  kind: ComposerMediaKind | null,
): Partial<Record<SocialProvider, string[]>> {
  const allowed = new Set<SocialProvider>(providersForMedia(kind));
  const kept: Partial<Record<SocialProvider, string[]>> = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const ids = accounts[provider];
    if (ids !== undefined && ids.length > 0 && allowed.has(provider)) kept[provider] = ids;
  }
  return kept;
}

export function pruneDisconnectedAccounts(
  accounts: Partial<Record<SocialProvider, string[]>>,
  connected: ReadonlySet<string>,
): Partial<Record<SocialProvider, string[]>> {
  const kept: Partial<Record<SocialProvider, string[]>> = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const ids = accounts[provider];
    if (ids === undefined) continue;
    const visible = ids.filter((id) => connected.has(`${provider}\0${id}`));
    if (visible.length > 0) kept[provider] = visible;
  }
  return kept;
}

export function preselectedAccounts(
  bound: PersonaDefaultAccounts,
  kind: ComposerMediaKind | null,
): Partial<Record<SocialProvider, string[]>> {
  const allowed = new Set<SocialProvider>(providersForMedia(kind));
  const selected: Partial<Record<SocialProvider, string[]>> = {};
  for (const provider of SOCIAL_PROVIDERS) {
    if (allowed.has(provider) && bound[provider].length > 0) {
      selected[provider] = [...bound[provider]];
    }
  }
  return selected;
}
