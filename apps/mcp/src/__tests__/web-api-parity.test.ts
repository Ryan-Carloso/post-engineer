import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Web -> MCP parity: every web API endpoint (apps/web/app/api/**/route.ts)
// must either map to at least one MCP tool or carry an exclusion whose
// typed kind is verified mechanically against the route below. A new
// endpoint with no entry fails this test, and so does an exclusion whose
// claim is not true of the code (issue #209/#245/#256: free-text reasons
// like "dashboard-only" let agents skip the tool).
//
// Discovery reads the withApiErrorReporting('METHOD /api/...') label each
// handler is exported with, so a new handler is discovered even when its
// file already existed. The label must match the exported method and the
// file-derived path, so a stale label fails instead of hiding the endpoint.
//
// The exclusion set is closed: only the kinds below exist, each with the
// exact check it must pass. Adding a kind is a reviewed change to this
// file (see .github/CODEOWNERS and the parity-exclusion-guard workflow).

const here = dirname(fileURLToPath(import.meta.url));
const webAppDir = join(here, '..', '..', '..', 'web', 'app');
const apiDir = join(webAppDir, 'api');
const indexTs = readFileSync(join(here, '..', 'index.ts'), 'utf8');

const toolNames = [...indexTs.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map(
  (m) => m[1],
);

// Every exclusion is one of these kinds, and every kind has a mechanical
// check in `verifyExclusion` below:
// - session-only: only the browser cookie session authenticates; bearer
//   headers are never resolved, so an API key/OAuth token cannot call it.
// - bearer-rejected: the route accepts `request` but every handler returns
//   403 for `auth.isApiKey` and `auth.isOAuth` (credential management must
//   never be reachable with a bearer credential).
// - secret-auth: the only gate is a shared secret (cron secret, engine
//   secret, or a Stripe signature); the cookie session is not consulted.
// - oauth-redirect: a browser OAuth start/callback flow that issues a
//   popup response and/or a nonce cookie; not a programmatic JSON API.
// - ops-public: unauthenticated operations/diagnostics endpoint, listed in
//   OPS_PUBLIC_ENDPOINTS (the closed list) and not session-gated.
// - covered-by: an MCP tool already exposes the same capability; every
//   listed tool must be registered in index.ts.
const ExclusionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session-only') }).strict(),
  z.object({ kind: z.literal('bearer-rejected') }).strict(),
  z
    .object({
      kind: z.literal('secret-auth'),
      mechanism: z.enum(['cron-secret', 'engine-secret', 'stripe-signature']),
    })
    .strict(),
  z.object({ kind: z.literal('oauth-redirect') }).strict(),
  z.object({ kind: z.literal('ops-public') }).strict(),
  z
    .object({
      kind: z.literal('covered-by'),
      tools: z.array(z.string().min(1)).min(1),
    })
    .strict(),
]);

type Exclusion = z.infer<typeof ExclusionSchema>;

const EXCLUDED_ENDPOINTS: Record<string, Exclusion> = z
  .record(z.string(), ExclusionSchema)
  .parse(
    JSON.parse(readFileSync(join(here, 'parity-exclusions.json'), 'utf8')),
  );

const OPS_PUBLIC_ENDPOINTS: readonly string[] = [
  'GET /api/coverage',
  'GET /api/version',
];

// Endpoint key -> MCP tools that expose it. One endpoint can map to several
// tools (connect_account serves both OAuth and Bluesky; both video-status
// tools poll the same endpoint), and one tool can serve several endpoints.
const ENDPOINT_TOOLS: Record<string, string[]> = {
  'POST /api/account/connect-url': ['connect_account'],
  'GET /api/account': ['list_social_accounts'],
  'GET /api/billing/tokens': ['get_token_balance'],
  'POST /api/bluesky-connect': ['connect_account'],
  'GET /api/persona/faces': ['list_faces'],
  'GET /api/persona/images': ['list_persona_images'],
  'POST /api/persona/images': ['add_persona_image'],
  'DELETE /api/persona/images': ['remove_persona_image'],
  'PATCH /api/persona/images': ['update_persona_image'],
  'GET /api/persona/list': ['list_personas'],
  'POST /api/persona': ['create_persona'],
  'PATCH /api/persona': ['update_persona'],
  'GET /api/metrics': ['get_post_metrics'],
  'GET /api/posts/[id]': ['get_post'],
  'GET /api/persona/video-status/[taskId]': [
    'get_video_status',
    'get_video_task_progress',
  ],
  'GET /api/persona/voices': ['list_voices'],
  'GET /api/persona/cloned-voices': ['list_cloned_voices'],
  'POST /api/persona/cloned-voices': ['create_cloned_voice'],
  'GET /api/persona/cloned-voices/[cloneId]': ['get_cloned_voice'],
  'DELETE /api/persona/cloned-voices/[cloneId]': ['delete_cloned_voice'],
  'POST /api/persona/cloned-voices/[cloneId]/preview': ['preview_cloned_voice'],
  'GET /api/schedule': ['list_schedules'],
  'DELETE /api/schedule': ['cancel_schedule'],
  'GET /api/schedule/slots/[slotId]': ['get_slot'],
  'PATCH /api/schedule/slots/[slotId]': ['update_slot_topic'],
  'DELETE /api/schedule/slots/[slotId]': ['delete_slot'],
  'GET /api/schedule/status': ['list_posts'],
  'GET /api/persona/delete-preview': ['get_persona_delete_preview'],
  'GET /api/persona/publishing-accounts': ['get_persona_publishing_accounts'],
  'PUT /api/persona/publishing-accounts': ['set_persona_publishing_accounts'],
  'DELETE /api/persona': ['delete_persona'],
  'DELETE /api/account': ['disconnect_account'],
  'GET /api/persona/video-generations': ['list_video_generations'],
  'GET /api/persona/video-generations/[generationId]': [
    'get_video_generation',
  ],
  'GET /api/billing/transactions': ['list_token_transactions'],
  'POST /api/upload-content': ['publish_video_direct'],
  'POST /api/videos/generate-and-schedule': ['generate_persona_videos'],
};

// Tools with no backing web endpoint. Empty today: every tool calls the
// web API through the MCP client. Kept so a future local-only tool has a
// declared home instead of breaking the reverse check.
const WEBLESS_TOOLS: Record<string, string> = {};

interface RouteSource {
  label: string;
  file: string;
  content: string;
}

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      out.push(full);
    }
  }
  return out.sort();
}

function discoverEndpoints(): RouteSource[] {
  const endpoints: RouteSource[] = [];
  for (const file of collectRouteFiles(apiDir)) {
    const content = readFileSync(file, 'utf8');
    // String constants (e.g. `const ROUTE = 'POST /api/...'`) that a
    // handler export may reference instead of an inline literal.
    const constStrings = new Map<string, string>();
    for (const m of content.matchAll(
      /const ([A-Za-z_$][\w$]*) = '([^']+)'/g,
    )) {
      constStrings.set(m[1], m[2]);
    }
    const expectedPath = `/${relative(webAppDir, dirname(file)).split(sep).join('/')}`;
    let found = false;
    for (const m of content.matchAll(
      /export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = withApiErrorReporting\((?:'([^']+)'|([A-Za-z_$][\w$]*))/g,
    )) {
      found = true;
      const exportedMethod = m[1];
      const literal = m[2];
      const identifier = m[3];
      const label =
        literal !== undefined
          ? literal
          : constStrings.get(identifier ?? '');
      if (label === undefined) {
        throw new Error(
          `${file}: exported ${exportedMethod} handler has an unresolvable withApiErrorReporting label`,
        );
      }
      const parts = label.split(' ');
      const labelMethod = parts[0];
      const labelPath = parts.slice(1).join(' ');
      if (labelMethod !== exportedMethod) {
        throw new Error(
          `${file}: withApiErrorReporting label method ${labelMethod} does not match exported handler ${exportedMethod}`,
        );
      }
      if (labelPath !== expectedPath) {
        throw new Error(
          `${file}: withApiErrorReporting label path ${labelPath} does not match file-derived path ${expectedPath}`,
        );
      }
      endpoints.push({ label, file, content });
    }
    if (!found) {
      throw new Error(
        `${file}: no exported handler with a withApiErrorReporting label found; every API handler must be labelled so parity discovery sees it`,
      );
    }
  }
  return endpoints.sort((a, b) => a.label.localeCompare(b.label));
}

const routes = discoverEndpoints();
const discovered = routes.map((route) => route.label);
const routeByLabel = new Map(routes.map((route) => [route.label, route]));
const mappedTools = new Set(Object.values(ENDPOINT_TOOLS).flat());
const registeredTools = new Set(toolNames);

const REGEX_SESSION_ONLY_NO_BEARER = /\b(?:isApiKey|isScopedApiKey|isOAuth)\b/;
const REGEX_SESSION_ONLY_COOKIE =
  /requireSupabaseSession\(\s*\)|\.auth\.getUser\(\s*\)/;

function countHandlers(content: string): number {
  return [
    ...content.matchAll(
      /export const (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = withApiErrorReporting\(/g,
    ),
  ].length;
}

function verifyExclusion(key: string, exclusion: Exclusion): void {
  const route = routeByLabel.get(key);
  if (!route) {
    throw new Error(`${key}: exclusion has no matching route file`);
  }
  const { content } = route;
  switch (exclusion.kind) {
    case 'session-only':
      expect(
        REGEX_SESSION_ONLY_NO_BEARER.test(content),
        `${key}: session-only route must not inspect API-key/OAuth auth (found isApiKey/isScopedApiKey/isOAuth)`,
      ).toBe(false);
      expect(
        REGEX_SESSION_ONLY_COOKIE.test(content),
        `${key}: session-only route must authenticate with the cookie session only (requireSupabaseSession() with no argument or supabase.auth.getUser())`,
      ).toBe(true);
      break;
    case 'bearer-rejected': {
      expect(
        content.includes('requireSupabaseSession(request)'),
        `${key}: bearer-rejected route must pass the request to requireSupabaseSession`,
      ).toBe(true);
      const handlers = countHandlers(content);
      expect(handlers, `${key}: expected at least one handler`).toBeGreaterThan(0);
      expect(
        [...content.matchAll(/auth\.isApiKey === true/g)].length,
        `${key}: every handler must reject auth.isApiKey === true`,
      ).toBeGreaterThanOrEqual(handlers);
      expect(
        [...content.matchAll(/auth\.isOAuth === true/g)].length,
        `${key}: every handler must reject auth.isOAuth === true`,
      ).toBeGreaterThanOrEqual(handlers);
      break;
    }
    case 'secret-auth':
      expect(
        content.includes('requireSupabaseSession'),
        `${key}: secret-auth route must not consult the cookie session`,
      ).toBe(false);
      if (exclusion.mechanism === 'cron-secret') {
        expect(
          content.includes('rejectUnauthorizedCron(') ||
            content.includes('process.env.CRON_SECRET'),
          `${key}: cron-secret route must verify the cron secret`,
        ).toBe(true);
      } else if (exclusion.mechanism === 'engine-secret') {
        expect(
          content.includes('x-engine-secret') && content.includes('secretsMatch('),
          `${key}: engine-secret route must compare x-engine-secret in constant time`,
        ).toBe(true);
      } else {
        expect(
          content.includes('stripe-signature') &&
            content.includes('constructEvent('),
          `${key}: stripe-signature route must verify the Stripe signature`,
        ).toBe(true);
      }
      break;
    case 'oauth-redirect':
      expect(
        key,
        `${key}: oauth-redirect only applies to a */start or */callback route`,
      ).toMatch(/-(?:auth|oauth)\/(?:start|callback)$/);
      expect(
        content.includes('oauthPopupResponse(') ||
          content.includes('setOAuthNonceCookie('),
        `${key}: oauth-redirect route must use the popup response or nonce cookie helper`,
      ).toBe(true);
      break;
    case 'ops-public':
      expect(
        OPS_PUBLIC_ENDPOINTS,
        `${key}: ops-public is a closed list; add the endpoint to OPS_PUBLIC_ENDPOINTS with a reviewed reason`,
      ).toContain(key);
      expect(
        content.includes('requireSupabaseSession') ||
          content.includes('.auth.getUser('),
        `${key}: ops-public route must be unauthenticated`,
      ).toBe(false);
      break;
    case 'covered-by':
      for (const tool of exclusion.tools) {
        expect(
          registeredTools.has(tool),
          `${key}: covered-by tool ${tool} is not registered in index.ts`,
        ).toBe(true);
      }
      break;
  }
}

describe('Web -> MCP parity', () => {
  it('discovers at least one web endpoint', () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it('maps every discovered endpoint to an MCP tool or a typed exclusion', () => {
    const uncovered = discovered.filter(
      (key) => !(key in ENDPOINT_TOOLS) && !(key in EXCLUDED_ENDPOINTS),
    );
    expect(
      uncovered,
      `New web endpoint(s) with no MCP coverage. Add a tool mapping in ENDPOINT_TOOLS, or an exclusion in parity-exclusions.json whose kind is true of the route: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('has no mapping or exclusion for an endpoint that no longer exists', () => {
    const known = new Set(discovered);
    const stale = [...Object.keys(ENDPOINT_TOOLS), ...Object.keys(EXCLUDED_ENDPOINTS)].filter(
      (key) => !known.has(key),
    );
    expect(
      stale,
      `Stale parity entries for removed endpoints: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('never maps and excludes the same endpoint', () => {
    const overlap = Object.keys(ENDPOINT_TOOLS).filter(
      (key) => key in EXCLUDED_ENDPOINTS,
    );
    expect(overlap).toEqual([]);
  });

  it('maps every endpoint to at least one tool', () => {
    for (const [key, tools] of Object.entries(ENDPOINT_TOOLS)) {
      expect(tools.length, `${key} maps to no tool`).toBeGreaterThan(0);
    }
  });

  it('maps only to tools registered in the MCP server', () => {
    const unknown = [...mappedTools].filter((tool) => !registeredTools.has(tool));
    expect(
      unknown,
      `Mapped tools not registered in index.ts: ${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('covers every registered MCP tool with at least one endpoint or a webless declaration', () => {
    const uncovered = toolNames.filter(
      (tool) => !mappedTools.has(tool) && !(tool in WEBLESS_TOOLS),
    );
    expect(
      uncovered,
      `Registered MCP tool(s) with no backing web endpoint. Map them in ENDPOINT_TOOLS or declare them in WEBLESS_TOOLS: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('declares webless tools that are actually registered', () => {
    const unknown = Object.keys(WEBLESS_TOOLS).filter(
      (tool) => !registeredTools.has(tool),
    );
    expect(unknown).toEqual([]);
  });

  // The exclusion file is parsed by ExclusionSchema above, so an unknown
  // kind, a free-text reason, or an extra field already fails before this
  // point. These per-entry checks prove the claim against the route body.
  it.each(Object.entries(EXCLUDED_ENDPOINTS))(
    'verifies the %s exclusion against its route',
    (key, exclusion) => {
      verifyExclusion(key, exclusion);
    },
  );

  it('keeps the ops-public list closed and in sync with the exclusions', () => {
    const declared = Object.entries(EXCLUDED_ENDPOINTS)
      .filter(([, exclusion]) => exclusion.kind === 'ops-public')
      .map(([key]) => key)
      .sort();
    expect(declared).toEqual([...OPS_PUBLIC_ENDPOINTS].sort());
  });
});
