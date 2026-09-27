//---------------
// Bluesky (AT Protocol) — video posting with app password.
// No developer portal/OAuth: each user generates an app password in
// their own Bluesky account and we authenticate with handle + password via the SDK.
// Official limits: 1 video/post, MP4, ≤100MB, ≤3min, ≤25 videos/day,
// caption ≤300 graphemes (https://docs.bsky.app).
//---------------

//---------------
// AtpAgentCtor — minimal type of what we use from the SDK.
//---------------
type AtpLoginResponse = {
  success: boolean;
  data?: { did: string; handle?: string; accessJwt?: string };
};
type AtpAgentLike = {
  login: (args: { identifier: string; password: string }) => Promise<AtpLoginResponse>;
};

async function createAtpAgent(service: string): Promise<AtpAgentLike> {
  // The import stays dynamic so Vitest's ESM mocks keep working.
  const mod = (await import('@atproto/api')) as {
    AtpAgent: new (args: { service: string }) => AtpAgentLike;
  };
  return new mod.AtpAgent({ service });
}

export const BLUESKY_CAPTION_MAX_GRAPHEMES = 300;
export const BLUESKY_VIDEO_MAX_BYTES = 100_000_000;
export const BLUESKY_VIDEO_MAX_SECONDS = 180;

//---------------
// GraphemeSegmenter — Intl.Segmenter (ES2022) is outside the tsconfig libs;
// safe fallback via Intl v8 for environments without support.
//---------------
interface GraphemeSegmentData {
  segment: string;
}
interface GraphemeSegmenter {
  segment(input: string): Iterable<GraphemeSegmentData>;
}

function getGraphemeSegmenter(): GraphemeSegmenter {
  const intlSegmenter = (
    Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: string }) => GraphemeSegmenter }
  ).Segmenter;
  if (!intlSegmenter) {
    throw new BlueskyError('unknown', 'Intl.Segmenter is not available in this runtime.');
  }
  return new intlSegmenter('und', { granularity: 'grapheme' });
}

//---------------
// BlueskyError — errors with a classifiable cause for the UI/engine
//---------------
export class BlueskyError extends Error {
  readonly code:
    | 'invalid_credentials'
    | 'upload_failed'
    | 'processing_failed'
    | 'rate_limited'
    | 'email_not_verified'
    | 'post_failed'
    | 'unknown';

  constructor(code: BlueskyError['code'], message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'BlueskyError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

//---------------
// countBlueskyGraphemes — counts perceived graphemes (composed emoji = 1),
// not codepoints.
//---------------
export function countBlueskyGraphemes(text: string): number {
  const segmenter = getGraphemeSegmenter();
  let count = 0;
  for (const _ of segmenter.segment(text)) {
    count += 1;
  }
  return count;
}

//---------------
// truncateBlueskyCaption — truncates the caption at 300 graphemes + "…" without breaking
// an emoji in half (segments before slicing).
//---------------
export function truncateBlueskyCaption(caption: string): string {
  if (countBlueskyGraphemes(caption) <= BLUESKY_CAPTION_MAX_GRAPHEMES) {
    return caption;
  }
  const segmenter = getGraphemeSegmenter();
  const graphemes = Array.from(segmenter.segment(caption), (segment) => segment.segment);
  return graphemes.slice(0, BLUESKY_CAPTION_MAX_GRAPHEMES - 1).join('') + '…';
}

//---------------
// validateVideoForBluesky — validates MP4/size/duration before uploading
//---------------
export function validateVideoForBluesky(video: {
  sizeBytes: number;
  durationSeconds: number;
  mimeType: string;
}): { ok: true } | { ok: false; reason: string } {
  if (video.mimeType !== 'video/mp4') {
    return { ok: false, reason: 'Bluesky only accepts MP4 videos.' };
  }
  if (video.sizeBytes > BLUESKY_VIDEO_MAX_BYTES) {
    return { ok: false, reason: 'Bluesky video limit is 100MB.' };
  }
  if (video.durationSeconds > BLUESKY_VIDEO_MAX_SECONDS) {
    return { ok: false, reason: 'Bluesky video limit is 3 min.' };
  }
  return { ok: true };
}

//---------------
// loginToBluesky — validates handle + app password and returns the session.
// The password never appears in the error message.
//---------------
export async function loginToBluesky(
  handle: string,
  appPassword: string,
): Promise<{ did: string; handle: string }> {
  const session = await loginToBlueskySession(handle, appPassword);
  return { did: session.did, handle: session.handle };
}

//---------------
// loginToBlueskySession — creates the AT Protocol session reused by the account
// connection and by video publishing.
//---------------
export async function loginToBlueskySession(
  handle: string,
  appPassword: string,
): Promise<{ did: string; handle: string; accessJwt: string }> {
  const agent = await createAtpAgent('https://bsky.social');
  try {
    const response = await agent.login({
      identifier: handle,
      password: appPassword,
    });
    if (!response.success || !response.data?.did || !response.data.accessJwt) {
      throw new BlueskyError('invalid_credentials', 'Bluesky login failed.');
    }
    return { did: response.data.did, handle: response.data.handle ?? handle, accessJwt: response.data.accessJwt };
  } catch (error) {
    if (error instanceof BlueskyError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid identifier or password|authentication/i.test(message)) {
      throw new BlueskyError('invalid_credentials', 'Invalid Bluesky handle or app password.');
    }
    throw new BlueskyError('unknown', `Bluesky login failed: ${message}`, { cause: error });
  }
}
