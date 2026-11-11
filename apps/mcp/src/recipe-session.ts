import { randomUUID } from 'node:crypto';
import { withTelemetryHeaders } from './analytics.js';
import { validateSegments } from './script-segments.js';
import type { VideoType } from './video-type.js';
import type { McpToolResponse } from './tools-call.js';

//---------------
// Recipe adoption: nudges and the telemetry that measures them.
//
// An agent that never hears about the recipe hub improvises scripts. This
// module keeps one RecipeSession per MCP server instance (one stdio
// connection, or one HTTP request — the HTTP transport is stateless) and:
//
// 1. Nudges. Entry tools (the calls an agent makes before its first video)
//    get one extra text block pointing at list_prompts, and a script the
//    mechanical validator rejects gets a hint that recipes produce scripts
//    that pass. The nudge stops once the agent has listed or fetched a
//    recipe.
// 2. Telemetry. The MCP never talks to PostHog (analytics.ts): the session
//    state rides on the API requests of the wrapped tools as X-MCP-* headers,
//    and the web API validates them and adds them to `mcp_tool_called`
//    (apps/web/lib/mcp-tool-telemetry.ts). The header names and the nudge
//    surfaces are pinned against the web module by mcp-recipe-headers-sync.
//
// Recipe slugs are format-checked here (the hub lives on the web, so the
// MCP has no slug list); the web maps any slug that is not a hub slug to
// 'unknown', so agent text never reaches PostHog.
//---------------

export type McpTransportKind = 'stdio' | 'http';

export const RECIPE_NUDGE_SURFACES = [
  'create_persona',
  'list_personas',
  'list_social_accounts',
  'get_token_balance',
  'validate_script',
  'generate_persona_video',
] as const;

export type RecipeNudgeSurface = (typeof RECIPE_NUDGE_SURFACES)[number];

export type ScriptTool = 'validate_script' | 'generate_persona_video';

export const MCP_SESSION_ID_HEADER = 'X-MCP-Session-Id';
export const MCP_TRANSPORT_HEADER = 'X-MCP-Transport';
export const MCP_NUDGED_BY_HEADER = 'X-MCP-Nudged-By';
export const MCP_RECIPES_KNOWN_HEADER = 'X-MCP-Recipes-Known';
export const MCP_RECIPE_FETCHED_HEADER = 'X-MCP-Recipe-Fetched';
export const MCP_SCRIPT_REJECTIONS_HEADER = 'X-MCP-Script-Rejections';
export const MCP_RECIPE_HEADER = 'X-MCP-Recipe';

// A recipe slug as the web hub writes them; anything else is never sent.
export const RECIPE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Header values stay bounded: the counter saturates instead of growing.
const MAX_SCRIPT_REJECTIONS = 999;

export const RECIPE_NUDGE_TEXT =
  'Next step for a video about a topic (news, a place, a product, GitHub PRs): call list_prompts and follow the matching recipe with get_prompt instead of improvising the script — recipes pre-validate the script, media, and price facts before any token is spent.';

export const SCRIPT_REJECTED_RECIPE_HINT =
  'Recipes produce scripts that pass these limits: call list_prompts and follow the matching recipe with get_prompt.';

//---------------
// The text an agent runs for a recipe: the hub text plus a footer asking
// it to declare the recipe on generate_persona_video, so its request
// carries X-MCP-Recipe. Shared by get_prompt and the slash commands.
//---------------
export function recipeRunText(slug: string, prompt: string): string {
  return `${prompt}\n\nWhen you call generate_persona_video for this recipe, pass recipe: "${slug}".`;
}

export function isRecipeSlug(value: unknown): value is string {
  return typeof value === 'string' && RECIPE_SLUG_PATTERN.test(value);
}

export class RecipeSession {
  readonly sessionId: string = randomUUID();
  private recipesListed = false;
  private lastRecipeFetched: string | null = null;
  private lastNudge: RecipeNudgeSurface | null = null;
  private scriptRejections = 0;

  constructor(readonly transport: McpTransportKind) {}

  /** True once the agent listed or fetched a recipe in this session. */
  knowsRecipes(): boolean {
    return this.recipesListed || this.lastRecipeFetched !== null;
  }

  recordNudgeShown(surface: RecipeNudgeSurface): void {
    this.lastNudge = surface;
  }

  recordRecipesListed(): void {
    this.recipesListed = true;
  }

  /** Call only after the API returned the recipe, so the slug is real. */
  recordRecipeFetched(slug: string): void {
    if (isRecipeSlug(slug)) this.lastRecipeFetched = slug;
  }

  recordScriptRejected(): void {
    this.scriptRejections = Math.min(this.scriptRejections + 1, MAX_SCRIPT_REJECTIONS);
  }

  /** Headers for the API requests of one call; recipe is that call's slug. */
  telemetryHeaders(recipe: unknown): Record<string, string> {
    const headers: Record<string, string> = {
      [MCP_SESSION_ID_HEADER]: this.sessionId,
      [MCP_TRANSPORT_HEADER]: this.transport,
      [MCP_NUDGED_BY_HEADER]: this.lastNudge ?? 'none',
      [MCP_RECIPES_KNOWN_HEADER]: String(this.knowsRecipes()),
      [MCP_RECIPE_FETCHED_HEADER]: this.lastRecipeFetched ?? 'none',
      [MCP_SCRIPT_REJECTIONS_HEADER]: String(this.scriptRejections),
    };
    if (isRecipeSlug(recipe)) headers[MCP_RECIPE_HEADER] = recipe;
    return headers;
  }

  /** Run one call with this session's headers on every API request it sends. */
  run<TResult>(recipe: unknown, call: () => Promise<TResult>): Promise<TResult> {
    return withTelemetryHeaders(() => this.telemetryHeaders(recipe), call);
  }
}

function withExtraText(response: McpToolResponse, text: string): McpToolResponse {
  return { ...response, content: [...response.content, { type: 'text', text }] };
}

//---------------
// Wrap an entry tool: its requests carry the session headers and, on
// success while the agent has not met the recipes yet, the nudge is
// appended as its own text block (the first block stays the tool's own
// payload, so JSON consumers keep parsing it).
//---------------
export function withRecipeNudge<TArgs>(
  session: RecipeSession,
  surface: RecipeNudgeSurface,
  handler: (args: TArgs) => Promise<McpToolResponse>,
): (args: TArgs) => Promise<McpToolResponse> {
  return async (args: TArgs): Promise<McpToolResponse> => {
    const response = await session.run(undefined, () => handler(args));
    if (response.isError === true || session.knowsRecipes()) {
      return response;
    }
    session.recordNudgeShown(surface);
    return withExtraText(response, RECIPE_NUDGE_TEXT);
  };
}

//---------------
// Wrap a script tool (validate_script, generate_persona_video): its
// requests carry the session headers plus the declared recipe; a script
// the mechanical validator rejects (no API request is sent then) bumps the
// session's rejection counter, which the next request reports, and gets
// the recipe hint unless a recipe is already in play. The classification
// re-runs the same pure validator the handler runs, so it never parses
// the handler's error text.
//---------------
export function withScriptOutcome<
  TArgs extends { segments: unknown; recipe?: string; videoType?: VideoType; options?: { videoType?: VideoType } },
>(
  session: RecipeSession,
  toolName: ScriptTool,
  handler: (args: TArgs) => Promise<McpToolResponse>,
): (args: TArgs) => Promise<McpToolResponse> {
  return async (args: TArgs): Promise<McpToolResponse> => {
    const response = await session.run(args.recipe, () => handler(args));
    const videoType = args.videoType ?? args.options?.videoType ?? 'hook_lipsync';
    if (response.isError !== true || validateSegments(args.segments, videoType).ok) {
      return response;
    }
    session.recordScriptRejected();
    if (args.recipe !== undefined || session.knowsRecipes()) {
      return response;
    }
    session.recordNudgeShown(toolName);
    return withExtraText(response, SCRIPT_REJECTED_RECIPE_HINT);
  };
}
