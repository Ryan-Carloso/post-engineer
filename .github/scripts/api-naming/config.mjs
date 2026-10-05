/**
 * Config loader for the API naming lint.
 *
 * Parses a restricted YAML subset (documented in .github/api-naming.yml):
 * top-level scalar keys, lists of scalars, lists of one-level maps, and
 * one level of nested maps. Kept dependency-free on purpose: the CI job
 * runs this with plain `node`, no install step.
 */

import fs from 'node:fs';

/**
 * @param {string} raw
 * @returns {string} line with comments stripped (respects quotes)
 */
function stripComment(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/**
 * @param {string} value
 * @returns {string | number | boolean | null}
 */
function parseScalar(value) {
  const v = value.trim();
  if (v === '') return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    // Flow-style list of scalars: ["a", 'b', 3]
    const items = [];
    let cur = '';
    let inS = false;
    let inD = false;
    for (const ch of v.slice(1, -1)) {
      if (ch === "'" && !inD) inS = !inS;
      else if (ch === '"' && !inS) inD = !inD;
      if (ch === ',' && !inS && !inD) {
        items.push(parseScalar(cur));
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim() !== '' || items.length > 0) items.push(parseScalar(cur));
    return items;
  }
  return v;
}

/**
 * Split `key: value` on the first colon. Returns [key, rest].
 * @param {string} text
 * @returns {[string, string]}
 */
function splitKeyValue(text) {
  const idx = text.indexOf(':');
  if (idx === -1) throw new Error(`Invalid config line (expected "key: value"): ${text}`);
  return [text.slice(0, idx).trim(), text.slice(idx + 1).trim()];
}

/**
 * Parse the restricted YAML subset into plain JS values.
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseYamlSubset(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const stripped = stripComment(raw);
    if (stripped.trim() === '') continue;
    lines.push({ indent: stripped.match(/^ */)?.[0].length ?? 0, text: stripped.trim() });
  }
  let pos = 0;

  function parseBlock(indent) {
    const first = lines[pos];
    if (!first || first.indent !== indent) return null;
    if (first.text.startsWith('- ')) {
      const arr = [];
      while (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('- ')) {
        const itemText = lines[pos].text.slice(2).trim();
        pos++;
        const looksLikeMap =
          itemText.includes(':') &&
          !(
            (itemText.startsWith('"') && itemText.endsWith('"')) ||
            (itemText.startsWith("'") && itemText.endsWith("'"))
          );
        if (itemText === '') {
          // `-` followed by a nested block on deeper lines.
          arr.push(parseBlock(lines[pos] ? lines[pos].indent : indent + 1));
        } else if (looksLikeMap) {
          const obj = {};
          const [k, v] = splitKeyValue(itemText);
          if (v === '') {
            obj[k] = parseBlock(lines[pos] ? lines[pos].indent : indent + 1);
          } else {
            obj[k] = parseScalar(v);
          }
          while (
            pos < lines.length &&
            lines[pos].indent > indent &&
            !lines[pos].text.startsWith('- ')
          ) {
            const [k2, v2] = splitKeyValue(lines[pos].text);
            pos++;
            obj[k2] = v2 === '' ? parseBlock(lines[pos] ? lines[pos].indent : indent + 1) : parseScalar(v2);
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(itemText));
        }
      }
      return arr;
    }
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith('- ')) {
      const [k, v] = splitKeyValue(lines[pos].text);
      pos++;
      if (v === '') {
        const next = lines[pos];
        obj[k] = next && next.indent > indent ? parseBlock(next.indent) : null;
      } else {
        obj[k] = parseScalar(v);
      }
    }
    return obj;
  }

  return parseBlock(0) ?? {};
}

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Load and validate the versioned api-naming.yml config.
 *
 * The config surface is closed: unknown top-level keys are rejected so the
 * exceptions mechanism cannot be reintroduced through the config file.
 * @param {string} filePath
 * @returns {{
 *   apiPaths: string[],
 *   denylist: Record<string, { severity: 'error' | 'warn', reason: string }>,
 *   allowlist: string[],
 *   llm: { enabled: boolean, baseUrl: string, model: string, maxNames: number, timeoutMs: number },
 * }}
 */
export function loadConfig(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`API naming config not found: ${filePath} (${err.message})`);
  }
  const raw = parseYamlSubset(text);
  if (!isRecord(raw)) throw new Error(`Invalid API naming config: top level must be a map (${filePath})`);

  const KNOWN_KEYS = new Set(['api_paths', 'denylist', 'allowlist', 'llm']);
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(
        `Invalid API naming config: unknown top-level key "${key}" (${filePath}). ` +
          `Exceptions are not supported — rename the identifier instead of excepting it.`,
      );
    }
  }

  const apiPaths = raw.api_paths;
  if (!Array.isArray(apiPaths) || apiPaths.length === 0 || !apiPaths.every((p) => typeof p === 'string')) {
    throw new Error(`Invalid API naming config: "api_paths" must be a non-empty list of globs (${filePath})`);
  }
  const denylistRaw = raw.denylist;
  if (!isRecord(denylistRaw)) {
    throw new Error(`Invalid API naming config: "denylist" must be a map (${filePath})`);
  }
  /** @type {Record<string, { severity: 'error' | 'warn', reason: string }>} */
  const denylist = {};
  for (const [name, entry] of Object.entries(denylistRaw)) {
    if (!isRecord(entry)) throw new Error(`Invalid denylist entry "${name}": must be a map`);
    const severity = entry.severity ?? 'error';
    if (severity !== 'error' && severity !== 'warn') {
      throw new Error(`Invalid denylist entry "${name}": severity must be "error" or "warn"`);
    }
    denylist[name] = { severity, reason: String(entry.reason ?? 'Ambiguous API name.') };
  }

  const allowlist = Array.isArray(raw.allowlist) ? raw.allowlist.map(String) : [];

  const llmRaw = isRecord(raw.llm) ? raw.llm : {};
  const llm = {
    enabled: llmRaw.enabled !== false,
    baseUrl: String(llmRaw.base_url ?? 'https://api.openai.com/v1'),
    model: String(llmRaw.model ?? 'gpt-4o-mini'),
    maxNames: Number(llmRaw.max_names ?? 20),
    timeoutMs: Number(llmRaw.timeout_ms ?? 30000),
  };

  return { apiPaths, denylist, allowlist, llm };
}
