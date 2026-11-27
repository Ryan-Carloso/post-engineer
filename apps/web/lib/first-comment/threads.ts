import { commentRequest, formBody, requireId } from './http';

const THREADS_GRAPH = 'https://graph.threads.com/v1.0';

export async function postThreadsFirstComment(input: {
  accessToken: string;
  userId: string;
  postId: string;
  text: string;
}): Promise<string> {
  const graphUser = `${THREADS_GRAPH}/${encodeURIComponent(input.userId)}`;
  const container = await commentRequest(
    'THREADS_REPLY_FAILED',
    `${graphUser}/threads`,
    formBody({
      media_type: 'TEXT',
      text: input.text,
      reply_to_id: input.postId,
      access_token: input.accessToken,
    }),
  );
  const creationId = requireId('THREADS_REPLY_FAILED', container);
  const published = await commentRequest(
    'THREADS_REPLY_FAILED',
    `${graphUser}/threads_publish`,
    formBody({ creation_id: creationId, access_token: input.accessToken }),
  );
  return requireId('THREADS_REPLY_FAILED', published);
}
