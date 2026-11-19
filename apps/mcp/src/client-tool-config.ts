import type { PostEngineerClient } from './client.js';
import type { BodyOf, ResponseOf } from './contracts/endpoint.js';
import { parseContractResponse } from './contract-response.js';
import {
  getToolConfig as getToolConfigContract,
  saveToolConfig as saveToolConfigContract,
} from './contracts/tool-config.js';

//---------------
// Tool configuration (issue #669) — HTTP calls.
//
// The saved configuration answers which research tool (Tavily/Exa) and
// which licensed stock sources (Pexels/Pixabay/Coverr) the user has keys
// for. Both endpoints return presence only — never a key value.
//---------------

export async function getToolConfig(
  client: PostEngineerClient,
): Promise<ResponseOf<typeof getToolConfigContract>> {
  const raw = await client.request(
    '/api/tool-config',
    { method: 'GET', headers: client.getHeaders() },
    'get tool configuration',
  );
  return parseContractResponse(getToolConfigContract, raw);
}

export async function saveToolConfig(
  client: PostEngineerClient,
  config: BodyOf<typeof saveToolConfigContract>,
): Promise<ResponseOf<typeof saveToolConfigContract>> {
  const raw = await client.request(
    '/api/tool-config',
    {
      method: 'PUT',
      headers: client.getHeaders(),
      body: JSON.stringify(config),
    },
    'save tool configuration',
  );
  return parseContractResponse(saveToolConfigContract, raw);
}
