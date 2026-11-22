import { getPostHogServer } from './posthog-server';
import { redactCredentialFragments } from './scrub';
import { USER_PROMPT_SLUG_PATTERN } from '@/lib/contracts/prompts';

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,20})?$/;

export type McpAuthMethod = 'api_key' | 'oauth';

interface McpToolCaller {
  userId: string;
  authMethod: McpAuthMethod;
}

const callers = new WeakMap<Request, McpToolCaller>();
const recorded = new WeakSet<Request>();

export const RECIPE_NUDGE_SURFACES: ReadonlySet<string> = new Set([
  'none',
  'personas_create',
  'personas_list',
  'accounts_list',
  'billing_balance',
  'check_script_validate',
  'generate_video',
]);
const TRANSPORTS: ReadonlySet<string> = new Set(['stdio', 'http']);
const RECIPE_FOLLOWED = 'prompt';
const SCRIPT_REJECTIONS = /^\d{1,3}$/;
const CALL_REQUEST = /^[1-9]\d{0,5}$/;

function headerInSet(request: Request, name: string, allowed: ReadonlySet<string>): string | undefined {
  const value = request.headers.get(name);
  return value !== null && allowed.has(value) ? value : undefined;
}

function recipeHeader(request: Request, name: string, allowNone: boolean): string | undefined {
  const value = request.headers.get(name);
  if (value === null) return undefined;
  if (value === 'none') return allowNone ? value : 'unknown';
  if (USER_PROMPT_SLUG_PATTERN.test(value)) return RECIPE_FOLLOWED;
  return 'unknown';
}

function recipeAdoptionProperties(request: Request): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const sessionId = headerMatching(request, 'x-mcp-session-id', CALL_ID);
  if (sessionId !== undefined) properties.session_id = sessionId;
  const transport = headerInSet(request, 'x-mcp-transport', TRANSPORTS);
  if (transport !== undefined) properties.transport = transport;
  const nudgedBy = headerInSet(request, 'x-mcp-nudged-by', RECIPE_NUDGE_SURFACES);
  if (nudgedBy !== undefined) properties.nudged_by = nudgedBy;
  const recipesKnown = request.headers.get('x-mcp-recipes-known');
  if (recipesKnown === 'true' || recipesKnown === 'false') properties.recipes_known = recipesKnown === 'true';
  const recipeFetched = recipeHeader(request, 'x-mcp-recipe-fetched', true);
  if (recipeFetched !== undefined) properties.recipe_fetched = recipeFetched;
  const rejections = headerMatching(request, 'x-mcp-script-rejections', SCRIPT_REJECTIONS);
  if (rejections !== undefined) properties.script_rejections = Number(rejections);
  const recipe = recipeHeader(request, 'x-mcp-recipe', false);
  if (recipe !== undefined) properties.recipe = recipe;
  return properties;
}

const STATIC_SEGMENT = /^[a-z][a-z0-9-]{0,40}$/;

function telemetryPath(url: string): string {
  const segments = new URL(url).pathname.split('/').map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return ':param';
    }
    return decoded === '' || (STATIC_SEGMENT.test(decoded) && !CALL_ID.test(decoded)) ? decoded : ':param';
  });
  const path = redactCredentialFragments(segments.join('/'));
  const parts = path.split('/');
  if (parts.length === 4 && parts[1] === 'api' && parts[2] === 'prompts' && STATIC_SEGMENT.test(parts[3] ?? '')) {
    parts[3] = ':param';
  }
  return parts.join('/');
}

function headerMatching(request: Request, name: string, pattern: RegExp): string | undefined {
  const value = request.headers.get(name);
  return value !== null && pattern.test(value) ? value : undefined;
}

export function noteMcpToolCaller(request: Request, userId: string, authMethod: McpAuthMethod): void {
  try {
    if (recorded.has(request) || callers.has(request)) return;
    callers.set(request, { userId, authMethod });
  } catch {
  }
}

export function recordMcpToolCall(request: Request | undefined, status: number): void {
  try {
    if (request === undefined || recorded.has(request)) return;
    const caller = callers.get(request);
    if (caller === undefined) return;
    const tool = headerMatching(request, 'x-mcp-tool', TOOL_NAME);
    if (tool === undefined) return;
    recorded.add(request);
    const ok = status >= 200 && status < 300;
    const callRequest = headerMatching(request, 'x-mcp-call-request', CALL_REQUEST);
    const followUp = callRequest !== undefined && callRequest !== '1';
    if (followUp && ok) return;
    const client = getPostHogServer();
    if (client === null) return;
    const properties: Record<string, unknown> = {
      ...recipeAdoptionProperties(request),
      tool,
      auth_method: caller.authMethod,
      method: request.method,
      path: telemetryPath(request.url),
      status,
      ok,
    };
    const action = headerMatching(request, 'x-mcp-action', TOOL_NAME);
    if (action !== undefined) properties.action = action;
    const callId = headerMatching(request, 'x-mcp-call-id', CALL_ID);
    if (callId !== undefined) properties.call_id = callId;
    const version = headerMatching(request, 'x-mcp-version', VERSION);
    if (version !== undefined) properties.mcp_version = version;
    if (followUp) {
      properties.call_request = Number(callRequest);
      client.captureAs(caller.userId, 'mcp_tool_request_failed', properties);
      return;
    }
    client.captureAs(caller.userId, 'mcp_tool_called', properties);
  } catch {
  }
}
