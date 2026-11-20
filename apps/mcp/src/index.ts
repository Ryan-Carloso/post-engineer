#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostEngineerClient } from './client.js';
import { requireApiKey } from './require-api-key.js';
import { registerAccountTools } from './intent-accounts.js';
import { registerContentTools } from './intent-content.js';
import { registerLibraryTools } from './intent-library.js';
import { registerPersonaMediaTools, registerPersonaTools } from './intent-personas.js';
import { registerPromptLibraryTools } from './intent-prompt-library.js';
import { registerToolConfigTools } from './intent-tool-config.js';
import { registerVideoTools } from './intent-video.js';
import { registerVoiceTools } from './intent-voices.js';
import { parseHttpTransportOptions, serveHttpTransport } from './http-transport.js';
import { parseHttpAuthOptions } from './http-auth.js';
import { SERVER_INSTRUCTIONS, registerPromptTools, type McpTransportKind } from './tools-prompts.js';
import { registerRemotePrompts } from './prompts.js';

const { default: pkg } = await import('../package.json', { with: { type: 'json' } });

export { PostEngineerClient };
export { handleMcpWebRequest } from './http-web.js';

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
  registerToolConfigTools(server, apiClient);
  registerPromptLibraryTools(server, apiClient);
  registerLibraryTools(server, apiClient, recipeSession);
  registerContentTools(server, apiClient, recipeSession, remote);

  return server;
}

export function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export async function main() {
  const httpOptions = parseHttpTransportOptions(process.argv.slice(2), process.env);
  if (httpOptions !== null) {
    const authOptions = parseHttpAuthOptions(process.env);
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
