import { loadTypeScript, scriptKind } from './scan.mjs';

export function jsxTextValue(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let value = '';
  lines.forEach((line, i) => {
    let trimmed = line.replace(/\t/g, ' ');
    if (i !== 0) trimmed = trimmed.replace(/^[ ]+/, '');
    if (i !== lines.length - 1) trimmed = trimmed.replace(/[ ]+$/, '');
    if (trimmed !== '') {
      if (i !== lastNonEmpty) trimmed += ' ';
      value += trimmed;
    }
  });
  return value;
}

export function codeTokens(text, file) {
  const ts = loadTypeScript();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const tokens = [];
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (node.kind === ts.SyntaxKind.JsxExpression && node.expression === undefined) return;
    if (node.kind === ts.SyntaxKind.JsxText) {
      const value = jsxTextValue(node.text);
      if (value !== '') tokens.push(`${node.kind}:${value}`);
      return;
    }
    const children = node.getChildren(sf);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push(`${node.kind}:${node.getText(sf)}`);
      return;
    }
    tokens.push(`(${node.kind}`);
    for (const child of children) visit(child);
    tokens.push(')');
  };
  visit(sf);
  return tokens;
}

export function sameCode(baseText, headText, file) {
  const base = codeTokens(baseText, file);
  const head = codeTokens(headText, file);
  return base.length === head.length && base.every((token, i) => token === head[i]);
}
