import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_DEFAULT_VIDEOS_PER_VARIANT,
  EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS,
  EXPERIMENT_MAX_TOTAL_VIDEOS,
  EXPERIMENT_MIN_VIDEOS_PER_VARIANT,
} from '@/lib/contracts/experiments';
import { MIN_COMPARED_VIDEOS, RECOMMENDED_VIDEOS_PER_PROMPT } from '@/lib/experiments/prompt-comparison';
import { MEDIA_ID_MAX_SPAN_MS, mediaIdIssue, shapeCountIssues } from '../create-checks';
import { experimentBody, segmentsFor } from './create-fixtures';

function bodyWithMediaId() {
  const body = experimentBody();
  const segments = segmentsFor();
  segments[0].media = [{ mediaId: 'upload-1' }, ...(segments[0].media ?? []).slice(1)];
  body.variants[1].videos[4].segments = segments;
  return body;
}

describe('mediaIdIssue', () => {
  it('allows an uploaded mediaId when every video lands within one day', () => {
    expect(mediaIdIssue(bodyWithMediaId(), undefined, MEDIA_ID_MAX_SPAN_MS)).toBeNull();
  });

  it('rejects an uploaded mediaId in a segment when the videos span more than a day, naming the video', () => {
    const issue = mediaIdIssue(bodyWithMediaId(), undefined, MEDIA_ID_MAX_SPAN_MS + 1);

    expect(issue).toMatchObject({ code: 'VALIDATION_FAILED', field: 'variants.1.videos.4.segments' });
    expect(issue?.message).toContain('public');
  });

  it('rejects an uploaded mediaId among the lipsync photos when the videos span more than a day', () => {
    const issue = mediaIdIssue(experimentBody(), [{ mediaId: 'photo-1' }], MEDIA_ID_MAX_SPAN_MS + 1);

    expect(issue).toMatchObject({ field: 'options.lipsyncPhotos' });
  });

  it('accepts public URLs however long the experiment runs', () => {
    expect(mediaIdIssue(experimentBody(), [{ url: 'https://img.test/a.jpg' }], MEDIA_ID_MAX_SPAN_MS * 20)).toBeNull();
  });
});

describe('experiment sample limits', () => {
  it('pins the contract minimum and default to the comparison rules they come from', () => {
    expect(EXPERIMENT_MIN_VIDEOS_PER_VARIANT).toBe(MIN_COMPARED_VIDEOS);
    expect(EXPERIMENT_DEFAULT_VIDEOS_PER_VARIANT).toBe(RECOMMENDED_VIDEOS_PER_PROMPT);
  });
});

describe('shapeCountIssues full lip-sync cap', () => {
  const PER_VARIANT = EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS / 2;

  it('accepts a full lip-sync experiment of exactly the cap', () => {
    expect(shapeCountIssues(experimentBody({ videoType: 'full_lipsync' }, PER_VARIANT))).toEqual([]);
  });

  it('rejects two videos over the cap, one more in each variant, and names the number and the other video types', () => {
    const body = experimentBody({ videoType: 'full_lipsync' }, PER_VARIANT);
    body.variants.forEach((variant) => variant.videos.push(structuredClone(variant.videos[0])));

    const issues = shapeCountIssues(body);

    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('variants');
    expect(issues[0].message).toContain(`at most ${EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS} videos in total`);
    expect(issues[0].message).toContain(`this one has ${EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS + 2}`);
    expect(issues[0].message).toContain(`up to ${EXPERIMENT_MAX_TOTAL_VIDEOS}`);
  });

  it.each(['voiceover', 'hook_lipsync'] as const)('lets a %s experiment hold more than the full lip-sync cap', (videoType) => {
    const body = experimentBody({ videoType }, EXPERIMENT_MAX_TOTAL_VIDEOS / 2);

    expect(shapeCountIssues(body)).toEqual([]);
  });

  it('keeps the cap below the overall total', () => {
    expect(EXPERIMENT_MAX_FULL_LIPSYNC_VIDEOS).toBeLessThan(EXPERIMENT_MAX_TOTAL_VIDEOS);
  });
});
