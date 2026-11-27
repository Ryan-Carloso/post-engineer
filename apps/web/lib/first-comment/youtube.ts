import { commentRequest, jsonBody } from './http';

const YOUTUBE_COMMENT_THREADS = 'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet';

export async function postYouTubeFirstComment(input: {
  accessToken: string;
  videoId: string;
  text: string;
}): Promise<string> {
  const body = await commentRequest(
    'YOUTUBE_COMMENT_FAILED',
    YOUTUBE_COMMENT_THREADS,
    jsonBody(
      { snippet: { videoId: input.videoId, topLevelComment: { snippet: { textOriginal: input.text } } } },
      { Authorization: `Bearer ${input.accessToken}` },
    ),
  );
  return typeof body.id === 'string' ? body.id : '';
}
