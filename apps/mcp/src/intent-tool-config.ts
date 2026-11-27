import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { actionDescription, actionShape, byAction } from './action-tool.js';
import type { PostEngineerClient } from './client.js';
import { DESTRUCTIVE } from './tool-annotations.js';
import {
  GetToolConfigShape,
  SaveToolConfigShape,
  handleGetToolConfig,
  handleSaveToolConfig,
} from './tools-tool-config.js';

const TOOL_CONFIG_SPECS = {
  get: GetToolConfigShape,
  save: SaveToolConfigShape,
};

const ToolConfigDescription = actionDescription(
  'Saved research and stock tool configuration. get: which search tool (Tavily/Exa/own) and licensed stock sources (Pexels/Pixabay/Coverr) are saved for this account, each key as present + last 4 characters only — keys are never returned in full. save: replaces the whole saved configuration (search tool, stock sources, API keys); a key left out is forgotten, so send every key the user still has for the selected search tool and stock sources. Ask once at setup, save here, and check get before asking again.',
  TOOL_CONFIG_SPECS,
);

export function registerToolConfigTools(server: McpServer, client: PostEngineerClient): void {
  server.tool(
    'tool_config',
    ToolConfigDescription,
    actionShape(TOOL_CONFIG_SPECS),
    DESTRUCTIVE,
    byAction(
      {
        get: async () => handleGetToolConfig(client),
        save: async (args) => handleSaveToolConfig(client, args),
      },
      TOOL_CONFIG_SPECS,
      'tool_config',
    ),
  );
}
