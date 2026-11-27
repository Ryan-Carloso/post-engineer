import { FirstCommentError, commentRequest, jsonBody } from './http';

const BSKY_SERVICE = 'https://bsky.social';

export interface BlueskyPostRef {
  uri: string;
  cid: string;
}

export async function postBlueskyFirstComment(input: {
  accessJwt: string;
  did: string;
  post: BlueskyPostRef;
  text: string;
}): Promise<string> {
  if (input.post.cid === '') throw new FirstCommentError('BLUESKY_COMMENT_FAILED: the publish returned no cid', 502);
  const body = await commentRequest(
    'BLUESKY_COMMENT_FAILED',
    `${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`,
    jsonBody(
      {
        repo: input.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: input.text,
          createdAt: new Date().toISOString(),
          reply: { root: input.post, parent: input.post },
        },
      },
      { Authorization: `Bearer ${input.accessJwt}` },
    ),
  );
  return typeof body.uri === 'string' ? body.uri : '';
}
