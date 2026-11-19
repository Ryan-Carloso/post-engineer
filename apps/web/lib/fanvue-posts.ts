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
