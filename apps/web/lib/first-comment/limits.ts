import { countBlueskyGraphemes } from '@/lib/bluesky';
import type { CommentProvider } from '@/lib/contracts/providers';

const characters = (text: string): number => text.length;

export const FIRST_COMMENT_MAX: Record<CommentProvider, number> = {
  youtube: 10_000,
  instagram: 2_200,
  bluesky: 300,
  linkedin: 1_250,
  threads: 500,
  facebook: 8_000,
  telegram: 4_096,
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
