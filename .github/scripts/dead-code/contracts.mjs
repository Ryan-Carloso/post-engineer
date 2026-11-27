#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from '../comments/scan.mjs';

export const CONTRACTS_DIR = 'shared/contracts/';
export const CONSUMER_ROOTS = ['apps/web/', 'apps/mcp/', 'scripts/', '.github/scripts/', CONTRACTS_DIR];
export const SUBSET_HOME = 'shared/contracts/providers.ts';

const SOURCE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

function hasExportModifier(ts, node) {
  return (ts.getModifiers?.(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function exportedStatements(file, text) {
  const ts = loadTypeScript();
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  for (const statement of source.statements) {
    if (!hasExportModifier(ts, statement)) continue;
    const span = { start: statement.getStart(source), end: statement.getEnd() };
    if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList.declarations;
      for (const declaration of declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const subset = file === SUBSET_HOME && isArrayValue(ts, declaration.initializer);
        found.push({ name: declaration.name.text, span, single: declarations.length === 1, subset });
      }
      continue;
    }
    if (statement.name !== undefined && ts.isIdentifier(statement.name)) found.push({ name: statement.name.text, span, single: true, subset: false });
  }
  return found;
}

export function exportedNames(file, text) {
  return exportedStatements(file, text).map((entry) => entry.name);
}

function identifierCounts(text) {
  const counts = new Map();
  for (const match of text.matchAll(IDENTIFIER)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  return counts;
}

function isArrayValue(ts, initializer) {
  let value = initializer;
  while (value !== undefined && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) value = value.expression;
  if (value === undefined) return false;
  if (ts.isArrayLiteralExpression(value)) return true;
  return ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === 'filter';
}

function usedOutsideSpan(text, name, span) {
  const outside = text.slice(0, span.start) + text.slice(span.end);
  return (identifierCounts(outside).get(name) ?? 0) > 0;
}

export function findDeadContractExports(files) {
  const contracts = Object.keys(files).filter((file) => file.startsWith(CONTRACTS_DIR) && file.endsWith('.ts'));
  const counts = new Map(Object.entries(files).map(([file, text]) => [file, identifierCounts(text)]));
  const findings = [];
  for (const file of contracts.sort()) {
    const text = files[file];
    for (const { name, span, subset } of exportedStatements(file, text)) {
      const usedElsewhere = Object.keys(files).some((other) => other !== file && (counts.get(other).get(name) ?? 0) > 0);
      if (usedElsewhere) continue;
      const usedInFile = usedOutsideSpan(text, name, span);
      if (usedInFile && subset) continue;
      findings.push({ file, name, kind: usedInFile ? 'needless-export' : 'unused' });
    }
  }
  return findings;
}

export function fixContractText(file, text, findings) {
  const byName = new Map(findings.filter((finding) => finding.file === file).map((finding) => [finding.name, finding.kind]));
  const edits = exportedStatements(file, text)
    .filter((entry) => entry.single && byName.has(entry.name))
    .map((entry) => ({ ...entry, kind: byName.get(entry.name) }))
    .sort((a, b) => b.span.start - a.span.start);
  let out = text;
  for (const edit of edits) {
    if (edit.kind === 'unused') {
      const before = out.slice(0, edit.span.start).replace(/\n*$/, '\n');
      const after = out.slice(edit.span.end).replace(/^\n+/, '\n');
      out = before + after.replace(/^\n(?=\n)/, '');
      continue;
    }
    out = out.slice(0, edit.span.start) + out.slice(edit.span.start).replace(/^export /, '');
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

export function describeFinding(finding) {
  if (finding.kind === 'unused') return `${finding.file}: ${finding.name} is exported but used nowhere — delete it`;
  return `${finding.file}: ${finding.name} is used only inside its own file — drop the export`;
}

function trackedSources(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--', ...CONSUMER_ROOTS], { cwd: root, encoding: 'utf8' });
  return listed.split('\0').filter((file) => SOURCE.test(file) && !file.includes('/node_modules/'));
}

export function run(root) {
  const files = Object.fromEntries(trackedSources(root).map((file) => [file, readFileSync(path.join(root, file), 'utf8')]));
  return findDeadContractExports(files);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  let findings = run(root);
  if (process.argv.includes('--fix')) {
    for (const file of new Set(findings.map((finding) => finding.file))) {
      const target = path.join(root, file);
      writeFileSync(target, fixContractText(file, readFileSync(target, 'utf8'), findings));
    }
    findings = run(root);
  }
  for (const finding of findings) console.error(describeFinding(finding));
  if (findings.length > 0) {
    console.error(`\n${findings.length} dead shared contract export(s). Every export in ${CONTRACTS_DIR} must be used by apps/web, apps/mcp or another contract.`);
    process.exit(1);
  }
  console.log('shared contracts: every export is used.');
}
