export const EXCLUSIONS_PATH = 'apps/mcp/src/__tests__/parity-exclusions.json';

export const GUARDED_PATHS = [
  EXCLUSIONS_PATH,
  'apps/mcp/src/__tests__/web-api-parity.test.ts',
  'apps/mcp/src/__tests__/parity-verifier.test.ts',
  'apps/mcp/src/__tests__/parity/',
  'apps/web/app/api/__tests__/parity-exclusion-bearer.node.test.ts',
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

export function isGuarded(path) {
  return GUARDED_PATHS.some((guarded) =>
    guarded.endsWith('/') ? path.startsWith(guarded) : path === guarded,
  );
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parityData(data) {
  if (!isPlainObject(data)) return null;
  const keys = Object.keys(data).sort();
  if (keys.join(',') !== 'exclusions,opsPublic') return null;
  const { opsPublic, exclusions } = (data);
  if (!Array.isArray(opsPublic) || !opsPublic.every((v) => typeof v === 'string')) return null;
  if (!isPlainObject(exclusions)) return null;
  return {
    opsPublic: (opsPublic),
    exclusions: (exclusions),
  };
}

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
