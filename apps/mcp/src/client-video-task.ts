import type { PostEngineerClient } from './client.js';

//---------------
// DELETE /api/persona/video-task/[taskId] — cancel/remove an engine task.
// Standalone function (not a client method) because client.ts is
// grandfathered over the 500-line cap and may not grow.
//---------------

export async function cancelVideoTask(
  client: PostEngineerClient,
  taskId: string,
): Promise<unknown> {
  return client.request(
    `/api/persona/video-task/${encodeURIComponent(taskId)}`,
    { method: 'DELETE', headers: client.getHeaders() },
    'cancel video task',
  );
}
