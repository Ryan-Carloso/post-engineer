// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(async () => ({
    auth: { userId: 'user-1', isApiKey: false, isOAuth: false, personaIds: null },
    error: null,
  })),
  engineAuthHeaders: () => ({}),
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { videoGenerate: {}, mediaUpload: {} },
}));

import { POST } from '../generate-and-schedule/route';
import { checkSemantics, rejectInvalidRequest, MAX_REPORTED_ISSUES } from '../generate-and-schedule/request-validation';
import { validateProviders } from '../generate-and-schedule/providers-validation';
import { trackApiEvent } from '@/lib/analytics';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const bodyText =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const ctaTake = 'Save this video before your next trip to Porto.';
function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const segments = [
  { kind: 'hook', text: hook, media: photos(3, 'hook') },
  { kind: 'content', text: bodyText, media: photos(6, 'content') },
  { kind: 'content', text: ctaTake, media: photos(2, 'ctaTake') },
];

function futureISO(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { options: optionsOverrides, ...rest } = overrides;
  return {
    personaId: 'persona-1',
    title: 'Porto trip',
    description: 'Agent description.',
    publishing: {
      providers: ['youtube'],
      accounts: { youtube: ['acct-1'] },
      schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
    },
    options: { videoType: 'hook_lipsync', segments, ...((optionsOverrides ?? {}) as Record<string, unknown>) },
    ...rest,
  };
}

function post(payload: unknown): Promise<Response> {
  return POST(
    new Request('https://example.com/api/videos/generate-and-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  vi.mocked(trackApiEvent).mockClear();
});

describe('generate-and-schedule reports every validation problem in one 400 (#351)', () => {
  it('returns all problems at once, with the first one as the top-level error', async () => {
    const res = await post(
      body({
        title: '   ',
        publishing: {
          providers: ['myspace', 'youtube', 'friendster'],
          accounts: { youtube: ['acct-1'] },
          schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
        },
        options: { segments, webhookUrl: 'not a url', niche: 'x'.repeat(301) },
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      code: string;
      field: string;
      error: string;
      errors: Array<{ code: string; field: string; message: string }>;
    };
    expect(json.field).toBe('title');
    expect(json.code).toBe('VALIDATION_FAILED');
    expect(json.errors.map((e) => e.field)).toEqual([
      'title',
      'publishing.providers',
      'publishing.providers',
      'options.webhookUrl',
      'options.niche',
    ]);
    expect(json.errors[0].message).toBe(json.error);
    expect(json.errors[1].message).toContain('"myspace"');
    expect(json.errors[2].message).toContain('"friendster"');
  });

  it('reports every bad segment kind in one response, not just the first', async () => {
    const res = await post(
      body({
        options: {
          segments: [
            { kind: 'intro', text: hook },
            ...segments.slice(1, -1),
            { kind: 'outro', text: ctaTake },
          ],
        },
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { errors: Array<{ field: string }> };
    const fields = json.errors.map((e) => e.field);
    expect(fields).toContain('options.segments.0.kind');
    expect(fields).toContain('options.segments.2.kind');
  });

  it('a shape error skips the semantic checks, which need the parsed fields', async () => {
    const res = await post(
      body({
        publishing: {
          providers: ['myspace'],
          accounts: { youtube: ['acct-1'] },
          schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
        },
        options: { segments: [{ kind: 'intro', text: hook }, ...segments.slice(1)] },
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { errors: Array<{ field: string }> };
    expect(json.errors.map((e) => e.field)).toEqual(['options.segments.0.kind']);
  });

  it('keeps the topics rejection first and still lists the other problems', async () => {
    const res = await post({ ...body({ title: '' }), topics: ['Porto trip'] });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { field: string; errors: Array<{ field: string }> };
    expect(json.field).toBe('topics');
    expect(json.errors.map((e) => e.field)).toEqual(['topics', 'title']);
  });

  it('tracks one validation event per rejected request, with the error count', async () => {
    await post(body({ title: '', options: { segments, webhookUrl: 'nope' } }));
    const calls = vi.mocked(trackApiEvent).mock.calls.filter(
      ([name]) => name === 'video_creation_validation_failed',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      errorCode: 'VALIDATION_FAILED',
      field: 'title',
      errorCount: 2,
      fields: ['title', 'options.webhookUrl'],
    });
  });

  it('a request with no persona must be faceless and have a voice: both reported', async () => {
    const res = await post(body({ personaId: undefined, options: { segments } }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { errors: Array<{ field: string }> };
    expect(json.errors.map((e) => e.field)).toEqual(['options.videoType', 'options.voiceId']);
  });

  it('does not echo a huge provider list', async () => {
    const providers = Array.from({ length: 50 }, (_, i) => `nope-${i}-xxxxxxxx`);
    const res = await post(body({ publishing: { providers } }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { errors: Array<{ message: string }> };
    expect(json.errors.length).toBeLessThanOrEqual(MAX_REPORTED_ISSUES);
    expect(JSON.stringify(json)).not.toContain('nope-49');
    expect(json.errors[0].message).toContain(`<=${MAX_REPORTED_ISSUES}`);
  });

  it('returns at most 20 problems and still counts the rest', async () => {
    const issues = Array.from({ length: 25 }, (_, i) => ({
      code: 'VALIDATION_FAILED' as const,
      message: `problem ${i}`,
      field: `field.${i}`,
    }));
    const res = rejectInvalidRequest(issues);
    const json = (await res.json()) as { error: string; errors: Array<{ field: string }> };
    expect(json.errors).toHaveLength(MAX_REPORTED_ISSUES);
    expect(json.error).toBe('problem 0');
    expect(json.errors.map((e) => e.field)).toEqual(issues.slice(0, MAX_REPORTED_ISSUES).map((i) => i.field));
    const calls = vi.mocked(trackApiEvent).mock.calls.filter(
      ([name]) => name === 'video_creation_validation_failed',
    );
    expect(calls.at(-1)?.[1]).toMatchObject({
      errorCount: 25,
      fields: issues.slice(0, MAX_REPORTED_ISSUES).map((i) => i.field),
    });
  });

  it('caps each echoed field path, not only the number of problems', async () => {
    const longField = `publishing.accounts.${'k'.repeat(500)}`;
    const res = rejectInvalidRequest([
      { code: 'VALIDATION_FAILED', message: 'accounts must be arrays', field: longField },
    ]);
    const json = (await res.json()) as { field: string; errors: Array<{ field: string }> };
    expect(json.field).toHaveLength(200);
    expect(json.field).toBe(longField.slice(0, 200));
    expect(json.errors[0].field).toBe(longField.slice(0, 200));
    const calls = vi.mocked(trackApiEvent).mock.calls.filter(
      ([name]) => name === 'video_creation_validation_failed',
    );
    expect(calls.at(-1)?.[1]).toMatchObject({
      field: longField.slice(0, 200),
      fields: [longField.slice(0, 200)],
    });
  });

  it('does not echo a huge provider name', () => {
    const name = `nope-${'x'.repeat(400)}`;
    const outcome = validateProviders([name]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues[0].message).toContain('Use one of');
    expect(outcome.issues[0].message).not.toContain(name);
    expect(outcome.issues[0].message.length).toBeLessThan(300);
  });

  it('caps an echoed validation message', async () => {
    const message = `problem ${'m'.repeat(800)}`;
    const res = rejectInvalidRequest([{ code: 'VALIDATION_FAILED', message, field: 'title' }]);
    const json = (await res.json()) as { error: string; errors: Array<{ message: string }> };
    expect(json.error).toHaveLength(500);
    expect(json.error).toBe(message.slice(0, 500));
    expect(json.errors[0].message).toBe(message.slice(0, 500));
  });

  it('counts every shape problem when the response stops at 20', async () => {
    const accounts = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`slot-${i}`, 'nope']));
    const res = await post(
      body({
        publishing: {
          providers: ['youtube'],
          accounts,
          schedule: { startAt: futureISO(48), times: ['18:00'], timezone: 'Europe/Lisbon' },
        },
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { errors: unknown[] };
    expect(json.errors).toHaveLength(MAX_REPORTED_ISSUES);
    const calls = vi.mocked(trackApiEvent).mock.calls.filter(
      ([name]) => name === 'video_creation_validation_failed',
    );
    expect(calls.at(-1)?.[1]).toMatchObject({ errorCount: 25 });
  });

  it('rejects an oversized provider list before naming each one', () => {
    const outcome = validateProviders(Array.from({ length: 21 }, () => 'youtube'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0].message).toBe(`At most ${MAX_REPORTED_ISSUES} providers.`);
  });

  it('a valid request produces no errors', async () => {
    const outcome = checkSemantics({
      title: 'Porto trip',
      description: 'Agent description.',
      segments,
      providers: ['youtube'],
      options: { videoType: 'hook_lipsync' },
      personaId: 'persona-1',
    });
    expect(outcome.ok).toBe(true);
  });
});

describe('checkSemantics (direct)', () => {
  it('collects every failing group in the documented order', () => {
    const outcome = checkSemantics({
      title: '',
      description: 'Agent description.',
      segments: undefined,
      providers: [],
      options: {},
      personaId: null,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // The persona-less rules need valid options, so they are not reported here.
    expect(outcome.issues.map((i) => i.field)).toEqual([
      'title',
      'options.segments',
      'publishing.providers',
      'options.videoType',
    ]);
  });

  it('skips the persona-less rules when the options themselves are invalid', () => {
    const outcome = checkSemantics({
      title: 'ok',
      description: 'Agent description.',
      segments,
      providers: ['youtube'],
      options: {},
      personaId: null,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.map((i) => i.field)).toEqual(['options.videoType']);
  });

  it('requires a Pinterest board even when the provider name has surrounding whitespace', () => {
    const outcome = checkSemantics({
      title: 'Porto trip',
      description: 'Agent description.',
      segments,
      providers: [' pinterest '],
      options: { videoType: 'hook_lipsync' },
      personaId: 'persona-1',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.map((i) => i.field)).toContain('publishing.pinterestBoardId');
  });

  it('accepts a whitespace-padded Pinterest provider once the board is set', () => {
    const outcome = checkSemantics({
      title: 'Porto trip',
      description: 'Agent description.',
      segments,
      providers: [' pinterest '],
      options: { videoType: 'hook_lipsync' },
      personaId: 'persona-1',
      pinterestBoardId: 'b1',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.providers).toEqual(['pinterest']);
    expect(outcome.value.pinterestBoardId).toBe('b1');
  });
});
