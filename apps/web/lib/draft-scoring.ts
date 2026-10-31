//---------------
// draft-scoring — mechanical LinkedIn draft scoring + publish check.
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

// LinkedIn's documented standard-post ceiling (LinkedIn Help, via its
// public limits pages): a standard feed post holds at most 3000
// characters. Images, video and documents attached to the post do not
// consume characters.
export const LINKEDIN_POST_MAX_CHARS = 3000;
// The feed shows roughly the first 210 characters on desktop (~140 on
// mobile) before the "see more" fold: a first line longer than this is
// a warning, never a failure — the fold is a display cut, not a cap.
export const LINKEDIN_SEE_MORE_FOLD_CHARS = 210;
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
}

export interface BaselineRow {
  scriptAngle: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
}

export interface LinkedinPublishCheck {
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
  publishCheck: LinkedinPublishCheck;
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

function extractHashtags(text: string): string[] {
  return text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
}

function extractLinks(text: string): string[] {
  return text.match(/https?:\/\/[^\s]+/g) ?? [];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you',
  'are', 'was', 'were', 'have', 'has', 'about', 'into', 'over', 'after',
  'before', 'when', 'what', 'which', 'their', 'them', 'they', 'then',
  'than', 'also', 'just', 'like', 'more', 'most', 'other', 'some',
]);

function themeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 4 && !STOPWORDS.has(raw)) tokens.add(raw);
  }
  return tokens;
}

function findSlopHits(text: string): string[] {
  const hits: string[] = [];
  if (text.includes('—')) hits.push('em dash');
  // Padded word search instead of an interpolated RegExp (repo rule):
  // punctuation is flattened to spaces, so ' delve ' only matches the
  // whole word, and multi-word markers match as whole phrases.
  const flat = ` ${text.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const marker of SLOP_MARKERS) {
    if (flat.includes(` ${marker} `)) hits.push(marker);
  }
  return hits;
}

const CTA_WORDS = [
  'comment', 'share', 'follow', 'subscribe', 'download', 'read',
  'try', 'join', 'save', 'check out', 'tell me', 'let me know',
];

function hasCallToAction(lastLine: string): boolean {
  if (lastLine.trim().endsWith('?')) return true;
  const flat = ` ${lastLine.toLowerCase().replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ')} `;
  return CTA_WORDS.some((word) => flat.includes(` ${word} `));
}

//---------------
// summarizeBaseline — the caller's own best posts, from stored rows.
//
// Engagement of one row is the sum of its measured counters (null means
// not measured for that counter, counted as 0 for ranking). Angles are
// grouped exactly as stored; rows without an angle cannot name a theme,
// so they count toward postsMeasured but never toward topAngles.
//---------------
export function summarizeBaseline(rows: BaselineRow[]): DraftBaseline {
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
  };
}

//---------------
// checkLinkedinPublish — the blocking LinkedIn gate.
//
// Only platform-enforced facts block: an empty draft and the 3000-char
// ceiling. Everything else (hashtag count, links in the body, the
// see-more fold) is a warning: real guidance, but the platform accepts
// the post, so the gate must not pretend otherwise.
//---------------
export function checkLinkedinPublish(draft: string): LinkedinPublishCheck {
  const failures: string[] = [];
  const warnings: string[] = [];
  const chars = countChars(draft);
  if (draft.trim().length === 0) {
    failures.push('Draft is empty.');
  }
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
  return { ok: failures.length === 0, failures, warnings };
}

//---------------
// scoreDraft — 0-100 from mechanical signals, every point explained.
//
// Buckets: hook 20, length 15, hashtags 15, slop-free 20, links 10,
// top-theme match 15, call to action 5. The reasons always sum to the
// returned score: when the raw sum leaves 0-100, a floor/ceiling reason
// carries the exact adjustment instead of silently clamping.
//---------------
export function scoreDraft(draft: string, baseline: DraftBaseline): DraftScore {
  const reasons: DraftScoreReason[] = [];
  const chars = countChars(draft);
  const words = countWords(draft);
  const hashtags = extractHashtags(draft);
  const links = extractLinks(draft);
  const slopHits = findSlopHits(draft);
  const lines = draft.split('\n').filter((line) => line.trim().length > 0);
  const firstLine = lines[0] ?? '';
  const firstLineWords = countWords(firstLine);
  const lastLine = lines[lines.length - 1] ?? '';

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

  reasons.push({ rule: 'slop_free', detail: 'No slop markers found.', points: 20 });
  for (const hit of slopHits) {
    reasons.push({ rule: 'slop', detail: `Slop marker found: "${hit}".`, points: -5 });
  }

  if (links.length === 0) {
    reasons.push({ rule: 'links', detail: 'No link in the body.', points: 10 });
  } else if (links.length === 1) {
    reasons.push({ rule: 'links', detail: 'One link in the body; links in comments perform better.', points: 5 });
  } else {
    reasons.push({ rule: 'links', detail: `${links.length} links in the body; links in comments perform better.`, points: 0 });
  }

  let topThemeMatch: string | null = null;
  if (baseline.topAngles.length === 0) {
    reasons.push({ rule: 'top_theme', detail: 'No measured posts yet, so no top theme to match.', points: 0 });
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

  const raw = reasons.reduce((sum, reason) => sum + reason.points, 0);
  const score = Math.min(100, Math.max(0, raw));
  if (score !== raw) {
    reasons.push({
      rule: score > raw ? 'score_ceiling' : 'score_floor',
      detail: `Raw sum ${raw} clamped to ${score}.`,
      points: score - raw,
    });
  }

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
    publishCheck: checkLinkedinPublish(draft),
  };
}
