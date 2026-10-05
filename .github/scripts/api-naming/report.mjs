/**
 * Reporting: GitHub Actions annotations and the PR comment body.
 *
 * Annotation format (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands):
 *   ::error file={path},line={n}::{message}
 *   ::warning file={path},line={n}::{message}
 * The PR comment carries the marker <!-- api-naming-lint --> so the
 * workflow can update it idempotently instead of spamming new comments.
 */

export const COMMENT_MARKER = '<!-- api-naming-lint -->';

function escapeAnnotation(text) {
  return String(text).replace(/%/g, '%25').replace(/\n/g, '%0A').replace(/\r/g, '%0D');
}

/**
 * @param {Array<{ file: string, line: number, name: string, severity: 'error' | 'warn', reason: string, alternatives: string[], source: string }>} findings
 * @param {string[]} warnings
 * @returns {string}
 */
export function formatAnnotations(findings, warnings) {
  const lines = [];
  for (const f of findings) {
    const kind = f.severity === 'error' ? 'error' : 'warning';
    const where = f.line > 0 ? ` file=${f.file},line=${f.line}` : ` file=${f.file}`;
    const alternatives =
      f.alternatives.length > 0 ? ` Suggested alternatives: ${f.alternatives.join(', ')}.` : '';
    const message = `API naming (${f.source}): Field "${f.name}" — ${f.reason}${alternatives}`;
    lines.push(`::${kind}${where}::${escapeAnnotation(message)}`);
  }
  for (const w of warnings) {
    lines.push(`::warning::${escapeAnnotation(w)}`);
  }
  return lines.join('\n');
}

/**
 * @param {Array<{ file: string, line: number, name: string, severity: 'error' | 'warn', reason: string, alternatives: string[], source: string, renamedFrom: string | null }>} findings
 * @param {string[]} warnings
 * @param {{ headSha: string }} meta
 * @returns {string}
 */
export function buildCommentBody(findings, warnings, meta) {
  const parts = [COMMENT_MARKER, ''];
  if (findings.length === 0) {
    parts.push('✅ No API naming issues found in this PR.');
    parts.push('');
    parts.push(`_Checked against \`${meta.headSha.slice(0, 7)}\`; only newly added contract names are linted._`);
    return parts.join('\n');
  }
  for (const f of findings) {
    const icon = f.severity === 'error' ? '❌' : '⚠️';
    const label = f.severity === 'error' ? 'API naming issue' : 'API naming warning';
    parts.push(`${icon} ${label}`);
    parts.push(`Field: ${f.name}`);
    parts.push(`Location: \`${f.file}:${f.line}\` (via ${f.source})`);
    if (f.renamedFrom) parts.push(`Note: renamed from \`${f.renamedFrom}\` in this PR.`);
    parts.push(`Problem: ${f.reason}`);
    if (f.alternatives.length > 0) {
      parts.push('Suggested alternatives:');
      for (const a of f.alternatives) parts.push(`* ${a}`);
    }
    parts.push('');
  }
  if (warnings.length > 0) {
    parts.push('**Run warnings** (did not fail the check):');
    for (const w of warnings) parts.push(`- ${w}`);
    parts.push('');
  }
  parts.push('_Only newly added contract names are linted; existing names are grandfathered._');
  parts.push('_See `docs/API_NAMING_LINT.md` for the denylist and how to read this._');
  return parts.join('\n');
}
