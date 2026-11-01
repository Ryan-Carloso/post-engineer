//---------------
// draft-scoring — mechanical draft scoring + multi-network publish check.
//
// No LLM, no paid service, no external call: every signal is computed
// from the draft text itself plus the caller's own stored post metrics.
// The score is never a bare number: every rule that moves it appears in
// `reasons` with the exact detail that fired, so the caller can fix the
// draft instead of guessing what the number means.
//
// Baseline honesty: post_metrics rows carry counters and script angles,
// never the post text, so theme adherence is token overlap between the
// draft and the user's top angles — a soft signal, not a claim that the
// draft copies a past post. When the user has no measured posts yet,
// the theme bucket scores 0 and says so; it never invents a baseline.
//---------------

import {
  BLUESKY_CAPTION_MAX_GRAPHEMES,
  countBlueskyGraphemes,
} from './bluesky';

// The four networks Post Engineer publishes to (post_metrics.provider
// check constraint, migration 025). The scorer buckets are universal;
// only the publish check varies by network.
export type PublishNetwork = 'linkedin' | 'youtube' | 'instagram' | 'bluesky';

export const PUBLISH_NETWORKS: PublishNetwork[] = [
  'linkedin',
  'youtube',
  'instagram',
  'bluesky',
];

// LinkedIn's documented standard-post ceiling (LinkedIn Help, via its
// public limits pages): a standard feed post holds at most 3000
// characters. Images, video and documents attached to the post do not
// consume characters.
export const LINKEDIN_POST_MAX_CHARS = 3000;
// The feed shows roughly the first 210 characters on desktop (~140 on
// mobile) before the "see more" fold: a first line longer than this is
// a warning, never a failure — the fold is a display cut, not a cap.
export const LINKEDIN_SEE_MORE_FOLD_CHARS = 210;
// YouTube and Instagram have no text cap in this repo's publishing
// code, so their ceilings below are the platforms' documented limits
// (YouTube video descriptions, Instagram captions) and are warnings
// only — never invented blocks. Only caps with in-repo evidence
// (LinkedIn, Bluesky) fail the check.
export const YOUTUBE_DESCRIPTION_MAX_CHARS = 5000;
export const INSTAGRAM_CAPTION_MAX_CHARS = 2200;
// The route rejects drafts over this input cap with a 400 instead of
// silently truncating (repo rule: never silently truncate/coerce).
export const DRAFT_MAX_INPUT_CHARS = 10000;
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

export interface PublishCheck {
  network: PublishNetwork;
  ok: boolean;
  failures: string[];
  warnings: string[];
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
  publishCheck: PublishCheck;
}

function countChars(text: string): number {
  // Code points, not UTF-16 units: an emoji counts as one character,
  // matching how the LinkedIn editor counts it closely enough for a
  // pre-publish gate (the platform is the final arbiter).
  return Array.from(text).length;
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  return text.trim().length === 0 ? 0 : words.length;
}

// A # glued to a preceding word or path is a URL fragment or "C#", never a
// hashtag ("example.com/guide#setup" must not count).
function extractHashtags(text: string): string[] {
  return text.match(/(?<![\p{L}\p{N}_/])#[\p{L}\p{N}_]+/gu) ?? [];
}

// Any scheme casing, www., or a bare domain on a known TLD. The TLD list is
// closed so "Node.js" or "e.g." never count, and the lookbehind skips email
// addresses.
function extractLinks(text: string): string[] {
  return text.match(
    /(?<![@\p{L}\p{N}.-])(?:https?:\/\/[^\s]+|www\.[^\s]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|dev|app|br|pt)(?![\p{L}\p{N}-])(?:\/[^\s]*)?)/giu,
  ) ?? [];
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
// checkPublish — the blocking gate, per network.
//
// Only platform-enforced facts block: an empty draft everywhere, plus
// the network's own ceiling where this repo has evidence for it
// (LinkedIn 3000 chars, Bluesky 300 graphemes — the Bluesky publisher
// truncates past its cap, so an over-long draft would be cut, not
// posted whole). Everything else is a warning: real guidance, but the
// platform accepts the post, so the gate must not pretend otherwise.
// YouTube/Instagram ceilings are warnings only: no in-repo publisher
// cap exists for them, so a block would be invented.
//---------------
export function checkPublish(draft: string, network: PublishNetwork): PublishCheck {
  const failures: string[] = [];
  const warnings: string[] = [];
  const chars = countChars(draft);
  if (draft.trim().length === 0) {
    failures.push('Draft is empty.');
  }
  if (network === 'linkedin') {
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
  }
  if (network === 'bluesky') {
    const graphemes = countBlueskyGraphemes(draft);
    if (graphemes > BLUESKY_CAPTION_MAX_GRAPHEMES) {
      failures.push(
        `Draft is ${graphemes} graphemes, over the Bluesky ${BLUESKY_CAPTION_MAX_GRAPHEMES}-grapheme caption limit — the caption would be cut.`,
      );
    }
  }
  if (network === 'youtube' && chars > YOUTUBE_DESCRIPTION_MAX_CHARS) {
    warnings.push(
      `Draft is ${chars} characters, over YouTube's ${YOUTUBE_DESCRIPTION_MAX_CHARS}-character description limit — the description would be cut.`,
    );
  }
  if (network === 'instagram' && chars > INSTAGRAM_CAPTION_MAX_CHARS) {
    warnings.push(
      `Draft is ${chars} characters, over Instagram's ${INSTAGRAM_CAPTION_MAX_CHARS}-character caption limit — the caption would be cut.`,
    );
  }
  return { network, ok: failures.length === 0, failures, warnings };
}

//---------------
// scoreDraft — 0-100 from mechanical signals, every point explained.
//
// Buckets: hook 20, length 15, hashtags 15, slop-free 20, links 10,
// top-theme match 15, call to action 5. Each bucket emits exactly one
// reason inside its own range, so the reasons always sum to the score and
// the score cannot leave 0-100.
//---------------
export function scoreDraft(
  draft: string,
  baseline: DraftBaseline,
  network: PublishNetwork = 'linkedin',
): DraftScore {
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

  if (firstLineWords >= 3 && firstLineWords <= 30) {
    reasons.push({ rule: 'hook', detail: `First line is ${firstLineWords} words.`, points: 20 });
  } else if (firstLineWords >= 1) {
    reasons.push({
      rule: 'hook',
      detail: `First line is ${firstLineWords} words; hooks land best at 3-30 words.`,
      points: 5,
    });
  } else {
    reasons.push({ rule: 'hook', detail: 'No first line to hook with.', points: 0 });
  }

  if (words >= 40 && words <= 400) {
    reasons.push({ rule: 'length', detail: `Draft is ${words} words.`, points: 15 });
  } else if ((words >= 20 && words < 40) || (words > 400 && words <= 600)) {
    reasons.push({ rule: 'length', detail: `Draft is ${words} words; 40-400 reads best.`, points: 8 });
  } else {
    reasons.push({ rule: 'length', detail: `Draft is ${words} words; 40-400 reads best.`, points: 0 });
  }

  if (hashtags.length >= 1 && hashtags.length <= 5) {
    reasons.push({ rule: 'hashtags', detail: `Draft has ${hashtags.length} hashtags.`, points: 15 });
  } else if (hashtags.length >= 6 && hashtags.length <= 10) {
    reasons.push({ rule: 'hashtags', detail: `Draft has ${hashtags.length} hashtags; 1-5 reads best.`, points: 8 });
  } else if (hashtags.length === 0) {
    reasons.push({ rule: 'hashtags', detail: 'Draft has no hashtags.', points: 0 });
  } else {
    reasons.push({ rule: 'hashtags', detail: `Draft has ${hashtags.length} hashtags; 1-5 reads best.`, points: 0 });
  }

  if (slopHits.length === 0) {
    reasons.push({ rule: 'slop_free', detail: 'No slop markers found.', points: 20 });
  } else {
    reasons.push({
      rule: 'slop_free',
      detail: `Slop markers found: ${slopHits.map((hit) => `"${hit}"`).join(', ')}.`,
      // -5 per marker, floored at 0 so slop cannot eat other buckets' points.
      points: Math.max(0, 20 - slopHits.length * 5),
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
    publishCheck: checkPublish(draft, network),
  };
}
