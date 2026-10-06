//---------------
// PR comment rendering for the UI coverage gates.
//
// Findings shape:
// {
//   uiFiles: string[],
//   vitest:   { covered, total, status: 'pass'|'fail' } | { status: 'na'|'missing', reason },
//   cypress:  { covered, total, status, inScope: string[], exempt: string[] } | { status: 'na'|'missing', reason },
//   mutation: { score, killed, survived, timeout, total, status } | { status: 'na'|'missing', reason },
//   pass: boolean,
// }
//---------------

export const COMMENT_MARKER = '<!-- ui-coverage-gates -->';

export const VITEST_MIN = 80;
export const CYPRESS_MIN = 80;
export const MUTATION_MIN = 60;

export function renderComment(findings) {
  const lines = [COMMENT_MARKER, '## UI coverage gates', ''];
  lines.push(
    `Changed UI files: ${findings.uiFiles.length} · ` +
      `thresholds: vitest ≥ ${VITEST_MIN}%, cypress ≥ ${CYPRESS_MIN}%, mutation ≥ ${MUTATION_MIN}%`,
  );
  lines.push('');
  lines.push('| Gate | Coverage | Threshold | Status |');
  lines.push('| ---- | -------- | --------- | ------ |');
  lines.push(vitestRow(findings.vitest));
  lines.push(cypressRow(findings.cypress));
  lines.push(mutationRow(findings.mutation));
  lines.push('');
  const notes = renderNotes(findings);
  if (notes.length > 0) {
    lines.push(...notes);
    lines.push('');
  }
  lines.push(
    findings.pass
      ? '✅ All applicable gates pass.'
      : '❌ One or more gates failed — see the rows above.',
  );
  return lines.join('\n');
}

function pct(covered, total) {
  return `${((covered * 100) / total).toFixed(1)}%`;
}

function statusIcon(status) {
  if (status === 'pass') return '✅ pass';
  if (status === 'fail') return '❌ fail';
  return '➖ n/a';
}

function vitestRow(gate) {
  if (gate.status === 'na' || gate.status === 'missing') {
    return `| vitest (unit) | n/a — ${gate.reason} | ≥ ${VITEST_MIN}% | ${statusIcon(gate.status === 'missing' ? 'fail' : 'na')} |`;
  }
  return `| vitest (unit) | ${pct(gate.covered, gate.total)} (${gate.covered}/${gate.total} lines) | ≥ ${VITEST_MIN}% | ${statusIcon(gate.status)} |`;
}

function cypressRow(gate) {
  if (gate.status === 'na' || gate.status === 'missing') {
    return `| cypress (e2e) | n/a — ${gate.reason} | ≥ ${CYPRESS_MIN}% | ${statusIcon(gate.status === 'missing' ? 'fail' : 'na')} |`;
  }
  return `| cypress (e2e) | ${pct(gate.covered, gate.total)} (${gate.covered}/${gate.total} lines) | ≥ ${CYPRESS_MIN}% | ${statusIcon(gate.status)} |`;
}

function mutationRow(gate) {
  if (gate.status === 'na' || gate.status === 'missing') {
    return `| mutation (stryker) | n/a — ${gate.reason} | ≥ ${MUTATION_MIN}% | ${statusIcon(gate.status === 'missing' ? 'fail' : 'na')} |`;
  }
  return `| mutation (stryker) | ${gate.score}% (${gate.killed + gate.timeout}/${gate.total} mutants killed) | ≥ ${MUTATION_MIN}% | ${statusIcon(gate.status)} |`;
}

function renderNotes(findings) {
  const notes = [];
  const cypress = findings.cypress;
  if (cypress && cypress.status !== 'na' && cypress.status !== 'missing' && cypress.exempt.length > 0) {
    notes.push(
      `Cypress-exempt files (${cypress.exempt.length}, outside the cypress-coverage instrumentation scope):`,
    );
    for (const file of cypress.exempt) notes.push(`- \`${file}\``);
  }
  return notes;
}

//---------------
// CLI: node comment.mjs --findings <path-to-findings.json>
//   prints the rendered markdown to stdout (used by the workflow to
//   post/refresh the single PR comment).
//---------------
import fs from 'node:fs';

const invokedAsCli = process.argv[1] && process.argv[1].endsWith('comment.mjs');
if (invokedAsCli) {
  const idx = process.argv.indexOf('--findings');
  const findingsPath = idx === -1 ? null : process.argv[idx + 1];
  if (!findingsPath) {
    console.error('Usage: node comment.mjs --findings <path>');
    process.exit(2);
  }
  process.stdout.write(renderComment(JSON.parse(fs.readFileSync(findingsPath, 'utf8'))));
}
