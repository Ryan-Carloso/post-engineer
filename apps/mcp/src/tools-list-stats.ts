import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Measures the `tools/list` payload an agent loads into its context. Used by
// scripts/measure-tools-list.mjs, which is how the before/after numbers of
// the tool consolidation (issue #566) are recorded.

/** Rough ratio for English/JSON text; an estimate, not a tokenizer. */
export const ESTIMATED_BYTES_PER_TOKEN = 4;

export const DEFAULT_TOP_TOOLS = 10;

export interface ToolSize {
  name: string;
  bytes: number;
}

export interface ToolsListSummary {
  toolCount: number;
  /** UTF-8 bytes of the JSON array of tools, exactly as a client receives it. */
  totalBytes: number;
  estimatedTokens: number;
  /** Largest tools first, ties broken by name. */
  top: ToolSize[];
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function summarizeTools(tools: readonly Tool[], topN: number = DEFAULT_TOP_TOOLS): ToolsListSummary {
  if (!Number.isInteger(topN) || topN < 1) {
    throw new Error(`topN must be a positive integer, got ${String(topN)}`);
  }
  const totalBytes = byteLength(tools);
  const sizes = tools.map((entry): ToolSize => ({ name: entry.name, bytes: byteLength(entry) }));
  sizes.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return {
    toolCount: tools.length,
    totalBytes,
    estimatedTokens: Math.ceil(totalBytes / ESTIMATED_BYTES_PER_TOKEN),
    top: sizes.slice(0, topN),
  };
}

export function formatToolsListReport(summary: ToolsListSummary): string {
  const width = Math.max(0, ...summary.top.map((entry) => entry.name.length));
  const lines = [
    `tools: ${summary.toolCount}`,
    `bytes: ${summary.totalBytes}`,
    `estimated tokens: ${summary.estimatedTokens} (bytes / ${ESTIMATED_BYTES_PER_TOKEN}, not a tokenizer)`,
    `top ${summary.top.length} by schema bytes:`,
    ...summary.top.map((entry, index) => `  ${index + 1}. ${entry.name.padEnd(width)}  ${entry.bytes}`),
  ];
  return lines.join('\n');
}

/** Lists a server's tools through a real MCP client over an in-memory pair, as an agent would. */
export async function listServerTools(server: { connect(transport: Transport): Promise<void>; close(): Promise<void> }): Promise<Tool[]> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'measure-tools-list', version: '0.0.0' });
  await server.connect(serverSide);
  try {
    await client.connect(clientSide);
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor === undefined ? undefined : { cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
  } finally {
    await client.close();
    await server.close();
  }
}
