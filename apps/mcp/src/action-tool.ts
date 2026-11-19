import { z } from 'zod';
import { withToolCall } from './analytics.js';
import type { McpToolResponse } from './tools-call.js';

export type ActionShape = Record<string, z.ZodType>;
export type ActionSpecs = Record<string, ActionShape>;

type ActionArgs<TShape extends ActionShape> = z.infer<z.ZodObject<TShape>>;

export type ActionHandlers<TSpecs extends ActionSpecs> = {
  [TAction in keyof TSpecs]: (args: ActionArgs<TSpecs[TAction]>) => Promise<McpToolResponse>;
};

const ACTION_FIELD = 'action';

export interface ActionOptions<TSpecs extends ActionSpecs> {
  unavailable?: readonly (keyof TSpecs)[];
  variants?: Partial<Record<keyof TSpecs, ActionShape>>;
}

export function offeredSpecs<TSpecs extends ActionSpecs>(specs: TSpecs, options: ActionOptions<TSpecs> = {}): ActionSpecs {
  const unavailable: readonly PropertyKey[] = options.unavailable ?? [];
  return Object.fromEntries(
    Object.entries(specs)
      .filter(([action]) => !unavailable.includes(action))
      .map(([action, shape]): [string, ActionShape] => [action, options.variants?.[action] ?? shape]),
  );
}

function advertised(schema: z.ZodType): z.ZodType {
  if (!(schema instanceof z.ZodDefault)) return schema.optional();
  const optional = z.optional(schema.unwrap());
  return schema.description === undefined ? optional : optional.describe(schema.description);
}

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
