//---------------
// publish-checks — the blocking publish gate, per network.
//
// Extracted from lib/draft-scoring.ts (file-size ratchet): the scorer
// re-exports checkPublish and its ceilings, so existing import sites keep
// working.
//
// Only platform-enforced facts block: an empty draft everywhere, plus
// the network's own ceiling where this repo has evidence for it
// (LinkedIn 3000 chars, Threads 500 chars, Bluesky 300 graphemes — the
// Bluesky publisher truncates past its cap, so an over-long draft would
// be cut, not posted whole). Everything else is a warning: real
// guidance, but the platform accepts the post, so the gate must not
// pretend otherwise. YouTube/Instagram ceilings are warnings only: no
// in-repo publisher cap exists for them, so a block would be invented.
//---------------

import type { PublishNetwork } from '@/lib/contracts/videos';
import { BLUESKY_CAPTION_MAX_GRAPHEMES, countBlueskyGraphemes } from './bluesky';
import {
  FACEBOOK_POST_MAX_CHARS,
  LINKEDIN_POST_MAX_CHARS,
  PINTEREST_DESCRIPTION_MAX_CHARS,
  THREADS_POST_MAX_CHARS,
} from './draft-ceilings';
import { countChars, extractHashtags, extractLinks } from './draft-text';

// Rumble has no documented description ceiling, so the publish check has
// no failure branch for it — the 100-character title ceiling lives at the
// publish boundary instead (lib/rumble.ts, publish_rumble.py). Fanvue has
// no documented caption ceiling either, so it also takes the default
// branch: no failure branch, nothing invented.
// The feed shows roughly the first 210 characters on desktop (~140 on
// mobile) before the "see more" fold: a first line longer than this is
// a warning, never a failure — the fold is a display cut, not a cap.
export const LINKEDIN_SEE_MORE_FOLD_CHARS = 210;
// YouTube and Instagram have no text cap in this repo's publishing
// code, so their ceilings below are the platforms' documented limits
// (YouTube video descriptions, Instagram captions) and are warnings
// only — never invented blocks. Only caps with in-repo evidence
// (LinkedIn, Bluesky, Threads, Facebook, Pinterest) fail the check; 3Speak and Fanvue have no documented post-body cap, so they have no case here.
export const YOUTUBE_DESCRIPTION_MAX_CHARS = 5000;
export const INSTAGRAM_CAPTION_MAX_CHARS = 2200;

export interface PublishCheck {
  network: PublishNetwork;
  ok: boolean;
  failures: string[];
  warnings: string[];
}

type PublishCheckRun = (draft: string, chars: number, failures: string[], warnings: string[]) => void;

// One check per network (a record, not a chain): a new network fails the
// typecheck until it has an entry. Networks with no platform ceiling
// (3Speak, Rumble, Fanvue) have explicit no-op entries.
const PUBLISH_CHECKS: Record<PublishNetwork, PublishCheckRun> = {
  linkedin: (draft, chars, failures, warnings) => {
    if (chars > LINKEDIN_POST_MAX_CHARS) {
      failures.push(
        `Draft is ${chars} characters, over the LinkedIn ${LINKEDIN_POST_MAX_CHARS}-character post limit.`,
      );
    }
    const hashtags = extractHashtags(draft);
    if (hashtags.length > 10) {
      warnings.push(
        `Draft has ${hashtags.length} hashtags; posts with more than 10 read as spam.`,
      );
    }
    const links = extractLinks(draft);
    if (links.length > 0) {
      warnings.push(
        'Draft has a link in the body; LinkedIn demotes link posts — put the link in the first comment instead.',
      );
    }
    const firstLine = draft.split('\n').find((line) => line.trim().length > 0) ?? '';
    if (countChars(firstLine) > LINKEDIN_SEE_MORE_FOLD_CHARS) {
      warnings.push(
        `First line is ${countChars(firstLine)} characters, past the ~${LINKEDIN_SEE_MORE_FOLD_CHARS}-character see-more fold — the hook may be cut in the feed.`,
      );
    }
  },
  bluesky: (draft, _chars, failures) => {
    const graphemes = countBlueskyGraphemes(draft);
    if (graphemes > BLUESKY_CAPTION_MAX_GRAPHEMES) {
      failures.push(
        `Draft is ${graphemes} graphemes, over the Bluesky ${BLUESKY_CAPTION_MAX_GRAPHEMES}-grapheme caption limit — the caption would be cut.`,
      );
    }
  },
  threads: (_draft, chars, failures) => {
    if (chars > THREADS_POST_MAX_CHARS) {
      failures.push(
        `Draft is ${chars} characters, over the Threads ${THREADS_POST_MAX_CHARS}-character post limit.`,
      );
    }
  },
  facebook: (_draft, chars, failures) => {
    if (chars > FACEBOOK_POST_MAX_CHARS) {
      failures.push(
        `Draft is ${chars} characters, over the Facebook ${FACEBOOK_POST_MAX_CHARS}-character post limit.`,
      );
    }
  },
  pinterest: (_draft, chars, failures) => {
    if (chars > PINTEREST_DESCRIPTION_MAX_CHARS) {
      failures.push(`Draft is ${chars} characters, over the Pinterest ${PINTEREST_DESCRIPTION_MAX_CHARS}-character description limit.`);
    }
  },
  youtube: (_draft, chars, _failures, warnings) => {
    if (chars > YOUTUBE_DESCRIPTION_MAX_CHARS) {
      warnings.push(
        `Draft is ${chars} characters, over YouTube's ${YOUTUBE_DESCRIPTION_MAX_CHARS}-character description limit — the description would be cut.`,
      );
    }
  },
  instagram: (_draft, chars, _failures, warnings) => {
    if (chars > INSTAGRAM_CAPTION_MAX_CHARS) {
      warnings.push(
        `Draft is ${chars} characters, over Instagram's ${INSTAGRAM_CAPTION_MAX_CHARS}-character caption limit — the caption would be cut.`,
      );
    }
  },
  '3speak': () => {},
  rumble: () => {},
  fanvue: () => {},
};

export function checkPublish(draft: string, network: PublishNetwork): PublishCheck {
  const failures: string[] = [];
  const warnings: string[] = [];
  const chars = countChars(draft);
  if (draft.trim().length === 0) {
    failures.push('Draft is empty.');
  }
  PUBLISH_CHECKS[network](draft, chars, failures, warnings);
  return { network, ok: failures.length === 0, failures, warnings };
}
