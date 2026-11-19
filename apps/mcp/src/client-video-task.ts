import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import { cancelVideoTask as cancelVideoTaskContract } from './contracts/video-tasks.js';
import type { ResponseOf } from './contracts/endpoint.js';

export async function cancelVideoTask(
  client: PostEngineerClient,
  taskId: string,
): Promise<ResponseOf<typeof cancelVideoTaskContract>> {
  const raw = await client.request(
    `/api/persona/video-task/${encodeURIComponent(taskId)}`,
    { method: 'DELETE', headers: client.getHeaders() },
    'cancel video task',
  );
  return parseContractResponse(cancelVideoTaskContract, raw);
}
