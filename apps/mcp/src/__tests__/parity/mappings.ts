import { z } from 'zod';
import { toolActionCallsEndpoint, toolCallsEndpoint, type McpCallGraph } from './mcp-calls.js';

//---------------
// Endpoint → tool mapping of the MCP parity gate (parity-endpoint-tools.json).
//
// Capability parity, not tool-per-endpoint (issue #566): an endpoint maps to
// `{ tool, action? }`, the intent tool (and, for an action tool, the action)
// that really issues the request. One action may reach several endpoints, an
// endpoint that is only a step of an intent is mapped to the action that
// calls it, and no endpoint needs a tool or an action of its own. What stays
// total is coverage: an endpoint nothing reaches, and that has no typed
// exclusion, fails.
//---------------

export const MappingEntrySchema = z
  .object({
    tool: z.string().min(1),
    /** Omitted for a tool without actions; required for a tool registered with byAction. */
    action: z.string().min(1).optional(),
  })
  .strict();

export const EndpointMappingSchema = z.record(z.string(), z.array(MappingEntrySchema).min(1));

export type MappingEntry = z.infer<typeof MappingEntrySchema>;
export type EndpointMapping = z.infer<typeof EndpointMappingSchema>;

/** Endpoint → distinct tool names behind it (what the exclusion verifier consumes). */
export function endpointToolNames(mapping: Readonly<EndpointMapping>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(mapping).map(([key, entries]) => [key, [...new Set(entries.map((entry) => entry.tool))]]),
  );
}

function label(entry: MappingEntry): string {
  return entry.action === undefined ? entry.tool : `${entry.tool} · ${entry.action}`;
}

/** Violations of the mapping of one endpoint; empty when every entry is true of the MCP sources. */
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

/** Discovered endpoints with neither a mapping nor an exclusion: coverage must stay total. */
export function uncoveredEndpoints(
  discovered: readonly string[],
  mapping: Readonly<Record<string, unknown>>,
  exclusions: Readonly<Record<string, unknown>>,
): string[] {
  return discovered.filter((key) => !(key in mapping) && !(key in exclusions));
}
