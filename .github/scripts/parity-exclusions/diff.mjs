//---------------
// Semantic diff for the MCP parity exclusion file.
//
// The CI guard treats a PR as "touching an exclusion" when it adds a key or
// changes the value of an existing one. Removals are allowed without
// approval: turning an exclusion into a real MCP tool is the desired
// direction, never a reason to block a PR.
//
// Kept dependency-free so `node --test` can exercise it in CI.
//---------------

/**
 * @param {unknown} base parsed exclusions at the merge base
 * @param {unknown} head parsed exclusions at the PR head
 * @returns {{ added: string[], modified: string[] }}
 */
export function changedExclusions(base, head) {
  const before = isPlainObject(base) ? base : {};
  const after = isPlainObject(head) ? head : {};
  const added = [];
  const modified = [];
  for (const [key, value] of Object.entries(after)) {
    if (!Object.prototype.hasOwnProperty.call(before, key)) {
      added.push(key);
      continue;
    }
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) {
      modified.push(key);
    }
  }
  added.sort();
  modified.sort();
  return { added, modified };
}

/** @param {unknown} value */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
