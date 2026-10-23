import { describe, expect, it } from 'vitest';
import { buildMcpCallGraph, toolCallsEndpoint } from './parity/mcp-calls.js';
import { ExclusionSchema, verifyExclusion, type Exclusion, type VerifyContext } from './parity/exclusions.js';
import { readRouteFile, type HandlerFacts, type RouteFile } from './parity/route-facts.js';

// Bypass fixtures for the parity verifier: each one is a route (or MCP
// source) that tried to satisfy an exclusion kind without the behaviour it
// claims — the claim in a comment or a string, one handler vouching for
// another, a covered-by pointing at an unrelated tool. Every one must fail.

const MCP_INDEX = 'index.ts';
const MCP_SOURCES = [
  {
    file: 'client.ts',
    text: `
      export class Client {
        async listPersonas() {
          return this.request('/api/persona/list', { method: 'GET' }, 'list personas');
        }
        async getStatus(taskId: string) {
          return this.request(\`/api/persona/video-status/\${encodeURIComponent(taskId)}\`, { method: 'GET' }, 'status');
        }
      }
    `,
  },
  {
    file: MCP_INDEX,
    text: `
      server.tool('list_personas', 'd', {}, async () => client.listPersonas());
      server.tool('get_video_status', 'd', {}, async (args) => client.getStatus(args.taskId));
    `,
  },
];
const graph = buildMcpCallGraph(MCP_SOURCES, MCP_INDEX);

function route(key: string, text: string): { route: RouteFile; handler: HandlerFacts } {
  const parsed = readRouteFile(`${key}.ts`, text);
  const method = key.split(' ')[0];
  const handler = parsed.handlers.find((h) => h.method === method);
  if (handler === undefined) throw new Error(`fixture ${key} has no ${method} handler`);
  return { route: parsed, handler };
}

function verify(
  key: string,
  exclusion: Exclusion,
  text: string,
  extra: Record<string, string> = {},
  endpointTools: Record<string, string[]> = {},
): string[] {
  const routes = new Map<string, { route: RouteFile; handler: HandlerFacts }>([[key, route(key, text)]]);
  for (const [otherKey, otherText] of Object.entries(extra)) routes.set(otherKey, route(otherKey, otherText));
  const ctx: VerifyContext = {
    route: (k) => routes.get(k),
    libSource: (specifier) =>
      specifier === '@/lib/urls'
        ? "export function toUrl(id: string) { return `/api/files/${id}`; }"
        : undefined,
    endpointTools,
    graph,
    opsPublic: ['GET /api/version'],
  };
  return verifyExclusion(key, exclusion, ctx);
}

const SESSION_ONLY: Exclusion = { kind: 'session-only' };

describe('parity verifier: session-only', () => {
  it('accepts a genuinely cookie-only handler', () => {
    const text = `
      async function getHandler() {
        const { auth, error } = await requireSupabaseSession();
        if (error || !auth) return error;
        return NextResponse.json({ ok: true });
      }
      export const GET = withApiErrorReporting('GET /api/x', getHandler);
    `;
    expect(verify('GET /api/x', SESSION_ONLY, text)).toEqual([]);
  });

  it('rejects a bearer-resolving handler whose cookie-only call exists only in a comment', () => {
    const text = `
      // Session only: requireSupabaseSession() — supabase.auth.getUser()
      async function getHandler(request: Request) {
        const { auth } = await requireSupabaseSession(request);
        return NextResponse.json({ auth });
      }
      export const GET = withApiErrorReporting('GET /api/x', getHandler);
    `;
    expect(verify('GET /api/x', SESSION_ONLY, text).length).toBeGreaterThan(0);
  });

  it('rejects a handler whose cookie-only call exists only in a string', () => {
    const text = `
      const NOTE = 'requireSupabaseSession()';
      async function getHandler(request: Request) {
        const { auth } = await requireSupabaseSession(request);
        return NextResponse.json({ auth, NOTE });
      }
      export const GET = withApiErrorReporting('GET /api/x', getHandler);
    `;
    expect(verify('GET /api/x', SESSION_ONLY, text).length).toBeGreaterThan(0);
  });

  it('checks each exported handler on its own: a cookie-only GET does not vouch for a bearer POST', () => {
    const text = `
      async function getHandler() {
        const { auth, error } = await requireSupabaseSession();
        if (error || !auth) return error;
        return NextResponse.json({ ok: true });
      }
      async function postHandler(request: Request) {
        const { auth } = await requireSupabaseSession(request);
        return NextResponse.json({ auth });
      }
      export const GET = withApiErrorReporting('GET /api/x', getHandler);
      export const POST = withApiErrorReporting('POST /api/x', postHandler);
    `;
    expect(verify('GET /api/x', SESSION_ONLY, text)).toEqual([]);
    expect(verify('POST /api/x', SESSION_ONLY, text)).toContainEqual(
      expect.stringContaining('must not call requireSupabaseSession(request)'),
    );
  });

  it('rejects a route that resolves API keys itself (resolveApiKey) next to a cookie check', () => {
    const text = `
      import { resolveApiKey } from '@/lib/api-keys';
      async function getHandler(request: Request) {
        const key = request.headers.get('authorization');
        if (key) return NextResponse.json(await resolveApiKey(key, service));
        const { data } = await supabase.auth.getUser();
        return NextResponse.json(data);
      }
      export const GET = withApiErrorReporting('GET /api/x', getHandler);
    `;
    const errors = verify('GET /api/x', SESSION_ONLY, text);
    expect(errors).toContainEqual(expect.stringContaining('no bearer handling (found resolveApiKey)'));
    expect(errors).toContainEqual(expect.stringContaining('authorization/x-api-key'));
  });

  it('follows local helpers: a bearer call inside a helper the handler uses still fails', () => {
    const text = `
      async function authenticate(request: Request) {
        return requireSupabaseSession(request);
      }
      async function getHandler(request: Request) {
        const { auth } = await authenticate(request);
        await requireSupabaseSession();
        return NextResponse.json({ auth });
      }
      export const GET = withApiErrorReporting('GET /api/x', getHandler);
    `;
    expect(verify('GET /api/x', SESSION_ONLY, text).length).toBeGreaterThan(0);
  });
});

describe('parity verifier: bearer-rejected', () => {
  const kind: Exclusion = { kind: 'bearer-rejected' };

  it('rejects a handler whose isApiKey/isOAuth check exists only in a comment', () => {
    const text = `
      async function getHandler(request: Request) {
        const { auth } = await requireSupabaseSession(request);
        // if (auth.isApiKey === true || auth.isOAuth === true) return 403
        return NextResponse.json({ auth });
      }
      export const GET = withApiErrorReporting('GET /api/keys', getHandler);
    `;
    expect(verify('GET /api/keys', kind, text).length).toBe(2);
  });

  it('does not let one handler’s rejection cover another handler', () => {
    const text = `
      async function getHandler(request: Request) {
        const { auth } = await requireSupabaseSession(request);
        if (auth.isApiKey === true || auth.isOAuth === true) {
          return apiErrorResponse(403, 'no');
        }
        if (auth.isApiKey === true || auth.isOAuth === true) {
          return apiErrorResponse(403, 'twice');
        }
        return NextResponse.json({});
      }
      async function postHandler(request: Request) {
        const { auth } = await requireSupabaseSession(request);
        return NextResponse.json({ auth });
      }
      export const GET = withApiErrorReporting('GET /api/keys', getHandler);
      export const POST = withApiErrorReporting('POST /api/keys', postHandler);
    `;
    expect(verify('GET /api/keys', kind, text)).toEqual([]);
    expect(verify('POST /api/keys', kind, text).length).toBe(2);
  });
});

describe('parity verifier: secret-auth', () => {
  it('rejects an engine-secret claim that exists only in a comment', () => {
    const text = `
      // checks request.headers.get('x-engine-secret') with secretsMatch(a, b)
      async function postHandler(request: Request) {
        return NextResponse.json({ ok: true });
      }
      export const POST = withApiErrorReporting('POST /api/hook', postHandler);
    `;
    expect(verify('POST /api/hook', { kind: 'secret-auth', mechanism: 'engine-secret' }, text).length).toBe(2);
  });

  it('rejects a cron-secret claim whose rejection is computed but never returned', () => {
    const text = `
      async function postHandler(request: Request) {
        const rejection = rejectUnauthorizedCron(request, 'tag', 'msg');
        // if (rejection !== null) return rejection;
        return NextResponse.json({ ok: true, rejection });
      }
      export const POST = withApiErrorReporting('POST /api/cron/x', postHandler);
    `;
    expect(verify('POST /api/cron/x', { kind: 'secret-auth', mechanism: 'cron-secret' }, text).length).toBe(1);
  });

  it('accepts a cron route that returns the rejection', () => {
    const text = `
      async function postHandler(request: Request) {
        const rejection = rejectUnauthorizedCron(request, 'tag', 'msg');
        if (rejection !== null) return rejection;
        return NextResponse.json({ ok: true });
      }
      export const POST = withApiErrorReporting('POST /api/cron/x', postHandler);
    `;
    expect(verify('POST /api/cron/x', { kind: 'secret-auth', mechanism: 'cron-secret' }, text)).toEqual([]);
  });
});

describe('parity verifier: ops-public', () => {
  it('rejects an endpoint outside the reviewed opsPublic list', () => {
    const text = `
      async function getHandler() { return NextResponse.json({}); }
      export const GET = withApiErrorReporting('GET /api/debug', getHandler);
    `;
    expect(verify('GET /api/debug', { kind: 'ops-public' }, text)).toContainEqual(
      expect.stringContaining('closed list'),
    );
  });

  it('rejects a listed endpoint that resolves API keys', () => {
    const text = `
      import { resolveApiKey } from '@/lib/api-keys';
      async function getHandler(request: Request) {
        return NextResponse.json(await resolveApiKey('k', service));
      }
      export const GET = withApiErrorReporting('GET /api/version', getHandler);
    `;
    expect(verify('GET /api/version', { kind: 'ops-public' }, text).length).toBeGreaterThan(0);
  });
});

describe('parity verifier: tool-backed claims', () => {
  it('no longer accepts the covered-by kind (a registered but unrelated tool proved nothing)', () => {
    expect(() => ExclusionSchema.parse({ kind: 'covered-by', tools: ['list_personas'] })).toThrow();
  });

  it('proves a mapping only when the tool calls the same method and path', () => {
    expect(toolCallsEndpoint(graph, 'list_personas', 'GET /api/persona/list')).toBe(true);
    expect(toolCallsEndpoint(graph, 'list_personas', 'GET /api/metrics')).toBe(false);
    expect(toolCallsEndpoint(graph, 'list_personas', 'POST /api/persona/list')).toBe(false);
    expect(toolCallsEndpoint(graph, 'get_video_status', 'GET /api/persona/video-status/[taskId]')).toBe(true);
  });

  const DOWNLOAD = `
    async function getHandler(request: Request) {
      const { auth } = await requireSupabaseSession(request);
      return NextResponse.json({ auth });
    }
    export const GET = withApiErrorReporting('GET /api/files/[id]', getHandler);
  `;
  const STATUS = `
    import { toUrl } from '@/lib/urls';
    async function getHandler(request: Request) {
      const { auth } = await requireSupabaseSession(request);
      return NextResponse.json({ url: toUrl('1'), auth });
    }
    export const GET = withApiErrorReporting('GET /api/persona/video-status/[taskId]', getHandler);
  `;

  it('accepts returned-url when the referenced endpoint is mapped, called, and builds the URL', () => {
    expect(
      verify(
        'GET /api/files/[id]',
        { kind: 'returned-url', endpoint: 'GET /api/persona/video-status/[taskId]' },
        DOWNLOAD,
        { 'GET /api/persona/video-status/[taskId]': STATUS },
        { 'GET /api/persona/video-status/[taskId]': ['get_video_status'] },
      ),
    ).toEqual([]);
  });

  it('rejects returned-url when the referenced endpoint is mapped to an unrelated tool', () => {
    expect(
      verify(
        'GET /api/files/[id]',
        { kind: 'returned-url', endpoint: 'GET /api/persona/video-status/[taskId]' },
        DOWNLOAD,
        { 'GET /api/persona/video-status/[taskId]': STATUS },
        { 'GET /api/persona/video-status/[taskId]': ['list_personas'] },
      ),
    ).toContainEqual(expect.stringContaining('no tool mapped'));
  });

  it('rejects returned-url when the referenced endpoint never builds the URL', () => {
    const unrelated = STATUS.replace("toUrl('1')", "'none'");
    expect(
      verify(
        'GET /api/files/[id]',
        { kind: 'returned-url', endpoint: 'GET /api/persona/video-status/[taskId]' },
        DOWNLOAD,
        { 'GET /api/persona/video-status/[taskId]': unrelated },
        { 'GET /api/persona/video-status/[taskId]': ['get_video_status'] },
      ),
    ).toContainEqual(expect.stringContaining('builds /api/files/'));
  });
});

describe('parity verifier: discovery', () => {
  it('refuses an HTTP handler exported as a plain function (invisible to discovery)', () => {
    const text = `
      async function getHandler() { return NextResponse.json({}); }
      export const GET = withApiErrorReporting('GET /api/x', getHandler);
      export async function POST() { return NextResponse.json({}); }
    `;
    expect(() => readRouteFile('x.ts', text)).toThrow(/plain function/);
  });
});
