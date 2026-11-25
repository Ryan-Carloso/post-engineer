import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => ({ capture: vi.fn(), captureAs: vi.fn() })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../validate-script/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { HOOK_TITLE_CODES, HOOK_TITLE_MAX_CHARS } from '@/lib/generation/hook-title';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.';
const content =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const ctaTake = 'Save this video before your next trip to Porto.';
const segments = [
  { kind: 'hook', text: hook, media: [0, 1, 2, 3, 4].map((photo) => ({ url: `https://e.com/h${photo}.jpg` })) },
  { kind: 'content', text: content, media: [0, 1, 2, 3, 4, 5, 6, 7].map((photo) => ({ url: `https://e.com/b${photo}.jpg` })) },
  { kind: 'content', text: ctaTake, media: [0, 1].map((photo) => ({ url: `https://e.com/c${photo}.jpg` })) },
];

function authRequest(payload: unknown): Request {
  return new Request('https://post-engineer.com/api/videos/validate-script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: 'user-uuid-1', accessToken: 'token' },
    error: null,
  } as never);
});

describe('POST /api/videos/validate-script hookTitle', () => {
  const refused: Array<[string, string, string]> = [
    ['more than seven words', 'one two three four five six seven eight', HOOK_TITLE_CODES.tooManyWords],
    ['more than sixty characters', 'a'.repeat(HOOK_TITLE_MAX_CHARS + 1), HOOK_TITLE_CODES.tooLong],
    ['an empty string', '', HOOK_TITLE_CODES.empty],
    ['a newline', 'line one\nline two', HOOK_TITLE_CODES.invalidChars],
  ];

  it.each(refused)('rejects a title with %s with a 400 carrying its stable code', async (_name, hookTitle, code) => {
    const response = await POST(authRequest({ segments, videoType: 'voiceover', hookTitle }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code?: string; field?: string; error?: string };
    expect(payload.code).toBe(code);
    expect(payload.field).toBe('hookTitle');
    expect(payload.error?.startsWith(`${code}: `)).toBe(true);
  });

  it('rejects a title that is not a string', async () => {
    const response = await POST(authRequest({ segments, videoType: 'voiceover', hookTitle: 7 }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code?: string; field?: string };
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.field).toBe('hookTitle');
  });

  it('accepts a title at the limits and keeps validating the script', async () => {
    const response = await POST(authRequest({ segments, videoType: 'voiceover', hookTitle: 'one two three four five six seven' }));
    expect(response.status).toBe(200);
  });

  it('still rejects a bad script when the title is fine', async () => {
    const response = await POST(authRequest({ segments: [], videoType: 'voiceover', hookTitle: 'Porto?' }));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { field?: string };
    expect(payload.field).toContain('segments');
  });

  it('is still valid without a title', async () => {
    const response = await POST(authRequest({ segments, videoType: 'voiceover' }));
    expect(response.status).toBe(200);
  });
});
