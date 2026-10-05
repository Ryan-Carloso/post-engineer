#!/usr/bin/env node
//---------------
// evaluate.mjs — evaluates the three UI coverage gates and writes a
// findings JSON file. Exits 0 when every applicable gate passes (or no
// UI files changed), 1 otherwise.
//
// Usage:
//   node evaluate.mjs \
//     --ui-files "apps/web/app/a.tsx,apps/web/components/b.tsx" \
//     --cobertura apps/web/coverage-unit/cobertura-coverage.xml \
//     --lcov apps/web/coverage/lcov.info \
//     --mutation apps/web/reports/mutation/mutation.json \
//     --out /tmp/gate-findings.json
//
// Missing report files with UI changes are fail-closed ("missing"):
// without measurement there is no proof the threshold holds.
//---------------
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWebPath, parseCobertura, parseLcov, aggregateCoverage } from './coverage.mjs';
import { inCypressScope } from './cypress-scope.mjs';
import { mutationScore } from './mutation.mjs';
import { VITEST_MIN, CYPRESS_MIN, MUTATION_MIN } from './comment.mjs';

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1];
}

function readIfExists(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function webRelative(repoPath) {
  return repoPath.startsWith('apps/web/') ? repoPath.slice('apps/web/'.length) : repoPath;
}

function main() {
  const uiFiles = (arg('--ui-files') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = arg('--out');
  if (!out) {
    console.error('Usage: node evaluate.mjs --ui-files <csv> --cobertura <p> --lcov <p> --mutation <p> --out <p>');
    process.exit(2);
  }

  const findings = { uiFiles, vitest: null, cypress: null, mutation: null, pass: true };

  if (uiFiles.length === 0) {
    findings.vitest = { status: 'na', reason: 'no UI files changed' };
    findings.cypress = { status: 'na', reason: 'no UI files changed' };
    findings.mutation = { status: 'na', reason: 'no UI files changed' };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(findings, null, 2));
    console.log('No UI files changed — gates not applicable.');
    process.exit(0);
  }

  findings.vitest = evaluateVitest(arg('--cobertura'), uiFiles);
  findings.cypress = evaluateCypress(arg('--lcov'), arg('--cobertura'), uiFiles);
  findings.mutation = evaluateMutation(arg('--mutation'), uiFiles);

  // Fail closed: 'missing' (and any non-na non-pass status) fails the
  // overall verdict. Only an explicit pass or n/a is acceptable.
  findings.pass = [findings.vitest, findings.cypress, findings.mutation].every(
    (g) => g.status === 'pass' || g.status === 'na',
  );
  // The output directory may not exist (e.g. the artifact-download step is
  // skipped when no UI files changed); create it.
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(findings, null, 2));

  for (const [name, gate] of [['vitest', findings.vitest], ['cypress', findings.cypress], ['mutation', findings.mutation]]) {
    console.log(`${name}: ${describeGate(name, gate)}`);
  }
  process.exit(findings.pass ? 0 : 1);
}

//---------------
// Vitest gate: aggregate line coverage over ALL changed UI files.
//---------------
function evaluateVitest(coberturaPath, uiFiles) {
  const xml = coberturaPath ? readIfExists(coberturaPath) : null;
  if (xml === null) return { status: 'missing', reason: 'vitest cobertura report not found' };
  const perFile = new Map(
    [...parseCobertura(xml)].map(([name, v]) => [normalizeWebPath(name), v]),
  );
  const agg = aggregateCoverage(perFile, uiFiles);
  if (agg.total === 0) return { status: 'na', reason: 'no coverable lines in changed UI files' };
  const pct = (agg.covered * 100) / agg.total;
  return {
    covered: agg.covered,
    total: agg.total,
    status: pct >= VITEST_MIN ? 'pass' : 'fail',
  };
}

//---------------
// Cypress gate: aggregate line coverage over the changed UI files that
// fall within the cypress-coverage instrumentation scope. Files outside
// the scope are exempt (listed in the report).
//---------------
function evaluateCypress(lcovPath, coberturaPath, uiFiles) {
  const inScope = uiFiles.filter((f) => inCypressScope(webRelative(f)));
  const exempt = uiFiles.filter((f) => !inCypressScope(webRelative(f)));
  if (inScope.length === 0) {
    return { status: 'na', reason: 'no changed UI files in the cypress-coverage scope', inScope, exempt };
  }
  const lcov = lcovPath ? readIfExists(lcovPath) : null;
  if (lcov === null) return { status: 'missing', reason: 'cypress lcov report not found', inScope, exempt };
  const perFile = new Map(
    [...parseLcov(lcov)].map(([name, v]) => [normalizeWebPath(name), v]),
  );
  // Files in scope but never executed by E2E count as 0 covered; their
  // total lines come from the vitest report when available.
  const cobertura = coberturaPath ? readIfExists(coberturaPath) : null;
  const coberturaPerFile = cobertura
    ? new Map([...parseCobertura(cobertura)].map(([name, v]) => [normalizeWebPath(name), v]))
    : new Map();
  let covered = 0;
  let total = 0;
  const missing = [];
  for (const file of inScope) {
    const entry = perFile.get(file);
    if (entry && entry.total > 0) {
      covered += entry.covered;
      total += entry.total;
    } else {
      const fallback = coberturaPerFile.get(file);
      if (fallback && fallback.total > 0) {
        total += fallback.total;
      } else {
        missing.push(file);
      }
    }
  }
  if (total === 0) {
    return { status: 'na', reason: 'no coverable lines in in-scope UI files', inScope, exempt, missing };
  }
  const pct = (covered * 100) / total;
  return {
    covered,
    total,
    status: pct >= CYPRESS_MIN ? 'pass' : 'fail',
    inScope,
    exempt,
    missing,
  };
}
//---------------
// Mutation gate: Stryker score over the changed UI files.
//---------------
function evaluateMutation(mutationPath, uiFiles) {
  const raw = mutationPath ? readIfExists(mutationPath) : null;
  if (raw === null) return { status: 'missing', reason: 'Stryker mutation.json not found' };
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    return { status: 'missing', reason: 'Stryker mutation.json is not valid JSON' };
  }
  const score = mutationScore(report, uiFiles);
  if (score === null) return { status: 'na', reason: 'no mutants in changed UI files' };
  return { ...score, status: score.score >= MUTATION_MIN ? 'pass' : 'fail' };
}

function describeGate(name, gate) {
  if (gate.status === 'pass') return 'PASS';
  if (gate.status === 'fail') return 'FAIL';
  return `n/a (${gate.reason})`;
}

main();
