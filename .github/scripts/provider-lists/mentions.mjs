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
  }
  return index;
}

export function mentionOf(index, token) {
  return index.get(token) ?? null;
}

export function mentionsInText(index, text) {
  const found = [];
  for (const token of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    const provider = index.get(token);
    if (provider !== undefined) found.push(provider);
  }
  return found;
}
