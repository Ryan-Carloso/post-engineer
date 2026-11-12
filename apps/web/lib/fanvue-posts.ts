//---------------
// fanvue-posts — creates the post that attaches uploaded vault media.
//
// Verified against api.fanvue.com/docs/api-reference/create-a-new-post:
//   POST /posts { text, mediaUuids, audience }
// `audience` is required; this client always sends `subscribers`
// because Fanvue is an 18+ platform and we never create a public post.
// The response carries the new post's `uuid`.
//
// `text` has a 5000-character API ceiling. It is validated here and
// rejected, never truncated: the route that builds it (upload-content)
// must report the problem instead of publishing a cut-off caption.
//---------------

import { FanvueError } from '@/lib/errors';
import {
  FANVUE_API_BASE,
  fanvueFetch,
  jsonBearer,
  readOptionalString,
} from '@/lib/fanvue-http';

export const FANVUE_POST_TEXT_MAX_LENGTH = 5000;

export interface CreateFanvuePostInput {
  accessToken: string;
  mediaUuid: string;
  text: string;
}

export interface FanvuePublishResult {
  postId: string;
}

export async function createFanvuePost(
  input: CreateFanvuePostInput,
): Promise<FanvuePublishResult> {
  if (input.text.length > FANVUE_POST_TEXT_MAX_LENGTH) {
    throw new FanvueError(
      `FANVUE_PUBLISH_FAILED: text exceeds ${FANVUE_POST_TEXT_MAX_LENGTH} characters`,
      400,
    );
  }

  const body = await fanvueFetch('FANVUE_PUBLISH_FAILED', `${FANVUE_API_BASE}/posts`, {
    ...jsonBearer(input.accessToken),
    method: 'POST',
    body: JSON.stringify({
      text: input.text,
      mediaUuids: [input.mediaUuid],
      audience: 'subscribers',
    }),
  });

  const postId = readOptionalString(body, 'uuid');
  if (postId === null) throw new FanvueError('FANVUE_PUBLISH_FAILED: missing uuid', 502);
  return { postId };
}
