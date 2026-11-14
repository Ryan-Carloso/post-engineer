import { describe, expect, it } from 'vitest';
import { PostEngineerClient } from '../client.js';
import { createPostEngineerMcpServer } from '../index.js';
import { ESTIMATED_BYTES_PER_TOKEN, formatToolsListReport, listServerTools, summarizeTools } from '../tools-list-stats.js';

// Issue #566 phase 1: the `tools/list` payload is the number the tool
// consolidation has to shrink by at least 40%. These tests pin how it is
// measured, so a before/after comparison always counts the same bytes.

function tool(name: string, description: string) {
  return { name, description, inputSchema: { type: 'object' as const, properties: {} } };
}

describe('summarizeTools', () => {
  it('counts the bytes of the exact JSON the client receives', () => {
    const tools = [tool('a', 'x'), tool('bb', 'yyyy')];
    const summary = summarizeTools(tools);
    expect(summary.toolCount).toBe(2);
    expect(summary.totalBytes).toBe(Buffer.byteLength(JSON.stringify(tools), 'utf8'));
  });

  it('counts multi-byte characters as bytes, not characters', () => {
    const summary = summarizeTools([tool('a', 'ção')]);
    expect(summary.totalBytes).toBe(Buffer.byteLength(JSON.stringify([tool('a', 'ção')]), 'utf8'));
    expect(summary.totalBytes).toBeGreaterThan(JSON.stringify([tool('a', 'ção')]).length);
  });

  it('estimates tokens from bytes with the documented ratio, rounded up', () => {
    const summary = summarizeTools([tool('a', 'x')]);
    expect(summary.estimatedTokens).toBe(Math.ceil(summary.totalBytes / ESTIMATED_BYTES_PER_TOKEN));
  });

  it('ranks tools by their own serialized size, largest first, capped at topN', () => {
    const tools = [tool('small', 'x'), tool('large', 'x'.repeat(500)), tool('medium', 'x'.repeat(50))];
    const summary = summarizeTools(tools, 2);
    expect(summary.top.map((entry) => entry.name)).toEqual(['large', 'medium']);
    expect(summary.top[0].bytes).toBe(Buffer.byteLength(JSON.stringify(tools[1]), 'utf8'));
  });

  it('breaks size ties by name so the report is deterministic', () => {
    const summary = summarizeTools([tool('b', 'x'), tool('a', 'x')], 2);
    expect(summary.top.map((entry) => entry.name)).toEqual(['a', 'b']);
  });

  it('rejects a non-positive topN instead of returning an empty ranking', () => {
    expect(() => summarizeTools([tool('a', 'x')], 0)).toThrow(/topN/);
  });

  it('reports zero tools without dividing by anything', () => {
    const summary = summarizeTools([]);
    expect(summary).toMatchObject({ toolCount: 0, totalBytes: 2, top: [] });
  });
});

describe('formatToolsListReport', () => {
  it('prints the totals and one numbered line per ranked tool', () => {
    const report = formatToolsListReport(summarizeTools([tool('alpha', 'x'.repeat(20)), tool('beta', 'x')], 2));
    expect(report).toContain('tools: 2');
    expect(report).toMatch(/bytes: \d+/);
    expect(report).toMatch(/estimated tokens: \d+/);
    expect(report).toMatch(/1\. alpha\s+\d+/);
    expect(report).toMatch(/2\. beta\s+\d+/);
  });
});

describe('listServerTools', () => {
  it('lists the tools of a real server over an in-memory transport, as a client would see them', async () => {
    const server = createPostEngineerMcpServer(new PostEngineerClient({ apiKey: 'measure-only' }), 'stdio');
    const tools = await listServerTools(server);
    const names = tools.map((entry) => entry.name);
    expect(tools.length).toBeGreaterThan(30);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('generate_persona_video');
    // Each tool carries a usable input schema, which is what makes up most of the payload.
    for (const entry of tools) expect(entry.inputSchema.type).toBe('object');
  });

  it('lists the remote (http) tool set when asked, which differs from stdio', async () => {
    const stdio = await listServerTools(createPostEngineerMcpServer(new PostEngineerClient({ apiKey: 'measure-only' }), 'stdio'));
    const http = await listServerTools(createPostEngineerMcpServer(new PostEngineerClient({ apiKey: 'measure-only' }), 'http'));
    expect(http.map((entry) => entry.name)).not.toEqual(stdio.map((entry) => entry.name));
  });
});
