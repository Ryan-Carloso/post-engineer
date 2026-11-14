#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostEngineerClient } from './client.js';
import { registerAccountTools } from './intent-accounts.js';
import { registerContentTools } from './intent-content.js';
import { registerLibraryTools } from './intent-library.js';
import { registerPersonaMediaTools, registerPersonaTools } from './intent-personas.js';
import { registerVideoTools } from './intent-video.js';
import { registerVoiceTools } from './intent-voices.js';
import { parseHttpTransportOptions, serveHttpTransport } from './http-transport.js';
import { parseHttpAuthOptions } from './http-auth.js';
import { SERVER_INSTRUCTIONS, registerPromptTools, type McpTransportKind } from './tools-prompts.js';
import { registerRemotePrompts } from './prompts.js';

// The server advertises the package version: import it so a version bump in
// package.json flows through without touching this file.
const { default: pkg } = await import('../package.json', { with: { type: 'json' } });

export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = env.POST_ENGINEER_API_KEY;
  if (!apiKey) {
    throw new Error('POST_ENGINEER_API_KEY is required');
  }
  return apiKey;
}

//---------------
// The tools are intent tools (issue #566), not one tool per endpoint: 16
// tools, most with an `action`. Each tools module registers its own, next to
// its shapes and handlers; tools that read a file from the disk offer those
// actions only on the stdio server, where the disk is the agent's own
// machine (a path served over HTTP would resolve on the MCP server's host).
//---------------
export function createPostEngineerMcpServer(client?: PostEngineerClient, transport: McpTransportKind = 'stdio'): McpServer {
  const apiClient = client ?? new PostEngineerClient({ apiKey: requireApiKey() });
  const server = new McpServer(
    {
      name: 'post-engineer-mcp',
      version: pkg.version,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const remote = transport === 'http';
  registerRemotePrompts(server, apiClient);
  const recipeSession = registerPromptTools(server, apiClient, transport);

  registerVideoTools(server, apiClient, recipeSession);
  registerPersonaTools(server, apiClient, recipeSession, remote);
  registerPersonaMediaTools(server, apiClient, remote);
  registerVoiceTools(server, apiClient, remote);
  registerAccountTools(server, apiClient, recipeSession);
  registerLibraryTools(server, apiClient, recipeSession);
  registerContentTools(server, apiClient, recipeSession, remote);

  return server;
}

export function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // Realpath both sides: the published bin is launched through a symlinked
    // .bin entry, and Node may keep the symlink path in either argv[1] or
    // import.meta.url — realpathing both makes the comparison robust either way.
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export async function main() {
  // Without --http-transport the server stays on stdio, no port; with OAuth, HTTP requests authenticate, else loopback only.
  const httpOptions = parseHttpTransportOptions(process.argv.slice(2), process.env);
  if (httpOptions !== null) {
    // HTTP-only parse: stdio startup must never fail on a malformed HTTP limit.
    const authOptions = parseHttpAuthOptions(process.env);
    // OAuth mode needs no local key; loopback mode still fails fast without one.
    // Fresh server per request; the bearer is forwarded as this request's web API credential.
    const apiKey = authOptions !== null ? process.env.POST_ENGINEER_API_KEY : requireApiKey();
    await serveHttpTransport(
      (auth) => createPostEngineerMcpServer(new PostEngineerClient({ apiKey: auth?.bearer ?? apiKey, suppressVersionHeader: true }), 'http'),
      httpOptions,
      authOptions,
    );
    return;
  }
  const server = createPostEngineerMcpServer(new PostEngineerClient({ apiKey: requireApiKey() }));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule()) {
  main().catch((err) => {
    console.error('Fatal MCP Server error:', err);
    process.exit(1);
  });
}
