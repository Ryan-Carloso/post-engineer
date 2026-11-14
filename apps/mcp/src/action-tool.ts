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

export type ActionSpecs = Record<string, z.ZodRawShape>;

type ActionArgs<TShape extends z.ZodRawShape> = z.infer<z.ZodObject<TShape>>;

export type ActionHandlers<TSpecs extends ActionSpecs> = {
  [TAction in keyof TSpecs]: (args: ActionArgs<TSpecs[TAction]>) => Promise<McpToolResponse>;
};

const ACTION_FIELD = 'action';

/** The flat advertised shape: `action` plus every field of every action, optional (first definition wins). */
export function actionShape(specs: ActionSpecs): z.ZodRawShape {
  const names = Object.keys(specs);
  if (names.length === 0) throw new Error('an action tool needs at least one action');
  const shape: z.ZodRawShape = {
    [ACTION_FIELD]: z.enum(names as [string, ...string[]]).describe(`What to do: ${names.join(' | ')}. The description lists the fields each action needs.`),
  };
  for (const spec of Object.values(specs)) {
    for (const [field, schema] of Object.entries(spec)) {
      if (field === ACTION_FIELD) throw new Error('an action cannot declare a field named "action"');
      if (!(field in shape)) shape[field] = schema.optional();
    }
  }
  return shape;
}

function requiredFields(spec: z.ZodRawShape): string[] {
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
  specs: TSpecs,
  tool: string,
): (args: Record<string, unknown>) => Promise<McpToolResponse> {
  const declared = Object.keys(specs);
  const implemented = Object.keys(handlers);
  const missing = declared.filter((action) => !implemented.includes(action));
  const extra = implemented.filter((action) => !declared.includes(action));
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
