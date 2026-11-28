import { z } from 'zod';
import { toolActionCallsEndpoint, toolCallsEndpoint, type McpCallGraph } from './mcp-calls.js';

export const MappingEntrySchema = z
  .object({
    tool: z.string().min(1),
    action: z.string().min(1).optional(),
  })
  .strict();

export const EndpointMappingSchema = z.record(z.string(), z.array(MappingEntrySchema).min(1));

export type MappingEntry = z.infer<typeof MappingEntrySchema>;
export type EndpointMapping = z.infer<typeof EndpointMappingSchema>;

export function endpointToolNames(mapping: Readonly<EndpointMapping>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(mapping).map(([key, entries]) => [key, [...new Set(entries.map((entry) => entry.tool))]]),
  );
}

function label(entry: MappingEntry): string {
  return entry.action === undefined ? entry.tool : `${entry.tool} · ${entry.action}`;
}

export function verifyMapping(key: string, entries: readonly MappingEntry[], graph: McpCallGraph): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = label(entry);
    if (seen.has(name)) errors.push(`${key}: ${name} is listed twice`);
    seen.add(name);

    if (!graph.tools.includes(entry.tool)) {
      errors.push(`${key}: ${entry.tool} is not registered in the MCP server`);
      continue;
    }
    const actions = graph.toolActions.get(entry.tool);
    if (entry.action === undefined) {
      if (actions !== undefined) {
        errors.push(`${key}: ${entry.tool} is an action tool (${[...actions.keys()].join(', ')}); map { tool, action } so the action that reaches the endpoint is proven`);
      } else if (!toolCallsEndpoint(graph, entry.tool, key)) {
        errors.push(`${key}: ${entry.tool} never calls ${key}`);
      }
      continue;
    }
    if (actions === undefined) {
      errors.push(`${key}: ${entry.tool} has no actions, so ${name} cannot be proven (drop the action)`);
    } else if (!actions.has(entry.action)) {
      errors.push(`${key}: ${entry.tool} has no action "${entry.action}" (it has ${[...actions.keys()].join(', ')})`);
    } else if (!toolActionCallsEndpoint(graph, entry.tool, entry.action, key)) {
      errors.push(`${key}: ${entry.tool} action "${entry.action}" never calls ${key}`);
    }
  }
  return errors;
}

export function uncoveredEndpoints(
  discovered: readonly string[],
  mapping: Readonly<Record<string, unknown>>,
  exclusions: Readonly<Record<string, unknown>>,
): string[] {
  return discovered.filter((key) => !(key in mapping) && !(key in exclusions));
}
