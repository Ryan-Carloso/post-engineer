export const MIN_PROVIDERS = 3;

/**
 * @param {{ file: string, line: number, kind: 'list'|'chain'|'map'|'text', providers: string[] }} group
 * @param {{ providers: readonly string[], subsets: Record<string, readonly string[]>, home: boolean }} context
 * @returns {string | null}
 */
export function violationOf(group, context) {
  const named = [...new Set(group.providers)];
  if (named.length < MIN_PROVIDERS) return null;
  const listed = named.join(', ');
  if (group.kind === 'list') {
    if (context.home) return null;
    return `hand-typed provider list (${listed}): import SOCIAL_PROVIDERS or a named subset from shared/contracts/providers.ts`;
  }
  if (group.kind === 'chain') {
    return `per-provider chain over ${listed}: use a Record<SocialProvider, …> (or a named subset predicate) so a new provider cannot fall through to a default branch`;
  }
  const set = new Set(named);
  const sameAs = (members) => members.length === set.size && members.every((member) => set.has(member));
  if (sameAs(context.providers)) return null;
  for (const members of Object.values(context.subsets)) if (sameAs(members)) return null;
  const missing = context.providers.filter((provider) => !set.has(provider));
  const what = group.kind === 'map' ? 'per-provider map' : 'string';
  return `${what} names ${named.length} of ${context.providers.length} providers, missing: ${missing.join(', ')} — give every provider an entry (null when it has nothing to do) or match a named subset in shared/contracts/providers.ts`;
}
