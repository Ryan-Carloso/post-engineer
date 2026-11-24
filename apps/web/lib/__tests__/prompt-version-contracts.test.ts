import { describe, expect, it } from 'vitest';
import {
  ListPromptVersionsQuerySchema,
  PROMPT_VERSION_LIST_LIMITS,
  PROMPT_VERSION_PATTERN,
  PROMPT_VERSION_PREVIEW_LENGTH,
  RestorePromptVersionBodySchema,
  RestorePromptVersionResponseSchema,
  getPromptVersion,
  listPromptVersions,
  restorePromptVersion,
} from '@/lib/contracts/prompts';

describe('prompt version contracts', () => {
  it('pins the list limits and the preview length', () => {
    expect(PROMPT_VERSION_LIST_LIMITS).toEqual({ default: 20, max: 50 });
    expect(PROMPT_VERSION_PREVIEW_LENGTH).toBe(280);
  });

  it.each(['1', '9', '123456789'])('accepts the version segment %s', (segment) => {
    expect(PROMPT_VERSION_PATTERN.test(segment)).toBe(true);
  });

  it.each(['0', '01', 'abc', '1e3', '-1', '1.5', '1234567890', ''])('rejects the version segment %j', (segment) => {
    expect(PROMPT_VERSION_PATTERN.test(segment)).toBe(false);
  });

  it('accepts a restore body with a positive integer expectedCurrentVersion', () => {
    expect(RestorePromptVersionBodySchema.parse({ expectedCurrentVersion: 3 })).toEqual({ expectedCurrentVersion: 3 });
  });

  it.each([0, 1.5, '3', null, -1])('rejects expectedCurrentVersion %j', (value) => {
    expect(RestorePromptVersionBodySchema.safeParse({ expectedCurrentVersion: value }).success).toBe(false);
  });

  it('rejects a restore body with extra keys or without the version', () => {
    expect(RestorePromptVersionBodySchema.safeParse({ expectedCurrentVersion: 3, extra: true }).success).toBe(false);
    expect(RestorePromptVersionBodySchema.safeParse({}).success).toBe(false);
  });

  it('coerces limit and before from query strings', () => {
    expect(ListPromptVersionsQuerySchema.parse({ limit: '20', before: '6' })).toEqual({ limit: 20, before: 6 });
    expect(ListPromptVersionsQuerySchema.parse({})).toEqual({});
  });

  it('accepts the largest before the version segment allows and rejects anything above it', () => {
    expect(ListPromptVersionsQuerySchema.safeParse({ before: '999999999' }).success).toBe(true);
    expect(ListPromptVersionsQuerySchema.safeParse({ before: '1000000000' }).success).toBe(false);
    expect(ListPromptVersionsQuerySchema.safeParse({ before: '99999999999999999999' }).success).toBe(false);
  });

  it.each([{ limit: '0' }, { limit: '51' }, { limit: '1.5' }, { before: '1' }, { before: 'x' }, { other: '1' }])(
    'rejects the query %j',
    (query) => {
      expect(ListPromptVersionsQuerySchema.safeParse(query).success).toBe(false);
    },
  );

  it('declares the three endpoints with their methods and paths', () => {
    expect([listPromptVersions.method, listPromptVersions.path]).toEqual(['GET', '/api/prompts/:slug/versions']);
    expect([getPromptVersion.method, getPromptVersion.path]).toEqual(['GET', '/api/prompts/:slug/versions/:version']);
    expect([restorePromptVersion.method, restorePromptVersion.path]).toEqual([
      'POST',
      '/api/prompts/:slug/versions/:version/restore',
    ]);
  });

  it('requires restored in the restore response', () => {
    const prompt = {
      slug: 's',
      title: 't',
      description: '',
      source: 'own',
      visibility: 'private',
      verified: false,
      prompt: 'p',
      body: 'p',
      versionId: '44444444-4444-4444-8444-444444444444',
      version: 2,
    };
    expect(RestorePromptVersionResponseSchema.safeParse({ success: true, restored: true, prompt }).success).toBe(true);
    expect(RestorePromptVersionResponseSchema.safeParse({ success: true, prompt }).success).toBe(false);
  });
});
