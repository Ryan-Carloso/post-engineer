import { commentRequest, formBody, requireId } from './http';

const INSTAGRAM_GRAPH_VERSION = 'v23.0';

export async function postInstagramFirstComment(input: {
  accessToken: string;
  mediaId: string;
  text: string;
}): Promise<string> {
  const body = await commentRequest(
    'INSTAGRAM_COMMENT_FAILED',
    `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/${encodeURIComponent(input.mediaId)}/comments`,
    formBody({ message: input.text, access_token: input.accessToken }),
  );
  return requireId('INSTAGRAM_COMMENT_FAILED', body);
}
