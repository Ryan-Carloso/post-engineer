#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTTP_METHODS, scanRoute } from './scan.mjs';

export const ROUTE_ROOT = 'apps/web/app/';
export const ALLOWLIST_PATH = '.github/scripts/rate-limits/allowlist.json';
export const EXEMPTION_KINDS = {
  'health-probe': 'liveness or build-info probe with no per-user data',
  'oauth-callback': 'one-shot provider redirect carrying a single-use code and a signed state',
  'signed-webhook': 'server-to-server call verified by a provider signature',
  'engine-callback': 'engine-to-web call authenticated by the shared engine secret',
  'session-teardown': 'signs the caller out; throttling it would trap a session',
  'test-only': 'serves test instrumentation and touches no service',
  'oauth-discovery': 'static OAuth metadata or public keys',
  'limited-elsewhere': 'rate limited by another open pull request; remove the entry when it merges',
};
export const MIN_REASON_LENGTH = 20;

const ROUTE_FILE = /\/route\.ts$/;
const NOT_PRODUCTION = /(^|\/)__tests__\//;

export function selectRoutes(paths) {
  return paths.filter((path) => path.startsWith(ROUTE_ROOT) && ROUTE_FILE.test(path) && !NOT_PRODUCTION.test(path));
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAllowlist(data) {
  const errors = [];
  const entries = [];
  if (!Array.isArray(data)) return { entries, errors: [`${ALLOWLIST_PATH} must be a JSON array`] };
  const seen = new Set();
  data.forEach((entry, index) => {
    const at = `${ALLOWLIST_PATH}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const keys = Object.keys(entry).sort().join(',');
    if (keys !== 'file,kind,method,reason') {
      errors.push(`${at} must have exactly the keys file, kind, method, reason (got ${keys})`);
      return;
    }
    const { file, method, kind, reason } = entry;
    if (typeof file !== 'string' || selectRoutes([file]).length !== 1) errors.push(`${at}.file must be a route.ts under ${ROUTE_ROOT}`);
    else if (typeof method !== 'string' || !HTTP_METHODS.includes(method)) errors.push(`${at}.method must be one of ${HTTP_METHODS.join(', ')}`);
    else if (typeof kind !== 'string' || !Object.hasOwn(EXEMPTION_KINDS, kind)) errors.push(`${at}.kind must be one of ${Object.keys(EXEMPTION_KINDS).join(', ')}`);
    else if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) errors.push(`${at}.reason must explain the exemption in at least ${MIN_REASON_LENGTH} characters`);
    else if (seen.has(`${file} ${method}`)) errors.push(`${at} duplicates ${method} ${file}`);
    else {
      seen.add(`${file} ${method}`);
      entries.push({ file, method, kind, reason });
    }
  });
  return { entries, errors };
}

export function findViolations(handlers, entries) {
  const violations = [];
  const exempt = new Map(entries.map((entry) => [`${entry.file} ${entry.method}`, entry]));
  const present = new Set();
  for (const handler of handlers) {
    const key = `${handler.file} ${handler.method}`;
    present.add(key);
    const entry = exempt.get(key);
    if (handler.limited && entry !== undefined) {
      violations.push({ file: handler.file, line: handler.line, message: `${handler.method} is rate limited now; delete its stale allowlist entry (${entry.kind})` });
    }
    if (!handler.limited && entry === undefined) {
      violations.push({
        file: handler.file,
        line: handler.line,
        message: `${handler.method} handler never reaches applyRateLimit (or a helper taking a RATE_LIMITS profile); add a limit or a typed entry in ${ALLOWLIST_PATH}`,
      });
    }
  }
  for (const entry of entries) {
    if (!present.has(`${entry.file} ${entry.method}`)) {
      violations.push({ file: ALLOWLIST_PATH, line: 1, message: `allowlist entry ${entry.method} ${entry.file} names no exported handler` });
    }
  }
  return violations;
}

export function run(root) {
  const tracked = execFileSync('git', ['ls-files', ROUTE_ROOT], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const handlers = selectRoutes(tracked).flatMap((file) => scanRoute(file, readFileSync(join(root, file), 'utf8')));
  const { entries, errors } = parseAllowlist(JSON.parse(readFileSync(join(root, ALLOWLIST_PATH), 'utf8')));
  const violations = [
    ...errors.map((message) => ({ file: ALLOWLIST_PATH, line: 1, message })),
    ...findViolations(handlers, entries),
  ];
  return { handlers, violations };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const { handlers, violations } = run(root);
  for (const violation of violations) {
    console.log(`::error file=${violation.file},line=${violation.line}::${violation.message}`);
  }
  const limited = handlers.filter((handler) => handler.limited).length;
  console.log(`rate-limits: ${handlers.length} handlers, ${limited} rate limited, ${violations.length} violation(s)`);
  process.exit(violations.length === 0 ? 0 : 1);
}
