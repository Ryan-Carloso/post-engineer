import { LINKEDIN_API_VERSION } from '@/lib/linkedin';
import { FirstCommentError, commentRequest, jsonBody } from './http';

const LINKEDIN_API = 'https://api.linkedin.com';
const POST_URN_PATTERN = /^urn:li:(share|ugcPost):\d+$/;

export async function postLinkedInFirstComment(input: {
  accessToken: string;
  actorUrn: string;
  postUrn: string;
  text: string;
}): Promise<string> {
  if (!POST_URN_PATTERN.test(input.postUrn)) {
    throw new FirstCommentError('LINKEDIN_COMMENT_FAILED: the publish returned no post URN', 502);
  }
  const body = await commentRequest(
    'LINKEDIN_COMMENT_FAILED',
    `${LINKEDIN_API}/rest/socialActions/${encodeURIComponent(input.postUrn)}/comments`,
    jsonBody(
      { actor: input.actorUrn, message: { text: input.text } },
      {
        Authorization: `Bearer ${input.accessToken}`,
        'Linkedin-Version': LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    ),
  );
  return typeof body.commentUrn === 'string' ? body.commentUrn : '';
}
