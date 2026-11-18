import { loadTypeScript, scriptKind } from './scan.mjs';

export function codeTokens(text, file) {
  const ts = loadTypeScript();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const tokens = [];
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (node.kind === ts.SyntaxKind.JsxExpression && node.expression === undefined) return;
    if (node.kind === ts.SyntaxKind.JsxText) {
      const collapsed = node.text.replace(/\s+/g, ' ').trim();
      if (collapsed !== '') tokens.push(`${node.kind}:${collapsed}`);
      return;
    }
    const children = node.getChildren(sf);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push(`${node.kind}:${node.getText(sf)}`);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sf);
  return tokens;
}

export function sameCode(baseText, headText, file) {
  const base = codeTokens(baseText, file);
  const head = codeTokens(headText, file);
  return base.length === head.length && base.every((token, i) => token === head[i]);
}
