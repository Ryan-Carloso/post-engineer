export const ESLINT_CORRECTNESS_RULES = [
  'react-hooks/rules-of-hooks',
  'react-hooks/exhaustive-deps',
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-floating-promises',
  '@typescript-eslint/no-misused-promises',
  '@typescript-eslint/ban-ts-comment',
  '@typescript-eslint/no-unsafe-*',
  'no-undef',
  'eqeqeq',
  'no-eval',
  'no-implied-eval',
];

export const PY_CORRECTNESS_CODES = ['F821', 'F811', 'F823', 'F632', 'E711', 'E712', 'E721', 'B006', 'S*'];

function matchesRuleList(rule, list) {
  return list.some((entry) => (entry.endsWith('*') ? rule.startsWith(entry.slice(0, -1)) : rule === entry));
}

function verdict(bare, problem = null, detail = null) {
  return { bare, problem, detail };
}

const ESLINT_RULE = String.raw`[@\w][\w@/.:-]*`;
const ESLINT_RULES = new RegExp(String.raw`^\s+(${ESLINT_RULE}(?:\s*,\s*${ESLINT_RULE})*)`);

function lintDirective(body) {
  const m = /^((?:eslint|oxlint|stylelint)-(?:disable-next-line|disable-line|disable|enable))(?![\w-])/.exec(body);
  if (m === null) return null;
  const listed = ESLINT_RULES.exec(body.slice(m[1].length));
  const rules = listed === null ? [] : listed[1].split(',').map((r) => r.trim());
  const bare = rules.length === 0 ? m[1] : `${m[1]} ${rules.join(', ')}`;
  if (rules.length === 0 && !m[1].endsWith('-enable')) return verdict(bare, 'blanket', m[1]);
  const guilty = rules.filter((r) => matchesRuleList(r, ESLINT_CORRECTNESS_RULES));
  if (guilty.length > 0 && !m[1].endsWith('-enable')) return verdict(bare, 'correctness', guilty.join(', '));
  return verdict(bare);
}

function tsDirective(body) {
  const m = /^@ts-(expect-error|ignore|nocheck|check)(?![\w-])/.exec(body);
  if (m === null) return null;
  if (m[1] === 'ignore' || m[1] === 'nocheck') return verdict(m[0], 'blanket', m[0]);
  return verdict(m[0]);
}

const PREFIX_DIRECTIVES = [
  /^eslint-env\s+[\w-]+(?:\s*,\s*[\w-]+)*/,
  /^@(?:vitest|jest)-environment\s+[\w-]+/,
  /^@vite-ignore(?![\w-])/,
  /^@refresh reset(?![\w-])/,
  /^prettier-ignore(?![\w-])/,
  /^[@#]__PURE__(?![\w-])/,
  /^(?:istanbul|c8|v8) ignore(?:\s+(?:next|if|else|file|start|stop))?(?![\w-])/,
  /^Stryker (?:disable|restore)(?:\s+next-line)?\s+[\w,]+/,
  /^(?:codeql|lgtm)\[[^\]\s]+\]/,
];

function prefixDirective(body) {
  for (const re of PREFIX_DIRECTIVES) {
    const m = re.exec(body);
    if (m !== null) return verdict(m[0]);
  }
  return null;
}

const WEBPACK_VALUE = String.raw`(?:true|false|-?\d+|"[^"]*"|'[^']*'|\/(?:\\.|[^/\\\n])+\/[a-z]*|\[[^\]]*\])`;
const WEBPACK_PAIR = String.raw`webpack[A-Z]\w*\s*:\s*${WEBPACK_VALUE}`;
const WEBPACK_DIRECTIVE = new RegExp(
  String.raw`^\s*(?:\/\/|\/\*+)\s*${WEBPACK_PAIR}(?:\s*,\s*${WEBPACK_PAIR})*\s*,?\s*(?:\*\/)?\s*$`,
);
const TRIPLE_SLASH = /^\/\/\/\s*<(?:reference|amd-module|amd-dependency)\b[^>]*\/>\s*$/;
const LEGAL = /^\/\*!|@license\b|@preserve\b/;

const TYPE_REQUIRED = new Set(['param', 'arg', 'argument', 'returns', 'return', 'type', 'satisfies', 'property', 'prop', 'enum', 'this', 'typedef']);
const NAMED = new Set(['param', 'arg', 'argument', 'property', 'prop', 'typedef', 'callback']);
const TYPE_TAGS = new Set([...TYPE_REQUIRED, 'template', 'callback']);

function splitTagSegments(body) {
  const segments = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '@' && depth === 0 && (i === 0 || /\s/.test(body[i - 1]))) {
      segments.push(body.slice(from, i));
      from = i;
    }
  }
  segments.push(body.slice(from));
  return { segments, balanced: depth === 0 };
}

function balancedType(rest) {
  if (!rest.startsWith('{')) return null;
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '{') depth++;
    else if (rest[i] === '}' && --depth === 0) return rest.slice(0, i + 1);
  }
  return null;
}

function bareTag(segment) {
  const m = /^@(\w+)/.exec(segment);
  if (m === null || !TYPE_TAGS.has(m[1])) return null;
  let rest = segment.slice(m[0].length).replace(/^[ \t]+/, '');
  const parts = [m[0]];
  const type = balancedType(rest);
  if (type !== null) {
    parts.push(type);
    rest = rest.slice(type.length).replace(/^[ \t]+/, '');
  } else if (TYPE_REQUIRED.has(m[1]) && m[1] !== 'typedef') {
    return null;
  }
  const name = m[1] === 'template' ? /^[\w$]+(?:[ \t]*,[ \t]*[\w$]+)*/.exec(rest) : NAMED.has(m[1]) ? /^(?:\[[^\]]*\]|[\w$.]+)/.exec(rest) : null;
  if (name !== null) parts.push(name[0]);
  return parts.join(' ');
}

function jsdocBody(text) {
  return text
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line, i) => (i === 0 ? line.trim() : line.replace(/^\s*\* ?/, '').trimEnd()))
    .join('\n')
    .trim();
}

function jsTypeDirective(text) {
  if (!text.startsWith('/**')) return null;
  const { segments, balanced } = splitTagSegments(jsdocBody(text));
  if (!balanced) return null;
  const kept = segments.map(bareTag).filter((t) => t !== null);
  if (kept.length === 0) return null;
  if (!text.includes('\n')) return verdict(`/** ${kept.join(' ')} */`);
  const indent = /\n([ \t]*)\*/.exec(text)?.[1] ?? ' ';
  const lines = kept.flatMap((tag) => tag.split('\n'));
  return verdict(`/**\n${lines.map((l) => `${indent}*${l === '' ? '' : ` ${l}`}\n`).join('')}${indent}*/`);
}

function tsBody(text) {
  if (text.startsWith('//')) return { line: true, body: text.slice(2).trim() };
  const inner = text.replace(/^\/\*+/, '').replace(/\*\/$/, '');
  const body = inner
    .split('\n')
    .map((l) => l.replace(/^\s*\*?/, '').trim())
    .filter(Boolean)
    .join(' ');
  return { line: false, body };
}

function rewrap(text, line, bareBody, body) {
  if (bareBody === body) return text;
  if (line) return `// ${bareBody}`;
  return `${text.startsWith('/**') ? '/**' : '/*'} ${bareBody} */`;
}

export function classifyTs(text, file) {
  if (WEBPACK_DIRECTIVE.test(text) || TRIPLE_SLASH.test(text) || LEGAL.test(text)) return verdict(text);
  const { line, body } = tsBody(text);
  for (const parse of [lintDirective, tsDirective, prefixDirective]) {
    const found = parse(body);
    if (found !== null) return { ...found, bare: rewrap(text, line, found.bare, body) };
  }
  if (/\.(c|m)?jsx?$/.test(file)) return jsTypeDirective(text);
  return null;
}

const PY_CODES = String.raw`[A-Z]+[0-9]+(?:\s*,\s*[A-Z]+[0-9]+)*`;
const PY_DIRECTIVES = [
  { re: new RegExp(String.raw`^#\s*(?:ruff:\s*)?noqa(?::\s*(${PY_CODES}))?(?![\w-])`), codes: true },
  { re: /^#\s*type:\s*ignore(\[[\w\-, ]+\])?(?![\w-])/, scoped: true },
  { re: /^#\s*pyright:\s*ignore(\[[\w, ]+\])?(?![\w-])/, scoped: true },
  { re: /^#\s*pyright:\s*(?:basic|standard|strict)(?![\w-])/ },
  { re: /^#\s*pragma:\s*no (?:cover|branch)(?![\w-])/ },
  { re: /^#\s*fmt:\s*(?:off|on|skip)(?![\w-])/ },
  { re: /^#\s*isort:\s*(?:skip_file|skip|off|on)(?![\w-])/ },
  { re: /^#\s*nosec(?![\w-])/, problem: 'correctness', detail: 'nosec' },
  { re: /^#\s*(?:codeql|lgtm)\[[^\]\s]+\]/ },
];

function pySegment(text) {
  for (const { re, codes, scoped, problem, detail } of PY_DIRECTIVES) {
    const m = re.exec(text);
    if (m === null) continue;
    if (problem !== undefined) return { ...verdict(m[0], problem, detail), rest: text.slice(m[0].length) };
    if ((codes || scoped) && m[1] === undefined) return { ...verdict(m[0], 'blanket', m[0].replace(/^#\s*/, '')), rest: text.slice(m[0].length) };
    if (codes) {
      const guilty = m[1].split(',').map((c) => c.trim()).filter((c) => matchesRuleList(c, PY_CORRECTNESS_CODES));
      if (guilty.length > 0) return { ...verdict(m[0], 'correctness', guilty.join(', ')), rest: text.slice(m[0].length) };
    }
    return { ...verdict(m[0]), rest: text.slice(m[0].length) };
  }
  return null;
}

export function classifyPy(text, start) {
  if ((start === 0 && text.startsWith('#!')) || /^#.*-\*-\s*coding[:=]/.test(text)) return verdict(text);
  const first = pySegment(text);
  if (first === null) return null;
  const chained = /^(\s+)(#.*)$/.exec(first.rest);
  const next = chained === null ? null : classifyPy(chained[2], -1);
  if (next === null) return verdict(first.bare, first.problem, first.detail);
  return verdict(`${first.bare}${chained[1]}${next.bare}`, first.problem ?? next.problem, first.detail ?? next.detail);
}
