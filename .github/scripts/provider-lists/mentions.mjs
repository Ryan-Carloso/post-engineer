//---------------
// mentions — which provider a source token names.
//
// A token names a provider when it is the provider itself ('youtube'),
// its schedules column ('youtube_account_ids'), the camelCase form of that
// column ('youtubeAccountIds') or the engine's constant name
// ('YOUTUBE_PROVIDER'). The column map comes from
// shared/contracts/providers.ts, so the forms follow the one list.
//---------------

/** @param {readonly string[]} providers @param {Record<string, string>} columns */
export function buildMentionIndex(providers, columns) {
  /** @type {Map<string, string>} */
  const index = new Map();
  for (const provider of providers) {
    const column = columns[provider];
    if (typeof column !== 'string') throw new Error(`no schedules column for provider ${provider}`);
    const stem = column.replace(/_account_ids$/, '');
    index.set(provider, provider);
    index.set(column, provider);
    index.set(`${stem}AccountIds`, provider);
    index.set(`${stem.toUpperCase()}_PROVIDER`, provider);
  }
  return index;
}

/** The provider a whole token names, or null. */
export function mentionOf(index, token) {
  return index.get(token) ?? null;
}

/** Every provider named inside a free text (a select list, a message). */
export function mentionsInText(index, text) {
  const found = [];
  for (const token of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    const provider = index.get(token);
    if (provider !== undefined) found.push(provider);
  }
  return found;
}
