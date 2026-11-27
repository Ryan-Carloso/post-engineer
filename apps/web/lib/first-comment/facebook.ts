import { commentRequest, formBody, requireId } from './http';

const FACEBOOK_GRAPH_VERSION = 'v23.0';

export async function postFacebookFirstComment(input: {
  pageAccessToken: string;
  postId: string;
  text: string;
}): Promise<string> {
  const request = formBody({ message: input.text });
  const body = await commentRequest(
    'FACEBOOK_COMMENT_FAILED',
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(input.postId)}/comments`,
    { ...request, headers: { ...request.headers, Authorization: `Bearer ${input.pageAccessToken}` } },
  );
  return requireId('FACEBOOK_COMMENT_FAILED', body);
}
