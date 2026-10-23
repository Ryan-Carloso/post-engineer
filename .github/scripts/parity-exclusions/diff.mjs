//---------------
// What a PR changes in the MCP parity gate, and whether that change needs
// code-owner approval.
//
// Guarded: the exclusion data, the parity test and its verifier modules,
// the behavioural bearer test, these guard scripts, the guard workflow and
// CODEOWNERS. Any change to a guarded file needs approval, with one
// exception: a change to parity-exclusions.json that only removes entries
// (an exclusion replaced by a real MCP tool, or a dropped opsPublic entry)
// is the desired direction and never blocks a PR.
//
// parity-endpoint-tools.json is deliberately not guarded: every mapping in
// it is proven by the parity test (the tool must call that method + path),
// so adding a tool needs no approval.
//
// Malformed exclusion data counts as a change (fail closed).
//
// Kept dependency-free so `node --test` can exercise it in CI.
//---------------

export const EXCLUSIONS_PATH = 'apps/mcp/src/__tests__/parity-exclusions.json';

/** Exact paths, or directory prefixes ending in '/'. */
export const GUARDED_PATHS = [
  EXCLUSIONS_PATH,
  'apps/mcp/src/__tests__/web-api-parity.test.ts',
  'apps/mcp/src/__tests__/parity-verifier.test.ts',
  'apps/mcp/src/__tests__/parity/',
  'apps/web/app/api/__tests__/parity-exclusion-bearer.test.ts',
  'apps/web/vitest.config.ts',
  'apps/web/package.json',
  'apps/web/project.json',
  'apps/mcp/package.json',
  'apps/mcp/project.json',
  'apps/mcp/tsconfig.spec.json',
  'apps/mcp/vitest.config.ts',
  'apps/mcp/vite.config.ts',
  '.github/scripts/parity-exclusions/',
  '.github/workflows/parity-exclusion-guard.yml',
  '.github/CODEOWNERS',
];

/** @param {string} path */
export function isGuarded(path) {
  return GUARDED_PATHS.some((guarded) =>
    guarded.endsWith('/') ? path.startsWith(guarded) : path === guarded,
  );
}

/** @param {unknown} value */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} data
 * @returns {{ opsPublic: string[], exclusions: Record<string, unknown> } | null}
 */
function parityData(data) {
  if (!isPlainObject(data)) return null;
  const keys = Object.keys(data).sort();
  if (keys.join(',') !== 'exclusions,opsPublic') return null;
  const { opsPublic, exclusions } = /** @type {Record<string, unknown>} */ (data);
  if (!Array.isArray(opsPublic) || !opsPublic.every((v) => typeof v === 'string')) return null;
  if (!isPlainObject(exclusions)) return null;
  return {
    opsPublic: /** @type {string[]} */ (opsPublic),
    exclusions: /** @type {Record<string, unknown>} */ (exclusions),
  };
}

/**
 * Semantic diff of parity-exclusions.json. `base === undefined` means the
 * file did not exist at the base (every head entry is new); `head ===
 * undefined` means the PR deleted it (a guarded change).
 *
 * @param {unknown} base parsed file at the merge base, or undefined
 * @param {unknown} head parsed file at the PR head, or undefined
 * @returns {{ added: string[], modified: string[], opsPublicAdded: string[], problems: string[] }}
 */
export function exclusionChanges(base, head) {
  const result = { added: [], modified: [], opsPublicAdded: [], problems: [] };
  if (head === undefined) {
    result.problems.push('parity-exclusions.json was deleted');
    return result;
  }
  const after = parityData(head);
  if (after === null) {
    result.problems.push('parity-exclusions.json at the PR head is not { opsPublic: string[], exclusions: {...} }');
    return result;
  }
  // A base without the file, or with the older flat shape, has nothing the
  // head can be a pure removal of.
  const before = parityData(base) ?? { opsPublic: [], exclusions: {} };
  for (const [key, value] of Object.entries(after.exclusions)) {
    if (!Object.prototype.hasOwnProperty.call(before.exclusions, key)) {
      result.added.push(key);
    } else if (JSON.stringify(before.exclusions[key]) !== JSON.stringify(value)) {
      result.modified.push(key);
    }
  }
  for (const key of after.opsPublic) {
    if (!before.opsPublic.includes(key)) result.opsPublicAdded.push(key);
  }
  result.added.sort();
  result.modified.sort();
  result.opsPublicAdded.sort();
  return result;
}

/**
 * @param {string[]} changedFiles paths changed between merge base and head
 * @param {{ base: unknown, head: unknown }} exclusions parsed exclusion file at both refs
 * @returns {{ needsApproval: boolean, reasons: string[] }}
 */
export function evaluateChanges(changedFiles, exclusions) {
  const reasons = [];
  for (const file of [...new Set(changedFiles)].sort()) {
    if (!isGuarded(file)) continue;
    if (file !== EXCLUSIONS_PATH) {
      reasons.push(`guarded file changed: ${file}`);
      continue;
    }
    const diff = exclusionChanges(exclusions.base, exclusions.head);
    for (const key of diff.added) reasons.push(`exclusion added: ${key}`);
    for (const key of diff.modified) reasons.push(`exclusion changed: ${key}`);
    for (const key of diff.opsPublicAdded) reasons.push(`opsPublic entry added: ${key}`);
    reasons.push(...diff.problems);
  }
  return { needsApproval: reasons.length > 0, reasons };
}
