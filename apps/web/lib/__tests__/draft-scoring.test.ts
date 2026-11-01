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
    ]);
    expect(baseline.postsMeasured).toBe(4);
    expect(baseline.topAngles).toEqual([
      { angle: 'Remote work', engagement: 200, posts: 1 },
      { angle: 'Porto mornings', engagement: 165, posts: 2 },
    ]);
    expect(baseline.medianEngagement).toBe(157.5);
    expect(baseline.bestEngagement).toBe(1000);
  });

  it('reports null median and best with no rows', () => {
    expect(summarizeBaseline([])).toEqual({
      postsMeasured: 0,
      topAngles: [],
      medianEngagement: null,
      bestEngagement: null,
      truncated: false,
    });
  });

  it('surfaces a partial baseline through the truncated flag', () => {
    const baseline = summarizeBaseline(
      [{ scriptAngle: 'Porto mornings', views: 100, likes: 0, comments: 0, saves: 0 }],
      true,
    );
    expect(baseline.truncated).toBe(true);
    expect(baseline.postsMeasured).toBe(1);
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
    expect(result.publishCheck.ok).toBe(true);
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
    expect(result.publishCheck.ok).toBe(true);
    expect(result.publishCheck.warnings.length).toBe(2);
  });

  it('never claims no slop markers when markers were found', () => {
    const draft = "Let's delve — into the ever-evolving landscape of work.";
    const result = scoreDraft(draft, EMPTY_BASELINE);
    const details = result.reasons.map((reason) => reason.detail);
    expect(details).not.toContain('No slop markers found.');
    expect(details).toContain('Slop bucket base of 20 reduced by 3 marker(s).');
    expect(result.reasons.reduce((sum, reason) => sum + reason.points, 0)).toBe(result.score);
  });

  it('scores an empty draft 30 and fails the publish check', () => {
    const result = scoreDraft('', EMPTY_BASELINE);
    expect(result.score).toBe(30);
    expect(result.publishCheck.network).toBe('linkedin');
    expect(result.publishCheck.ok).toBe(false);
    expect(result.publishCheck.failures).toEqual(['Draft is empty.']);
  });

  it('runs the publish check for the requested network, defaulting to linkedin', () => {
    expect(scoreDraft(strongDraft(), EMPTY_BASELINE).publishCheck.network).toBe('linkedin');
    expect(scoreDraft(strongDraft(), EMPTY_BASELINE, 'bluesky').publishCheck.network).toBe('bluesky');
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
