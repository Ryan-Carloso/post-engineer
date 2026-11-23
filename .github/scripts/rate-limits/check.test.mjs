import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ALLOWLIST_PATH, findViolations, parseAllowlist, run, selectRoutes } from './check.mjs';
import { scanRoute } from './scan.mjs';

const FILE = 'apps/web/app/api/example/route.ts';

function methods(text) {
  return Object.fromEntries(scanRoute(FILE, text).map((handler) => [handler.method, handler.limited]));
}

test('a wrapped handler that calls applyRateLimit is limited', () => {
  const text = `
    async function getHandler(request: Request) {
      const limited = await applyRateLimit(request, RATE_LIMITS.metrics, 'u');
      if (limited) return limited;
      return ok();
    }
    export const GET = withApiErrorReporting('GET /x', getHandler, { getUserId: resolveReportingUserId });
  `;
  assert.deepEqual(methods(text), { GET: true });
});

test('a sibling handler in the same file without a limit is flagged on its own', () => {
  const text = `
    async function getHandler(request: Request) {
      await applyRateLimit(request, RATE_LIMITS.metrics);
    }
    async function deleteHandler(request: Request) {
      return remove(request);
    }
    export const GET = withApiErrorReporting('GET /x', getHandler);
    export const DELETE = withApiErrorReporting('DELETE /x', deleteHandler);
  `;
  assert.deepEqual(methods(text), { GET: true, DELETE: false });
});

test('a limit reached through a same-file helper counts', () => {
  const text = `
    async function resolveContext(request: Request) {
      return applyRateLimit(request, RATE_LIMITS.toolConfig, 'u');
    }
    const getHandler = async (request: Request) => {
      const context = await resolveContext(request);
      return context;
    };
    export const GET = withApiErrorReporting('GET /x', getHandler);
  `;
  assert.deepEqual(methods(text), { GET: true });
});

test('an imported helper that receives a RATE_LIMITS profile counts', () => {
  const text = `
    export async function GET(request: Request) {
      const caller = await resolvePromptCaller(request, 'GET /x', RATE_LIMITS.promptsRead, { allowAnonymous: true });
      return caller;
    }
  `;
  assert.deepEqual(methods(text), { GET: true });
});

test('a plain exported function with no limit is flagged', () => {
  assert.deepEqual(methods('export async function POST(request: Request) { return handle(request); }'), { POST: false });
});

test('mentioning applyRateLimit without calling it does not count', () => {
  const text = `
    const name = 'applyRateLimit';
    export async function GET() { return name; }
  `;
  assert.deepEqual(methods(text), { GET: false });
});

test('selectRoutes keeps route.ts under apps/web/app and skips tests', () => {
  assert.deepEqual(
    selectRoutes([
      'apps/web/app/api/a/route.ts',
      'apps/web/app/mcp/route.ts',
      'apps/web/app/api/a/__tests__/route.ts',
      'apps/web/lib/route.ts',
      'apps/web/app/api/a/helpers.ts',
    ]),
    ['apps/web/app/api/a/route.ts', 'apps/web/app/mcp/route.ts'],
  );
});

const ENTRY = { file: FILE, method: 'GET', kind: 'health-probe', reason: 'Liveness probe with no per-user data at all.' };

test('a valid allowlist entry parses', () => {
  assert.deepEqual(parseAllowlist([ENTRY]), { entries: [ENTRY], errors: [] });
});

test('allowlist entries must carry a known kind, a real reason and no extra keys', () => {
  const cases = [
    [{ ...ENTRY, kind: 'because' }, /kind must be one of/],
    [{ ...ENTRY, reason: 'too short' }, /reason must explain/],
    [{ ...ENTRY, method: 'TRACE' }, /method must be one of/],
    [{ ...ENTRY, file: 'apps/web/lib/x.ts' }, /file must be a route\.ts/],
    [{ ...ENTRY, approvedBy: 'me' }, /exactly the keys/],
    ['GET /x', /must be an object/],
  ];
  for (const [entry, pattern] of cases) {
    const { entries, errors } = parseAllowlist([entry]);
    assert.equal(entries.length, 0);
    assert.match(errors[0], pattern);
  }
  assert.match(parseAllowlist({}).errors[0], /must be a JSON array/);
  assert.match(parseAllowlist([ENTRY, ENTRY]).errors[0], /duplicates GET/);
});

test('an unlimited handler without an entry is a violation', () => {
  const violations = findViolations([{ file: FILE, method: 'GET', line: 3, limited: false }], []);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /never reaches applyRateLimit/);
  assert.equal(violations[0].line, 3);
});

test('an allowlisted unlimited handler passes', () => {
  assert.deepEqual(findViolations([{ file: FILE, method: 'GET', line: 3, limited: false }], [ENTRY]), []);
});

test('a stale entry for a limited handler is a violation', () => {
  const violations = findViolations([{ file: FILE, method: 'GET', line: 3, limited: true }], [ENTRY]);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /delete its stale allowlist entry/);
});

test('an entry naming no handler is a violation', () => {
  const violations = findViolations([], [ENTRY]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, ALLOWLIST_PATH);
  assert.match(violations[0].message, /names no exported handler/);
});

test('the repository passes with every exemption justified', () => {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const { handlers, violations } = run(root);
  assert.deepEqual(violations, []);
  assert.ok(handlers.length > 50);
  assert.ok(handlers.some((handler) => handler.file === 'apps/web/app/api/persona/list/route.ts' && handler.method === 'GET' && handler.limited));
});
