/**
 * Diff-based contract name extraction.
 *
 * Only names ADDED in the diff are candidates — existing names are
 * grandfathered, so the lint never asks for renames of shipped fields.
 * Extraction is scoped to the `api_paths` globs from the versioned config.
 */

const TS_KEY_RE = /(?:^|[{,])\s*["']?([A-Za-z_$][\w$]*)["']?\s*:/g;
// `default:` / `case x:` in switch statements are not field declarations.
const TS_KEYWORDS = new Set(['default', 'case']);

const PY_FIELD_RE = /^\s*([A-Za-z_]\w*)\s*:/;
const PY_CLASS_RE = /^\s*class\s+(\w+)/;
const PY_ALIAS_RE = /(?<!\w)alias\s*=\s*["']([^"']+)["']/;
const PY_SER_ALIAS_RE = /serialization_alias\s*=\s*["']([^"']+)["']/;
// Python keywords that can syntactically match `name:` but are not fields.
const PY_KEYWORDS = new Set([
  'else',
  'try',
  'finally',
  'if',
  'elif',
  'for',
  'while',
  'with',
  'def',
  'class',
  'return',
  'import',
  'from',
]);

/**
 * Minimal glob matcher: `*` stays inside a segment, `**` crosses segments.
 * @param {string} filePath
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchesGlob(filePath, pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // Collapse `**/` to an optional any-depth prefix.
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else {
      re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`).test(filePath);
}

function isTs(path) {
  return path.endsWith('.ts') || path.endsWith('.tsx');
}

function isPy(path) {
  return path.endsWith('.py');
}

/**
 * Destructuring patterns bind LOCAL variables, never contract names:
 *   const { data: existingSchedule } = await supabase.from('schedules').select();
 *   function build({ data }: { data: string }) { ... }
 *   const f = ({ data }) => ...;
 * Single-line patterns only — multi-line destructuring in route files is rare
 * enough that the LLM layer (with full context) is the backstop for it.
 */
const DESTRUCTURING_PATTERNS = [
  /(^|[\s(;{,])(const|let|var)\s*\{/, // const { data: x } = ...; for (const { x } of ...)
  /\(\s*\{[^}]*\}\s*:/, // function f({ data }: Opts)
  /\(\s*\{[^}]*\}\)\s*=>/, // ({ data }) => ...
];

function isDestructuringLine(line) {
  return DESTRUCTURING_PATTERNS.some((re) => re.test(line));
}

/**
 * Extract candidate field names from one added line.
 * @param {string} line line content without the diff `+` prefix
 * @param {boolean} inPyClass whether the line sits inside a Python class body
 * @returns {string[]} candidate names
 */
function extractNamesFromLine(line, filePath, inPyClass) {
  const names = [];
  if (isTs(filePath)) {
    if (isDestructuringLine(line)) return names;
    TS_KEY_RE.lastIndex = 0;
    let m;
    while ((m = TS_KEY_RE.exec(line)) !== null) {
      if (!TS_KEYWORDS.has(m[1])) names.push(m[1]);
    }
  } else if (isPy(filePath) && inPyClass) {
    const m = PY_FIELD_RE.exec(line);
    if (m && !PY_KEYWORDS.has(m[1])) {
      names.push(m[1]);
      const serAlias = PY_SER_ALIAS_RE.exec(line);
      const alias = PY_ALIAS_RE.exec(line);
      // The exposed wire name is what API consumers see.
      if (serAlias) names.push(serAlias[1]);
      else if (alias) names.push(alias[1]);
    }
  }
  return names;
}

/**
 * @param {string} diffText unified diff (git diff format)
 * @param {{ apiPaths: string[] }} config
 * @returns {{
 *   candidates: Array<{ file: string, line: number, name: string, context: string, renamedFrom: string | null }>,
 *   newEndpoints: Array<{ file: string, kind: 'endpoint' }>,
 * }}
 */
export function extractFromDiff(diffText, config) {
  const candidates = [];
  const newEndpoints = [];
  if (!diffText.trim()) return { candidates, newEndpoints };

  const fileDiffs = diffText.split(/^diff --git /m).slice(1);
  for (const fileDiff of fileDiffs) {
    const plusPlus = /^\+{3} (.+)$/m.exec(fileDiff);
    if (!plusPlus) continue;
    let newPath = plusPlus[1].trim();
    if (newPath.startsWith('b/')) newPath = newPath.slice(2);
    if (newPath === '/dev/null') continue;

    const inScope = config.apiPaths.some((p) => matchesGlob(newPath, p));
    if (!inScope) continue;

    const isNewFile = /^new file mode/m.test(fileDiff);
    if (isNewFile) newEndpoints.push({ file: newPath, kind: 'endpoint' });

    // Walk hunks, tracking new-file line numbers and Python class scope.
    const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm;
    let hunk;
    while ((hunk = hunkRe.exec(fileDiff)) !== null) {
      let newLine = Number(hunk[1]);
      const bodyStart = hunk.index + hunk[0].length;
      const nextHunk = fileDiff.indexOf('\n@@ ', bodyStart);
      const body = fileDiff.slice(bodyStart, nextHunk === -1 ? undefined : nextHunk);
      /** @type {Array<{ kind: 'add' | 'del' | 'ctx', text: string, newLine: number | null }>} */
      const rows = [];
      for (const raw of body.split('\n')) {
        if (raw.startsWith('+++') || raw.startsWith('---')) continue;
        if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
        const kind = raw.startsWith('+') ? 'add' : raw.startsWith('-') ? 'del' : 'ctx';
        const text = raw.slice(1);
        const rowLine = kind === 'del' ? null : newLine;
        if (kind !== 'del') newLine++;
        rows.push({ kind, text, newLine: rowLine });
      }

      // Walk rows tracking Python class scope (context lines included, since
      // the `class` declaration is usually unchanged); extraction still only
      // reads added lines.
      const scopeStack = [];
      const addedKeys = [];
      const removedKeys = [];
      for (const row of rows) {
        if (isPy(newPath)) {
          const indent = row.text.match(/^ */)?.[0].length ?? 0;
          if (row.text.trim() !== '') {
            while (scopeStack.length > 0 && scopeStack[scopeStack.length - 1] >= indent) {
              scopeStack.pop();
            }
            if (PY_CLASS_RE.test(row.text)) scopeStack.push(indent);
          }
        }
        if (row.kind === 'add') {
          for (const name of extractNamesFromLine(row.text, newPath, scopeStack.length > 0)) {
            addedKeys.push({ name, row });
          }
        } else if (row.kind === 'del') {
          for (const name of extractNamesFromLine(row.text, newPath, scopeStack.length > 0)) {
            removedKeys.push(name);
          }
        }
      }

      // Rename heuristic: exactly one removed key and one added key in the
      // same hunk means the field was renamed.
      const renamedFrom =
        removedKeys.length === 1 && addedKeys.length === 1 && removedKeys[0] !== addedKeys[0].name
          ? removedKeys[0]
          : null;

      for (const { name, row } of addedKeys) {
        const idx = rows.indexOf(row);
        const window = rows.slice(Math.max(0, idx - 3), idx + 4);
        candidates.push({
          file: newPath,
          line: row.newLine ?? 0,
          name,
          context: window.map((r) => r.text).join('\n'),
          renamedFrom,
        });
      }
    }
  }
  return { candidates, newEndpoints };
}
