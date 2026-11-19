//---------------
// scan-ts — provider groups in a TypeScript/JavaScript source, read from
// the syntax tree (the TypeScript compiler API, resolved from apps/web).
// See rules.mjs for what each group kind means.
//---------------

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mentionOf, mentionsInText } from './mentions.mjs';

const require = createRequire(fileURLToPath(new URL('../../../apps/web/package.json', import.meta.url)));
const ts = require('typescript');

const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const LOGICAL = new Set([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken]);

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts') || file.endsWith('.mts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** @returns {{ file: string, line: number, kind: string, providers: string[] }[]} */
export function scanTs(file, text, index) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const groups = [];
  const literal = (node) => (node !== undefined && (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) ? mentionOf(index, node.text) : null);
  const stringLiteral = (node) => (node !== undefined && ts.isStringLiteralLike(node) ? mentionOf(index, node.text) : null);
  const keyOf = (name) => {
    if (name === undefined) return null;
    if (ts.isComputedPropertyName(name)) return stringLiteral(name.expression);
    return literal(name);
  };
  // The providers a condition compares against: `x === 'a' || x === 'b'`.
  const compared = (node) => {
    if (ts.isParenthesizedExpression(node)) return compared(node.expression);
    if (ts.isPrefixUnaryExpression(node)) return compared(node.operand);
    if (ts.isBinaryExpression(node)) {
      if (LOGICAL.has(node.operatorToken.kind)) return [...compared(node.left), ...compared(node.right)];
      if (EQUALITY.has(node.operatorToken.kind)) return [stringLiteral(node.left), stringLiteral(node.right)].filter((name) => name !== null);
    }
    return [];
  };
  // The subject each comparison tests, as source text (`account.provider`,
  // `p`). Sibling `if` statements that compare the same subject against a
  // different provider form one chain: consecutive `if (p === 'a') ...` /
  // `if (p === 'b') ...` runs where each statement alone names one provider
  // and the combined run is per-provider dispatch with a silent fall-through.
  const comparedWithSubject = (node) => {
    if (ts.isParenthesizedExpression(node)) return comparedWithSubject(node.expression);
    if (ts.isPrefixUnaryExpression(node)) return comparedWithSubject(node.operand);
    if (ts.isBinaryExpression(node)) {
      if (LOGICAL.has(node.operatorToken.kind)) return [...comparedWithSubject(node.left), ...comparedWithSubject(node.right)];
      if (EQUALITY.has(node.operatorToken.kind)) {
        const left = stringLiteral(node.left);
        const right = stringLiteral(node.right);
        if (left !== null) return [{ subject: node.right.getText(source), provider: left }];
        if (right !== null) return [{ subject: node.left.getText(source), provider: right }];
      }
    }
    return [];
  };
  const report = (node, kind, names) => {
    const providers = names.filter((name) => name !== null);
    if (new Set(providers).size < 2) return;
    groups.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind, providers });
  };
  // Runs of consecutive `if` statements in one statement list that spread
  // the dispatch across siblings instead of else-if links. A statement that
  // returns on every branch still falls a new provider through to whatever
  // follows the run. Each statement names one provider, so without this run
  // grouping every sibling would be dropped by the per-node minimum.
  const reportSiblingRuns = (statements) => {
    // Every provider a statement compares against through its whole else-if
    // expansion, so a head else-chain and its sibling continuations group as
    // one run instead of splitting across the two detectors.
    const namesOf = (statement) => {
      const names = [];
      for (let current = statement; current !== undefined && ts.isIfStatement(current); current = current.elseStatement) names.push(...compared(current.expression));
      return names;
    };
    let run = [];
    let subject = null;
    const flush = () => {
      if (run.length > 1) report(run[0], 'chain', run.flatMap(namesOf));
      run = [];
      subject = null;
    };
    for (const statement of statements) {
      if (!ts.isIfStatement(statement)) {
        flush();
        continue;
      }
      const pairs = comparedWithSubject(statement.expression);
      const singleSubject = pairs.length > 0 && pairs.every((pair) => pair.subject === pairs[0].subject);
      if (!singleSubject || (subject !== null && pairs[0].subject !== subject)) flush();
      if (!singleSubject) continue;
      if (subject === null) subject = pairs[0].subject;
      run.push(statement);
    }
    flush();
  };

  const visit = (node) => {
    if (ts.isBlock(node) || ts.isSourceFile(node)) reportSiblingRuns(node.statements);
    if (ts.isArrayLiteralExpression(node)) {
      report(node, 'list', node.elements.map(stringLiteral));
    } else if (ts.isUnionTypeNode(node)) {
      report(node, 'list', node.types.map((type) => (ts.isLiteralTypeNode(type) ? stringLiteral(type.literal) : null)));
    } else if (ts.isObjectLiteralExpression(node)) {
      report(node, 'map', node.properties.map((property) => keyOf(property.name)));
    } else if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
      report(node, 'map', node.members.map((member) => keyOf(member.name)));
    } else if (ts.isSwitchStatement(node)) {
      report(node, 'chain', node.caseBlock.clauses.map((clause) => (ts.isCaseClause(clause) ? stringLiteral(clause.expression) : null)));
    } else if (ts.isConditionalExpression(node) && !(ts.isConditionalExpression(node.parent) && node.parent.whenFalse === node)) {
      const names = [];
      for (let current = node; ts.isConditionalExpression(current); current = current.whenFalse) names.push(...compared(current.condition));
      report(node, 'chain', names);
    } else if (ts.isIfStatement(node) && !(ts.isIfStatement(node.parent) && node.parent.elseStatement === node)) {
      const names = [];
      for (let current = node; current !== undefined && ts.isIfStatement(current); current = current.elseStatement) names.push(...compared(current.expression));
      report(node, 'chain', names);
    } else if (
      ts.isBinaryExpression(node) &&
      LOGICAL.has(node.operatorToken.kind) &&
      !(ts.isBinaryExpression(node.parent) && LOGICAL.has(node.parent.operatorToken.kind)) &&
      !(ts.isParenthesizedExpression(node.parent))
    ) {
      report(node, 'chain', compared(node));
    } else if (ts.isStringLiteralLike(node)) {
      report(node, 'text', mentionsInText(index, node.text));
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
      report(node, 'text', mentionsInText(index, parts));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return groups;
}
