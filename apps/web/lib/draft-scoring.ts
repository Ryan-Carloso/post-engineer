//---------------
// draft-scoring — mechanical draft scoring.
//
// No LLM, no paid service, no external call: every signal is computed
// from the draft text itself plus the caller's own stored post metrics.
// The score is never a bare number: every rule that moves it appears in
// `reasons` with the exact detail that fired, so the caller can fix the
// draft instead of guessing what the number means. The per-network
// publish gate lives in lib/publish-checks.ts and is re-exported here.
//
// Baseline honesty: post_metrics rows carry counters and script angles,
// never the post text, so theme adherence is token overlap between the
// draft and the user's top angles — a soft signal, not a claim that the
// draft copies a past post. When the user has no measured posts yet,
// the theme bucket scores 0 and says so; it never invents a baseline.
//---------------

import type { PublishNetwork } from '@/lib/contracts/videos';

// The networks Post Engineer publishes to (post_metrics.provider
// check constraint, re-created with the full list by the latest provider
// migration, 053). The scorer buckets are universal;
// only the publish check varies by network.
export type { PublishNetwork };

// What the text is: a post body, or a video script (segments joined by
// newlines, hook first, then content takes). A script is spoken, so hashtags do not
// apply and the caption publish check would be vacuous.
export type DraftKind = 'post' | 'script';

// Script ranges mirror the segments contract (hook 25-40 words, 60-200 in
// total). The freed hashtag points go to hook, length and slop, so both
// profiles still top out at exactly 100.
const SCORE_PROFILES = {
  post: { hook: 20, hookWords: [3, 30], length: 15, words: [40, 400], nearWords: [20, 600], slop: 20 },
  script: { hook: 25, hookWords: [25, 40], length: 20, words: [60, 200], nearWords: [40, 250], slop: 25 },
} as const;


import { countChars, extractHashtags, extractLinks } from './draft-text';
import { checkPublish } from './publish-checks';
import type { PublishCheck } from './publish-checks';
export { DRAFT_KINDS, DRAFT_MAX_INPUT_CHARS, PUBLISH_NETWORKS } from '@/lib/contracts/videos';
export { LINKEDIN_POST_MAX_CHARS, THREADS_POST_MAX_CHARS, FACEBOOK_POST_MAX_CHARS, PINTEREST_DESCRIPTION_MAX_CHARS } from './draft-ceilings';
export {
  checkPublish,
  INSTAGRAM_CAPTION_MAX_CHARS,
  LINKEDIN_SEE_MORE_FOLD_CHARS,
  YOUTUBE_DESCRIPTION_MAX_CHARS,
} from './publish-checks';
export type { PublishCheck } from './publish-checks';
// The route rejects drafts over this input cap with a 400 instead of
// silently truncating (repo rule: never silently truncate/coerce).
// Bound the baseline fan-out: one capped metrics read per score call.
export const BASELINE_ROW_LIMIT = 200;

// Curated AI-slop markers (humanizer/anti-slop list). Each marker is
// matched case-insensitively on word boundaries where it is a phrase;
// the em dash is a character check. The list is deliberately short:
// a marker here must be near-certain filler, not a word real posts use.
export const SLOP_MARKERS = [
  'delve',
  'moreover',
  'furthermore',
  'additionally',
  'in conclusion',
  'ultimately',
  'crucial',
  'tapestry',
  "in today's fast-paced world",
  "it's important to note",
  'game-changer',
  'game changer',
  'unlock',
  'elevate',
  'ever-evolving',
  'seamless',
  'next-level',
  'have you ever wondered',
  'did you know',
  "let's dive in",
  "here's the thing",
  'a new era',
] as const;

export interface DraftScoreReason {
  rule: string;
  detail: string;
  points: number;
}

export interface TopAngle {
  angle: string;
  engagement: number;
  posts: number;
}

export interface DraftBaseline {
  postsMeasured: number;
  topAngles: TopAngle[];
  medianEngagement: number | null;
  bestEngagement: number | null;
  // True when the capped read left rows out, so the numbers above describe
  // only the most recent BASELINE_ROW_LIMIT snapshots.
  truncated: boolean;
}

export interface BaselineRow {
  scriptAngle: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
}

export interface DraftCounts {
  chars: number;
  words: number;
  hashtags: number;
  links: number;
  firstLineWords: number;
  slopHits: string[];
  topThemeMatch: string | null;
}

export interface DraftScore {
  score: number;
  reasons: DraftScoreReason[];
  counts: DraftCounts;
  baseline: DraftBaseline;
  // Null for a script: caption limits do not apply to spoken text.
  publishCheck: PublishCheck | null;
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  return text.trim().length === 0 ? 0 : words.length;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you',
  'are', 'was', 'were', 'have', 'has', 'about', 'into', 'over', 'after',
  'before', 'when', 'what', 'which', 'their', 'them', 'they', 'then',
  'than', 'also', 'just', 'like', 'more', 'most', 'other', 'some',
  // Portuguese (the product's default locale).
  'para', 'como', 'mais', 'pela', 'pelo', 'pelas', 'pelos', 'esse', 'essa',
  'isso', 'este', 'esta', 'isto', 'aqui', 'quando', 'sobre', 'entre',
  'muito', 'muita', 'você', 'vocês', 'suas', 'seus', 'nosso', 'nossa',
  'depois', 'antes', 'ainda', 'porque', 'também', 'foram', 'será', 'está',
]);

function themeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  // Unicode-aware: an ASCII split would cut "manhãs" into "manh" and "s".
  for (const raw of text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 4 && !STOPWORDS.has(raw)) tokens.add(raw);
  }
  return tokens;
}

function findSlopHits(text: string): string[] {
  const hits: string[] = [];
  if (text.includes('—')) hits.push('em dash');
  // Padded word search instead of an interpolated RegExp (repo rule):
  // punctuation is flattened to spaces, so ' delve ' only matches the
  // whole word, and multi-word markers match as whole phrases. Typographic
  // apostrophes fold to ASCII first, or "it’s" would never match "it's".
  const flat = ` ${text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const marker of SLOP_MARKERS) {
    if (flat.includes(` ${marker} `)) hits.push(marker);
  }
  return hits;
}

// Imperatives only count at the start of a sentence ("Read the guide"), so
// a statement like "I read this on Sunday" is not a call to action.
const CTA_IMPERATIVES = [
  'comment', 'share', 'follow', 'subscribe', 'download', 'read', 'try',
  'join', 'save',
  'comente', 'compartilhe', 'siga', 'inscreva', 'baixe', 'leia',
  'experimente', 'participe', 'salve',
];
// Phrases are specific enough to count anywhere in the line.
const CTA_PHRASES = [
  'check out', 'tell me', 'let me know', 'leave a comment', 'drop a comment',
  'me conta', 'me diga', 'deixe um comentário', 'deixe seu comentário',
];

function flattenWords(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}]+/gu, ' ').trim()} `;
}

function hasCallToAction(lastLine: string): boolean {
  if (lastLine.trim().endsWith('?')) return true;
  const flat = flattenWords(lastLine);
  if (CTA_PHRASES.some((phrase) => flat.includes(` ${phrase} `))) return true;
  return lastLine.split(/[.!?:;]+/).some((sentence) => {
    const flatSentence = flattenWords(sentence);
    return CTA_IMPERATIVES.some((word) => flatSentence.startsWith(` ${word} `));
  });
}

// Trailing hashtags and links are not the closing line a reader answers:
// "What is your ritual? #Porto" still ends with a question.
function closingText(lines: string[]): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let line = lines[index];
    for (const token of [...extractHashtags(line), ...extractLinks(line)]) {
      line = line.replace(token, ' ');
    }
    if (line.trim().length > 0) return line;
  }
  return '';
}

//---------------
// summarizeBaseline — the caller's own best posts, from stored rows.
//
// Engagement of one row is the sum of its measured counters (null means
// not measured for that counter, counted as 0 for ranking). Angles are
// grouped exactly as stored; rows without an angle cannot name a theme,
// so they count toward postsMeasured but never toward topAngles.
//---------------
export function summarizeBaseline(rows: BaselineRow[], truncated: boolean): DraftBaseline {
  const engagements: number[] = [];
  const byAngle = new Map<string, { engagement: number; posts: number }>();
  for (const row of rows) {
    const engagement =
      (row.views ?? 0) + (row.likes ?? 0) + (row.comments ?? 0) + (row.saves ?? 0);
    engagements.push(engagement);
    if (row.scriptAngle !== null && row.scriptAngle.trim().length > 0) {
      const angle = row.scriptAngle.trim();
      const entry = byAngle.get(angle) ?? { engagement: 0, posts: 0 };
      entry.engagement += engagement;
      entry.posts += 1;
      byAngle.set(angle, entry);
    }
  }
  const sorted = [...engagements].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[Math.floor(sorted.length / 2)]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const topAngles = [...byAngle.entries()]
    .map(([angle, entry]) => ({ angle, engagement: entry.engagement, posts: entry.posts }))
    .sort((a, b) => b.engagement - a.engagement || b.posts - a.posts || (a.angle < b.angle ? -1 : 1))
    .slice(0, 3);
  return {
    postsMeasured: rows.length,
    topAngles,
    medianEngagement: median,
    bestEngagement: sorted.length === 0 ? null : sorted[sorted.length - 1],
    truncated,
  };
}

//---------------
// scoreDraft — 0-100 from mechanical signals, every point explained.
//
// Post buckets: hook 20, length 15, hashtags 15, slop-free 20, links 10,
// top-theme match 15, call to action 5. Script buckets: hook 25, length 20,
// slop-free 25, links 10, top-theme match 15, call to action 5. Each bucket emits exactly one
// reason inside its own range, so the reasons always sum to the score and
// the score cannot leave 0-100.
//---------------
export function scoreDraft(
  draft: string,
  baseline: DraftBaseline,
  network: PublishNetwork = 'linkedin',
  kind: DraftKind = 'post',
): DraftScore {
  const profile = SCORE_PROFILES[kind];
  const reasons: DraftScoreReason[] = [];
  const chars = countChars(draft);
  const words = countWords(draft);
  const hashtags = extractHashtags(draft);
  const links = extractLinks(draft);
  const slopHits = findSlopHits(draft);
  const lines = draft.split('\n').filter((line) => line.trim().length > 0);
  const firstLine = lines[0] ?? '';
  const firstLineWords = countWords(firstLine);
  const lastLine = closingText(lines);

  if (firstLineWords >= profile.hookWords[0] && firstLineWords <= profile.hookWords[1]) {
    reasons.push({ rule: 'hook', detail: `First line is ${firstLineWords} words.`, points: profile.hook });
  } else if (firstLineWords >= 1) {
    reasons.push({
      rule: 'hook',
      detail: `First line is ${firstLineWords} words; hooks land best at ${profile.hookWords.join('-')} words.`,
      points: 5,
    });
  } else {
    reasons.push({ rule: 'hook', detail: 'No first line to hook with.', points: 0 });
  }

  const lengthHint = `Draft is ${words} words; ${profile.words.join('-')} reads best.`;
  if (words >= profile.words[0] && words <= profile.words[1]) {
    reasons.push({ rule: 'length', detail: `Draft is ${words} words.`, points: profile.length });
  } else if (words >= profile.nearWords[0] && words <= profile.nearWords[1]) {
    reasons.push({ rule: 'length', detail: lengthHint, points: 8 });
  } else {
    reasons.push({ rule: 'length', detail: lengthHint, points: 0 });
  }

  if (kind === 'script') {
    // No hashtag bucket: the script contract forbids them (check_script (action: validate)).
  } else if (hashtags.length >= 1 && hashtags.length <= 5) {
    reasons.push({ rule: 'hashtags', detail: `Draft has ${hashtags.length} hashtags.`, points: 15 });
  } else if (hashtags.length >= 6 && hashtags.length <= 10) {
    reasons.push({ rule: 'hashtags', detail: `Draft has ${hashtags.length} hashtags; 1-5 reads best.`, points: 8 });
  } else if (hashtags.length === 0) {
    reasons.push({ rule: 'hashtags', detail: 'Draft has no hashtags.', points: 0 });
  } else {
    reasons.push({ rule: 'hashtags', detail: `Draft has ${hashtags.length} hashtags; 1-5 reads best.`, points: 0 });
  }

  if (slopHits.length === 0) {
    reasons.push({ rule: 'slop_free', detail: 'No slop markers found.', points: profile.slop });
  } else {
    reasons.push({
      rule: 'slop_free',
      detail: `Slop markers found: ${slopHits.map((hit) => `"${hit}"`).join(', ')}.`,
      // -5 per marker, floored at 0 so slop cannot eat other buckets' points.
      points: Math.max(0, profile.slop - slopHits.length * 5),
    });
  }

  if (links.length === 0) {
    reasons.push({ rule: 'links', detail: 'No link in the body.', points: 10 });
  } else if (links.length === 1) {
    reasons.push({ rule: 'links', detail: 'One link in the body; links in comments perform better.', points: 5 });
  } else {
    reasons.push({ rule: 'links', detail: `${links.length} links in the body; links in comments perform better.`, points: 0 });
  }

  let topThemeMatch: string | null = null;
  if (baseline.postsMeasured === 0) {
    reasons.push({ rule: 'top_theme', detail: 'No measured posts yet, so no top theme to match.', points: 0 });
  } else if (baseline.topAngles.length === 0) {
    reasons.push({ rule: 'top_theme', detail: 'Measured posts have no script angle yet, so no top theme to match.', points: 0 });
  } else {
    const draftTokens = themeTokens(draft);
    for (const top of baseline.topAngles) {
      const angleTokens = themeTokens(top.angle);
      const shared = [...angleTokens].some((token) => draftTokens.has(token));
      if (shared) {
        topThemeMatch = top.angle;
        break;
      }
    }
    if (topThemeMatch !== null) {
      reasons.push({ rule: 'top_theme', detail: `Draft matches top theme "${topThemeMatch}".`, points: 15 });
    } else {
      reasons.push({ rule: 'top_theme', detail: 'Draft matches none of the top themes.', points: 0 });
    }
  }

  if (hasCallToAction(lastLine)) {
    reasons.push({ rule: 'call_to_action', detail: 'Draft ends with a question or call to action.', points: 5 });
  } else {
    reasons.push({ rule: 'call_to_action', detail: 'Draft does not end with a question or call to action.', points: 0 });
  }

  const score = reasons.reduce((sum, reason) => sum + reason.points, 0);

  return {
    score,
    reasons,
    counts: {
      chars,
      words,
      hashtags: hashtags.length,
      links: links.length,
      firstLineWords,
      slopHits,
      topThemeMatch,
    },
    baseline,
    publishCheck: kind === 'script' ? null : checkPublish(draft, network),
  };
}
