//---------------
// rules — what makes a group of provider mentions a violation.
//
// A scanner reports groups: one syntax node that names several providers.
//   list  — an array, tuple, set, union type or Literal[...] of providers
//   chain — a ternary, if/else-if, ||/&& or switch/match chain that
//           compares a value against several providers
//   map   — an object, dict, interface or type literal keyed by providers
//   text  — one string that names several providers (a select list)
//
// Rules, for a group that names at least MIN_PROVIDERS distinct providers:
//   list, chain — a list is allowed only in a home file (the shared list
//     and the mirrors); a chain never. A list is a hand copy
//     of SOCIAL_PROVIDERS or of a subset: import the constant (or add a
//     named subset to shared/contracts/providers.ts). A chain is per-
//     provider logic with a silent default: use a Record<SocialProvider, …>,
//     which fails the typecheck until a new provider has its entry.
//   map, text — must name every provider, or exactly one named subset.
//     A map that skips a provider is how a network ends up with no logic:
//     give it an explicit entry (null when it has nothing to do).
//---------------

export const MIN_PROVIDERS = 3;

/**
 * @param {{ file: string, line: number, kind: 'list'|'chain'|'map'|'text', providers: string[] }} group
 * @param {{ providers: readonly string[], subsets: Record<string, readonly string[]>, home: boolean }} context
 *   home: the group is in the shared list's file or a mirror, where lists live
 * @returns {string | null} the violation message, or null when the group is allowed
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
