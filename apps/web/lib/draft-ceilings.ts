//---------------
// Draft ceilings — the per-provider documented text ceilings the draft
// scorer enforces. Extracted from lib/draft-scoring.ts (file-size
// ratchet): the scorer re-exports them, so existing import sites keep
// working. Rumble has no constant here on purpose: it has no documented
// description ceiling, and its 100-character title ceiling lives at the
// publish boundary instead (lib/rumble.ts, publish_rumble.py).
//---------------

// LinkedIn's documented standard-post ceiling (LinkedIn Help, via its
// public limits pages): a standard feed post holds at most 3000
// characters. Images, video and documents attached to the post do not
// consume characters.
export const LINKEDIN_POST_MAX_CHARS = 3000;
// Threads' documented text ceiling; lib/threads.ts and the engine pin the same value.
export const THREADS_POST_MAX_CHARS = 500;
// Facebook's documented feed-post ceiling; lib/facebook.ts and the engine pin the same value.
export const FACEBOOK_POST_MAX_CHARS = 63206;
// Pinterest PinCreate description ceiling; lib/pinterest.ts and the engine pin the same value.
export const PINTEREST_DESCRIPTION_MAX_CHARS = 800;
