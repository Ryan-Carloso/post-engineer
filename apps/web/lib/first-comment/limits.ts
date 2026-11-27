import { BLUESKY_CAPTION_MAX_GRAPHEMES, countBlueskyGraphemes } from '@/lib/bluesky';
import { TELEGRAM_MESSAGE_MAX_LENGTH } from '@/lib/telegram';
import { THREADS_TEXT_MAX_CHARS } from '@/lib/threads';
import type { CommentProvider } from '@/lib/contracts/providers';

const characters = (text: string): number => text.length;

export const FIRST_COMMENT_MAX: Record<CommentProvider, number> = {
  youtube: 10_000,
  instagram: 2_200,
  bluesky: BLUESKY_CAPTION_MAX_GRAPHEMES,
  linkedin: 1_250,
  threads: THREADS_TEXT_MAX_CHARS,
  facebook: 8_000,
  telegram: TELEGRAM_MESSAGE_MAX_LENGTH,
};

const MEASURE: Record<CommentProvider, (text: string) => number> = {
  youtube: characters,
  instagram: characters,
  bluesky: countBlueskyGraphemes,
  linkedin: characters,
  threads: characters,
  facebook: characters,
  telegram: characters,
};

export function exceedsFirstCommentLimit(provider: CommentProvider, text: string): boolean {
  return MEASURE[provider](text) > FIRST_COMMENT_MAX[provider];
}
