//---------------
// Tests for lib/draft-scoring: mechanical signals only, no LLM, no DB.
// Every score assertion pins the full bucket arithmetic, and one test
// pins that the reasons always sum to the returned score.
//---------------

import { describe, it, expect } from 'vitest';
import {
  INSTAGRAM_CAPTION_MAX_CHARS,
  LINKEDIN_POST_MAX_CHARS,
  YOUTUBE_DESCRIPTION_MAX_CHARS,
  checkPublish,
  scoreDraft,
  summarizeBaseline,
  type DraftBaseline,
} from '../draft-scoring';
import { BLUESKY_CAPTION_MAX_GRAPHEMES } from '../bluesky';

const EMPTY_BASELINE: DraftBaseline = {
  postsMeasured: 0,
  topAngles: [],
  medianEngagement: null,
  bestEngagement: null,
  truncated: false,
};

function strongDraft(): string {
  return [
    'The best Porto mornings start before the tourists wake up.',
    '',
    'Walk the riverside while the city is still quiet, order coffee where the locals order coffee, and let the day find you instead of planning every hour of it in advance.',
    '',
    'Slow mornings, real streets, no queues. #Porto #travel',
    '',
    'What is your morning ritual?',
  ].join('\n');
}

describe('summarizeBaseline', () => {
  it('ranks top angles by total engagement and reports median and best', () => {
    const baseline = summarizeBaseline([
      { scriptAngle: 'Porto mornings', views: 100, likes: 10, comments: 5, saves: 0 },
      { scriptAngle: 'Porto mornings', views: 50, likes: 0, comments: 0, saves: null },
      { scriptAngle: 'Remote work', views: 200, likes: 0, comments: 0, saves: 0 },
      { scriptAngle: null, views: 1000, likes: 0, comments: 0, saves: 0 },
    ], true);
    expect(baseline.postsMeasured).toBe(4);
    expect(baseline.topAngles).toEqual([
      { angle: 'Remote work', engagement: 200, posts: 1 },
      { angle: 'Porto mornings', engagement: 165, posts: 2 },
    ]);
    expect(baseline.medianEngagement).toBe(157.5);
    expect(baseline.bestEngagement).toBe(1000);
    expect(baseline.truncated).toBe(true);
  });

  it('reports null median and best with no rows', () => {
    expect(summarizeBaseline([], false)).toEqual({
      postsMeasured: 0,
      topAngles: [],
      medianEngagement: null,
      bestEngagement: null,
      truncated: false,
    });
  });
});

describe('scoreDraft', () => {
  it('scores a strong on-theme draft 100 with every bucket explained', () => {
    const baseline: DraftBaseline = {
      postsMeasured: 3,
      topAngles: [{ angle: 'Porto mornings', engagement: 165, posts: 2 }],
      medianEngagement: 115,
      bestEngagement: 200,
      truncated: false,
    };
    const result = scoreDraft(strongDraft(), baseline);
    expect(result.score).toBe(100);
    expect(result.counts.hashtags).toBe(2);
    expect(result.counts.links).toBe(0);
    expect(result.counts.slopHits).toEqual([]);
    expect(result.counts.topThemeMatch).toBe('Porto mornings');
    expect(result.publishCheck?.ok).toBe(true);
    expect(result.reasons.reduce((sum, reason) => sum + reason.points, 0)).toBe(100);
  });

  it('penalizes slop, hashtag stuffing, a link and a short body, and sums its reasons', () => {
    const draft = [
      "Let's delve — into the ever-evolving landscape of work.",
      'Short note here for now. #a #b #c #d #e #f #g #h #i #j #k #l https://example.com/post',
    ].join('\n');
    const result = scoreDraft(draft, EMPTY_BASELINE);
    expect(result.counts.slopHits).toEqual(['em dash', 'delve', 'ever-evolving']);
    expect(result.counts.hashtags).toBe(12);
    expect(result.counts.links).toBe(1);
    expect(result.score).toBe(38);
    expect(result.reasons.reduce((sum, reason) => sum + reason.points, 0)).toBe(38);
    expect(result.publishCheck?.ok).toBe(true);
    expect(result.publishCheck?.warnings.length).toBe(2);
  });

  it('scores an empty draft 30 and fails the publish check', () => {
    const result = scoreDraft('', EMPTY_BASELINE);
    expect(result.score).toBe(30);
    expect(result.publishCheck?.network).toBe('linkedin');
    expect(result.publishCheck?.ok).toBe(false);
    expect(result.publishCheck?.failures).toEqual(['Draft is empty.']);
  });

  it('runs the publish check for the requested network, defaulting to linkedin', () => {
    expect(scoreDraft(strongDraft(), EMPTY_BASELINE).publishCheck?.network).toBe('linkedin');
    expect(scoreDraft(strongDraft(), EMPTY_BASELINE, 'bluesky').publishCheck?.network).toBe('bluesky');
  });
});

describe('scoreDraft bucket details', () => {
  const pointsOf = (draft: string, rule: string, baseline = EMPTY_BASELINE): number[] =>
    scoreDraft(draft, baseline).reasons.filter((reason) => reason.rule === rule).map((reason) => reason.points);
  const detailOf = (draft: string, rule: string, baseline = EMPTY_BASELINE): string | undefined =>
    scoreDraft(draft, baseline).reasons.find((reason) => reason.rule === rule)?.detail;

  it('reports found slop markers in one reason and never claims none were found', () => {
    expect(pointsOf('Let us delve here today friends', 'slop_free')).toEqual([15]);
    expect(detailOf('Let us delve here today friends', 'slop_free')).toBe('Slop markers found: "delve".');
    expect(detailOf('Plain honest words here', 'slop_free')).toBe('No slop markers found.');
  });

  it('floors the slop bucket at 0 and keeps the score equal to the reasons sum', () => {
    const draft = 'delve moreover furthermore additionally ultimately crucial tapestry unlock elevate — words';
    const result = scoreDraft(draft, EMPTY_BASELINE);
    expect(pointsOf(draft, 'slop_free')).toEqual([0]);
    expect(result.score).toBe(result.reasons.reduce((sum, reason) => sum + reason.points, 0));
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('matches slop markers written with a typographic apostrophe', () => {
    const result = scoreDraft('It\u2019s important to note this works', EMPTY_BASELINE);
    expect(result.counts.slopHits).toEqual(["it's important to note"]);
  });

  it('does not count URL fragments as hashtags', () => {
    expect(scoreDraft('See https://example.com/guide#setup today', EMPTY_BASELINE).counts.hashtags).toBe(0);
    expect(scoreDraft('See example.com/guide#setup today', EMPTY_BASELINE).counts.hashtags).toBe(0);
    expect(scoreDraft('Learn C#sharp and #Porto', EMPTY_BASELINE).counts.hashtags).toBe(1);
  });

  it.each([
    ['HTTPS://example.com/post', 1],
    ['www.example.com/post', 1],
    ['read example.com today', 1],
    ['site.com.br/x', 1],
    ['me@example.com', 0],
    ['Node.js and e.g. this', 0],
    ['example.company', 0],
    ['no links here', 0],
  ])('counts links in %s as %i', (draft, expected) => {
    expect(scoreDraft(draft, EMPTY_BASELINE).counts.links).toBe(expected);
  });

  it('reads the closing line past trailing hashtags and links', () => {
    expect(pointsOf('What is your ritual? #Porto #travel', 'call_to_action')).toEqual([5]);
    expect(pointsOf('What is your ritual?\n#Porto #travel', 'call_to_action')).toEqual([5]);
    expect(pointsOf('What is your ritual? https://example.com', 'call_to_action')).toEqual([5]);
  });

  it.each([
    ['Read the full guide.', 5],
    ['It works. Share this with a friend', 5],
    ['Let me know below', 5],
    ['Comente abaixo', 5],
    ['Me conta nos comentários', 5],
    ['I read this on Sunday', 0],
    ['We share an office', 0],
  ])('scores the call to action in %s as %i', (draft, expected) => {
    expect(pointsOf(draft, 'call_to_action')).toEqual([expected]);
  });

  it('does not match a top theme on a Portuguese stopword', () => {
    const baseline: DraftBaseline = {
      ...EMPTY_BASELINE,
      postsMeasured: 1,
      topAngles: [{ angle: 'Dicas para viajar', engagement: 10, posts: 1 }],
    };
    expect(pointsOf('Um café para começar o dia', 'top_theme', baseline)).toEqual([0]);
    expect(pointsOf('Vou viajar amanhã', 'top_theme', baseline)).toEqual([15]);
  });

  it('matches accented theme words whole', () => {
    const baseline: DraftBaseline = {
      ...EMPTY_BASELINE,
      postsMeasured: 1,
      topAngles: [{ angle: 'Manhãs no Porto', engagement: 10, posts: 1 }],
    };
    expect(pointsOf('Minhas manhãs tranquilas', 'top_theme', baseline)).toEqual([15]);
    expect(pointsOf('Manhas de programador', 'top_theme', baseline)).toEqual([0]);
  });

  it('says measured posts lack an angle instead of claiming none were measured', () => {
    const baseline: DraftBaseline = { ...EMPTY_BASELINE, postsMeasured: 40 };
    expect(detailOf('Some draft text', 'top_theme', baseline)).toBe(
      'Measured posts have no script angle yet, so no top theme to match.',
    );
    expect(detailOf('Some draft text', 'top_theme')).toBe('No measured posts yet, so no top theme to match.');
  });
});

describe('scoreDraft for a video script', () => {
  function script(hookWords: number, bodyWords: number, cta: string): string {
    return ['word '.repeat(hookWords).trim() + '.', 'body '.repeat(bodyWords).trim() + '.', cta].join('\n');
  }
  const STRONG = script(20, 40, 'Comment below with your favorite morning ritual today');
  const THEMED: DraftBaseline = {
    ...EMPTY_BASELINE,
    postsMeasured: 1,
    topAngles: [{ angle: 'Morning ritual', engagement: 10, posts: 1 }],
  };

  it('scores a contract-perfect script 100 without hashtags, with no hashtag reason', () => {
    const result = scoreDraft(STRONG, THEMED, 'linkedin', 'script');
    expect(result.score).toBe(100);
    expect(result.reasons.map((reason) => [reason.rule, reason.points])).toEqual([
      ['hook', 25], ['length', 20], ['slop_free', 25], ['links', 10], ['top_theme', 15], ['call_to_action', 5],
    ]);
    expect(result.reasons.some((reason) => reason.rule === 'hashtags')).toBe(false);
  });

  it('caps the same text at 85 as a post, which is why scripts have their own profile', () => {
    expect(scoreDraft(STRONG, THEMED).reasons.find((reason) => reason.rule === 'hashtags')?.points).toBe(0);
  });

  it('returns a null publish check for a script and a real one for a post', () => {
    expect(scoreDraft(STRONG, THEMED, 'bluesky', 'script').publishCheck).toBeNull();
    expect(scoreDraft(STRONG, THEMED, 'bluesky', 'post').publishCheck?.network).toBe('bluesky');
  });

  it.each([
    [14, 5], [15, 25], [40, 25], [41, 5],
  ])('scores a %i-word hook %i points', (hookWords, points) => {
    const result = scoreDraft(script(hookWords, 40, 'Share this.'), EMPTY_BASELINE, 'linkedin', 'script');
    expect(result.reasons.find((reason) => reason.rule === 'hook')?.points).toBe(points);
  });

  it.each([
    [39, 0], [40, 8], [59, 8], [60, 20], [200, 20], [201, 8], [250, 8], [251, 0],
  ])('scores %i total words %i length points', (total, points) => {
    const result = scoreDraft(script(20, total - 22, 'Share this.'), EMPTY_BASELINE, 'linkedin', 'script');
    expect(result.counts.words).toBe(total);
    expect(result.reasons.find((reason) => reason.rule === 'length')?.points).toBe(points);
  });

  it('takes slop points from the script weight and floors at 0', () => {
    const points = (text: string): number | undefined =>
      scoreDraft(text, EMPTY_BASELINE, 'linkedin', 'script').reasons.find((reason) => reason.rule === 'slop_free')?.points;
    expect(points('Let us delve here')).toBe(20);
    expect(points('delve moreover furthermore additionally ultimately crucial')).toBe(0);
  });
});

describe('checkPublish', () => {
  it('fails a draft over the LinkedIn character limit', () => {
    const draft = 'x'.repeat(LINKEDIN_POST_MAX_CHARS + 1);
    const check = checkPublish(draft, 'linkedin');
    expect(check.network).toBe('linkedin');
    expect(check.ok).toBe(false);
    expect(check.failures).toHaveLength(1);
    expect(check.failures[0]).toContain('3000-character');
  });

  it('warns when the first line passes the see-more fold', () => {
    const draft = `${'y'.repeat(211)}\nSecond line.`;
    const check = checkPublish(draft, 'linkedin');
    expect(check.ok).toBe(true);
    expect(check.warnings).toHaveLength(1);
    expect(check.warnings[0]).toContain('see-more');
  });

  it('fails a Bluesky draft over 300 graphemes, counting composed emoji as one', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(checkPublish(family.repeat(BLUESKY_CAPTION_MAX_GRAPHEMES), 'bluesky').ok).toBe(true);
    const check = checkPublish(family.repeat(BLUESKY_CAPTION_MAX_GRAPHEMES + 1), 'bluesky');
    expect(check.ok).toBe(false);
    expect(check.failures).toHaveLength(1);
    expect(check.failures[0]).toContain('300-grapheme');
  });

  it('warns, never fails, a YouTube draft over the description limit', () => {
    const check = checkPublish('x'.repeat(YOUTUBE_DESCRIPTION_MAX_CHARS + 1), 'youtube');
    expect(check.ok).toBe(true);
    expect(check.warnings).toHaveLength(1);
    expect(check.warnings[0]).toContain('5000-character');
  });

  it('warns, never fails, an Instagram draft over the caption limit', () => {
    const check = checkPublish('x'.repeat(INSTAGRAM_CAPTION_MAX_CHARS + 1), 'instagram');
    expect(check.ok).toBe(true);
    expect(check.warnings).toHaveLength(1);
    expect(check.warnings[0]).toContain('2200-character');
  });

  it('fails an empty draft on every network', () => {
    for (const network of ['linkedin', 'youtube', 'instagram', 'bluesky'] as const) {
      expect(checkPublish('   ', network).failures).toEqual(['Draft is empty.']);
    }
  });
});
