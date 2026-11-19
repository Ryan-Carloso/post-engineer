import type { PublishNetwork } from '@/lib/contracts/videos';

export type { PublishNetwork };

export type DraftKind = 'post' | 'script';

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
export const BASELINE_ROW_LIMIT = 200;

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
  'para', 'como', 'mais', 'pela', 'pelo', 'pelas', 'pelos', 'esse', 'essa',
  'isso', 'este', 'esta', 'isto', 'aqui', 'quando', 'sobre', 'entre',
  'muito', 'muita', 'você', 'vocês', 'suas', 'seus', 'nosso', 'nossa',
  'depois', 'antes', 'ainda', 'porque', 'também', 'foram', 'será', 'está',
]);

function themeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 4 && !STOPWORDS.has(raw)) tokens.add(raw);
  }
  return tokens;
}

function findSlopHits(text: string): string[] {
  const hits: string[] = [];
  if (text.includes('—')) hits.push('em dash');
  const flat = ` ${text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const marker of SLOP_MARKERS) {
    if (flat.includes(` ${marker} `)) hits.push(marker);
  }
  return hits;
}

const CTA_IMPERATIVES = [
  'comment', 'share', 'follow', 'subscribe', 'download', 'read', 'try',
  'join', 'save',
  'comente', 'compartilhe', 'siga', 'inscreva', 'baixe', 'leia',
  'experimente', 'participe', 'salve',
];
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
