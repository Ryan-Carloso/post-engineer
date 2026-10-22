import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Web -> MCP parity: every web API endpoint (apps/web/app/api/**/route.ts)
// must either map to at least one MCP tool or carry an explicit, justified
// exclusion below. A new endpoint with no entry fails this test, so adding
// a function without adding it to the MCP (or consciously excluding it)
// breaks the pipeline instead of shipping silently.
//
// Discovery reads the withApiErrorReporting('METHOD /api/...') label each
// handler is exported with, so a new handler is discovered even when its
// file already existed. The label must match the exported method and the
// file-derived path, so a stale label fails instead of hiding the endpoint.
//
// Exclusions are grandfathered decisions, not free passes: each one states
// why the endpoint stays out of the MCP. A reviewer should challenge any
// new exclusion that only says "not yet" — that is a gap, not a design.

const here = dirname(fileURLToPath(import.meta.url));
const webAppDir = join(here, '..', '..', '..', 'web', 'app');
const apiDir = join(webAppDir, 'api');
const indexTs = readFileSync(join(here, '..', 'index.ts'), 'utf8');

const toolNames = [...indexTs.matchAll(/server\.tool\(\s*'([a-z_]+)'/g)].map(
  (m) => m[1],
);

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
  'GET /api/persona/video-status/[taskId]': [
    'get_video_status',
    'get_video_task_progress',
  ],
  'GET /api/persona/voices': ['list_voices'],
  'GET /api/persona/cloned-voices': ['list_cloned_voices'],
  'POST /api/persona/cloned-voices': ['create_cloned_voice'],
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
  'GET /api/persona/video-generations/[generationId]': ['get_video_generation'],
  'GET /api/billing/transactions': ['list_token_transactions'],
  'POST /api/upload-content': ['publish_video_direct'],
  'POST /api/videos/generate-and-schedule': ['generate_persona_videos'],
};

// Endpoint key -> why it stays out of the MCP. Keep each reason concrete:
// the auth it uses, the surface it serves, or the tool that covers it.
const EXCLUDED_ENDPOINTS: Record<string, string> = {
  'DELETE /api/api-keys/[id]':
    'API keys are dashboard-only: an API-key caller must never manage keys.',
  'GET /api/api-keys':
    'API keys are dashboard-only: an API-key caller must never manage keys.',
  'POST /api/api-keys':
    'API keys are dashboard-only: an API-key caller must never manage keys.',
  'POST /api/billing/check-tokens':
    'Engine-internal: authenticated by x-engine-secret, not by API key.',
  'POST /api/billing/checkout':
    'Browser-only Stripe Checkout session creation; requires a web session.',
  'POST /api/billing/webhook':
    'Stripe webhook: signature-verified, not API-key callable.',
  'GET /api/coverage': 'CI-only coverage endpoint.',
  'POST /api/cron/billing-reconcile':
    'Cron-internal: authenticated by cron secret, not by API key.',
  'GET /api/google-oauth/callback': 'Browser OAuth callback.',
  'GET /api/google-oauth/start': 'Browser OAuth start (redirect flow).',
  'GET /api/health':
    'Ops health check: session-authenticated Supabase reachability probe.',
  'GET /api/instagram-auth/callback': 'Browser OAuth callback.',
  'GET /api/instagram-auth/start': 'Browser OAuth start (redirect flow).',
  'GET /api/linkedin-auth/callback': 'Browser OAuth callback.',
  'GET /api/linkedin-auth/start': 'Browser OAuth start (redirect flow).',
  'POST /api/logout': 'Browser-only session logout (clears the auth cookie).',
  'GET /api/moneyprint/health': 'Ops engine health proxy.',
  'POST /api/persona/avatar':
    'Dashboard-only mock AI avatar generator placeholder, not a programmatic API.',
  'GET /api/persona/video-download/[taskId]/[...path]':
    'Binary download proxy for the dashboard; MCP surfaces video URLs instead of proxying bytes.',
  'GET /api/persona/video-events/[taskId]':
    'Browser-only SSE proxy; MCP polls via get_video_task_progress.',
  'DELETE /api/persona/video-task/[taskId]':
    'Dashboard engine-task cleanup; MCP polls status but never cancels engine tasks.',
  'POST /api/persona/cloned-voices/denoise-preview':
    'UI-only A/B listen of the cleaned recording before cloning; agents pass denoise to create_cloned_voice instead.',
  'GET /api/persona/cloned-voices/[cloneId]':
    'Dashboard clone status polling; MCP list_cloned_voices returns every clone row.',
  'GET /api/posts/[id]':
    'Dashboard-only unified post detail (issue #208); MCP get_slot and get_video_generation cover the same data.',
  'GET /api/version': 'Public version endpoint for ops/diagnostics.',
};

// Tools with no backing web endpoint. Empty today: every tool calls the
// web API through the MCP client. Kept so a future local-only tool has a
// declared home instead of breaking the reverse check.
const WEBLESS_TOOLS: Record<string, string> = {};

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

function discoverEndpoints(): string[] {
  const endpoints: string[] = [];
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
      endpoints.push(label);
    }
    if (!found) {
      throw new Error(
        `${file}: no exported handler with a withApiErrorReporting label found; every API handler must be labelled so parity discovery sees it`,
      );
    }
  }
  return endpoints.sort();
}

const discovered = discoverEndpoints();
const mappedTools = new Set(Object.values(ENDPOINT_TOOLS).flat());

describe('Web -> MCP parity', () => {
  it('discovers at least one web endpoint', () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it('maps every discovered endpoint to an MCP tool or an explicit exclusion', () => {
    const uncovered = discovered.filter(
      (key) => !(key in ENDPOINT_TOOLS) && !(key in EXCLUDED_ENDPOINTS),
    );
    expect(
      uncovered,
      `New web endpoint(s) with no MCP coverage. Add a tool mapping in ENDPOINT_TOOLS, or a justified exclusion in EXCLUDED_ENDPOINTS: ${uncovered.join(', ')}`,
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
    const registered = new Set(toolNames);
    const unknown = [...mappedTools].filter((tool) => !registered.has(tool));
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
    const registered = new Set(toolNames);
    const unknown = Object.keys(WEBLESS_TOOLS).filter(
      (tool) => !registered.has(tool),
    );
    expect(unknown).toEqual([]);
  });

  it('gives every exclusion a non-empty reason', () => {
    for (const [key, reason] of Object.entries(EXCLUDED_ENDPOINTS)) {
      expect(reason.trim().length, `${key} has an empty exclusion reason`).toBeGreaterThan(0);
    }
  });
});
