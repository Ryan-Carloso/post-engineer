import { z } from 'zod';
import { withToolCall } from './analytics.js';
import type { McpToolResponse } from './tools-call.js';

//---------------
// Action tools (issue #566): one MCP tool is a complete abstraction of an
// intent, with one action per thing the agent can do inside it.
//
// - The advertised input schema is ONE flat object: a required `action` enum
//   plus every field of every action, optional. A root-level union is not an
//   option: `tools/list` would advertise no fields at all (measured on the
//   SDK in use). actionDescription() lists the required fields of each
//   action so the agent can tell them apart in the flat schema.
// - The handler re-parses the arguments with the strict schema of the chosen
//   action, so a field of another action, a missing required field or an
//   out-of-range value fails loudly, naming the tool, the action and the
//   field, before any request is sent.
// - registration reads `byAction({ list: handleList, … }, SPECS, 'tool')`:
//   the object literal is what the parity gate parses to prove which request
//   each action sends (apps/mcp/src/__tests__/parity/mcp-calls.ts).
//---------------

export type ActionShape = Record<string, z.ZodType>;
export type ActionSpecs = Record<string, ActionShape>;

type ActionArgs<TShape extends ActionShape> = z.infer<z.ZodObject<TShape>>;

export type ActionHandlers<TSpecs extends ActionSpecs> = {
  [TAction in keyof TSpecs]: (args: ActionArgs<TSpecs[TAction]>) => Promise<McpToolResponse>;
};

const ACTION_FIELD = 'action';

/**
 * Server-specific differences of one tool: `unavailable` actions are not
 * offered (a local-file action on the remote server) and `variants` replace
 * the field set of an action (an audioUrl-only create on the remote server).
 * The handlers literal of byAction still names every action, so the parity
 * gate sees the endpoint each one reaches.
 */
export interface ActionOptions<TSpecs extends ActionSpecs> {
  unavailable?: readonly (keyof TSpecs)[];
  variants?: Partial<Record<keyof TSpecs, ActionShape>>;
}

/** The specs this server offers: without the unavailable actions, with the variant shapes. */
export function offeredSpecs<TSpecs extends ActionSpecs>(specs: TSpecs, options: ActionOptions<TSpecs> = {}): ActionSpecs {
  const unavailable: readonly PropertyKey[] = options.unavailable ?? [];
  return Object.fromEntries(
    Object.entries(specs)
      .filter(([action]) => !unavailable.includes(action))
      .map(([action, shape]): [string, ActionShape] => [action, options.variants?.[action] ?? shape]),
  );
}

/**
 * The field as the flat shape advertises it: optional and WITHOUT its default.
 * The SDK parses the arguments with the flat shape before byAction runs; a
 * default there would fill the field of an action that does not have it and
 * the strict per-action parse would reject it. The default still applies, from
 * the field's own action schema.
 */
function advertised(schema: z.ZodType): z.ZodType {
  if (!(schema instanceof z.ZodDefault)) return schema.optional();
  const optional = z.optional(schema.unwrap());
  return schema.description === undefined ? optional : optional.describe(schema.description);
}

/** The flat advertised shape: `action` plus every field of every action, optional (first definition wins). */
export function actionShape(specs: ActionSpecs): ActionShape {
  const names = Object.keys(specs);
  if (names.length === 0) throw new Error('an action tool needs at least one action');
  const shape: ActionShape = {
    [ACTION_FIELD]: z.enum(names as [string, ...string[]]).describe(`What to do: ${names.join(' | ')}. The description lists the fields each action needs.`),
  };
  for (const spec of Object.values(specs)) {
    for (const [field, schema] of Object.entries(spec)) {
      if (field === ACTION_FIELD) throw new Error('an action cannot declare a field named "action"');
      if (!(field in shape)) shape[field] = advertised(schema);
    }
  }
  return shape;
}

function requiredFields(spec: ActionShape): string[] {
  return Object.entries(spec)
    .filter(([, schema]) => !schema.safeParse(undefined).success)
    .map(([field]) => field);
}

/** `base` plus one line naming the required fields of each action. */
export function actionDescription(base: string, specs: ActionSpecs): string {
  const lines = Object.entries(specs).map(([action, spec]) => {
    const required = requiredFields(spec);
    return required.length === 0 ? `${action} (no required fields)` : `${action} (${required.join(', ')})`;
  });
  return `${base}\nActions and their required fields: ${lines.join('; ')}.`;
}

function errorResponse(message: string): McpToolResponse {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * The MCP callback of an action tool. Each call runs inside a tracked tool
 * call naming the tool and the action; the arguments are validated against
 * the strict schema of the chosen action before the handler runs.
 */
export function byAction<TSpecs extends ActionSpecs>(
  handlers: ActionHandlers<TSpecs>,
  allSpecs: TSpecs,
  tool: string,
  options: ActionOptions<TSpecs> = {},
): (args: Record<string, unknown>) => Promise<McpToolResponse> {
  const unavailable: readonly string[] = (options.unavailable ?? []).map(String);
  const specs = offeredSpecs(allSpecs, options);
  const declared = Object.keys(specs);
  const implemented = Object.keys(handlers);
  const missing = declared.filter((action) => !implemented.includes(action));
  const extra = implemented.filter((action) => !declared.includes(action) && !unavailable.includes(action));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${tool}: handlers and specs differ (missing handlers: ${missing.join(', ') || 'none'}; handlers without a spec: ${extra.join(', ') || 'none'})`);
  }
  const schemas = new Map(declared.map((action) => [action, z.object(specs[action]).strict()]));
  const handlerOf = new Map<string, (args: never) => Promise<McpToolResponse>>(
    declared.map((action) => [action, handlers[action as keyof TSpecs] as (args: never) => Promise<McpToolResponse>]),
  );

  return async (args: Record<string, unknown>): Promise<McpToolResponse> => {
    const { [ACTION_FIELD]: action, ...fields } = args;
    const schema = typeof action === 'string' ? schemas.get(action) : undefined;
    const handler = typeof action === 'string' ? handlerOf.get(action) : undefined;
    if (typeof action !== 'string' || schema === undefined || handler === undefined) {
      return errorResponse(`Error in ${tool}: unknown action ${JSON.stringify(action)}. Use one of: ${declared.join(', ')}.`);
    }
    const parsed = schema.safeParse(fields);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(input)'}: ${issue.message}`).join('; ');
      return errorResponse(`Error in ${tool} · ${action}: ${problems}`);
    }
    return withToolCall(tool, action, () => handler(parsed.data as never));
  };
}
