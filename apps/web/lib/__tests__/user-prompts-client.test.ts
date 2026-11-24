import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyIfSessionExpired = vi.hoisted(() => vi.fn());
vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired }));

import {
  createPrompt,
  deletePrompt,
  fetchPrompt,
  fetchPromptVersion,
  fetchPromptVersions,
  fetchPrompts,
  promptFailureKey,
  restorePromptVersion,
  updatePrompt,
} from '@/lib/user-prompts-client';

const DETAIL = { slug: 'my-prompt', title: 'T', description: 'D', source: 'own', visibility: 'private', verified: false, prompt: 'P', body: 'P', versionId: '44444444-4444-4444-8444-444444444444', version: 1 };

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn<typeof fetch>> {
  const mock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  notifyIfSessionExpired.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prompt client', () => {
  it('returns the parsed body of a successful call', async () => {
    stubFetch(Response.json({ success: true, prompt: DETAIL }));
    expect(await fetchPrompt('my-prompt')).toEqual({ success: true, body: { success: true, prompt: DETAIL } });
  });

  it('returns a failure with the status and the server code instead of throwing on HTTP errors', async () => {
    stubFetch(Response.json({ success: false, error: 'raw english text', code: 'PROMPT_SLUG_TAKEN' }, { status: 409 }));
    const result = await createPrompt({ slug: 'a', title: 't', description: '', prompt: 'p', visibility: 'private' });
    expect(result).toEqual({ success: false, status: 409, code: 'PROMPT_SLUG_TAKEN' });
    expect(JSON.stringify(result)).not.toContain('raw english text');
  });

  it('returns a failure for a proxy HTML body that is not JSON', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await fetchPrompts()).toEqual({ success: false, status: 502, code: null });
  });

  it('returns a failure for a 200 whose body does not match the contract', async () => {
    stubFetch(Response.json({ success: true, prompts: [{ slug: 'x' }] }));
    expect(await fetchPrompts()).toEqual({ success: false, status: 200, code: null });
  });

  it('returns a failure with status 0 when the network is down', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    expect(await fetchPrompts()).toEqual({ success: false, status: 0, code: null });
  });

  it('reports a 401 to the session expiry handler', async () => {
    stubFetch(Response.json({ success: false }, { status: 401 }));
    await fetchPrompts();
    expect(notifyIfSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('sends each call with its method, encoded path and JSON body', async () => {
    const fetchMock = stubFetch(Response.json({ success: true, prompt: DETAIL }));
    await createPrompt({ slug: 'my-prompt', title: 'T', description: 'D', prompt: 'P', visibility: 'public' });
    await updatePrompt('my-prompt', { title: 'New' });
    await updatePrompt('my prompt/x', { visibility: 'private' });
    const calls = fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method, init?.body]);
    expect(calls).toEqual([
      ['/api/prompts', 'POST', JSON.stringify({ slug: 'my-prompt', title: 'T', description: 'D', prompt: 'P', visibility: 'public' })],
      ['/api/prompts/my-prompt', 'PATCH', JSON.stringify({ title: 'New' })],
      ['/api/prompts/my%20prompt%2Fx', 'PATCH', JSON.stringify({ visibility: 'private' })],
    ]);
  });

  it('deletes by slug with no body', async () => {
    const fetchMock = stubFetch(Response.json({ success: true }));
    expect(await deletePrompt('my-prompt')).toEqual({ success: true, body: { success: true } });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE', body: undefined });
  });
});

describe('promptFailureKey', () => {
  it.each([
    [{ status: 409, code: 'PROMPT_SLUG_TAKEN' }, 'userPrompts.errorSlugTaken'],
    [{ status: 400, code: 'VALIDATION_FAILED' }, 'userPrompts.errorValidation'],
    [{ status: 429, code: null }, 'userPrompts.errorRateLimited'],
    [{ status: 403, code: 'PERSONA_SCOPE_DENIED' }, 'userPrompts.errorForbidden'],
    [{ status: 409, code: 'PROMPT_VERSION_CONFLICT' }, 'userPrompts.errorVersionConflict'],
    [{ status: 404, code: 'PROMPT_VERSION_NOT_FOUND' }, 'userPrompts.errorVersionNotFound'],
    [{ status: 500, code: 'INTERNAL_ERROR' }, 'userPrompts.errorGeneric'],
    [{ status: 0, code: null }, 'userPrompts.errorGeneric'],
  ])('maps %o to %s', (failure, key) => {
    expect(promptFailureKey({ success: false, ...failure })).toBe(key);
  });
});

const VERSION_ID = '55555555-5555-4555-8555-555555555555';

const PAGE = {
  success: true,
  currentVersion: 2,
  versions: [
    { versionId: VERSION_ID, version: 2, title: 'T', createdAt: '2026-11-24T10:00:00Z', preview: 'P', previewTruncated: false, bodyLength: 1, current: true },
  ],
  truncated: false,
  nextCursor: null,
};

const VERSION_DETAIL = { success: true, version: { versionId: VERSION_ID, version: 2, title: 'T', createdAt: '2026-11-24T10:00:00Z', body: 'P', current: true } };

describe('prompt version client', () => {
  it('lists the versions of an encoded slug, with the cursor as before', async () => {
    const fetchMock = stubFetch(Response.json(PAGE));
    expect(await fetchPromptVersions('my-prompt')).toEqual({ success: true, body: PAGE });
    await fetchPromptVersions('my prompt/x', { before: 6 });
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET'])).toEqual([
      ['/api/prompts/my-prompt/versions', 'GET'],
      ['/api/prompts/my%20prompt%2Fx/versions?before=6', 'GET'],
    ]);
  });

  it('reads one version', async () => {
    const fetchMock = stubFetch(Response.json(VERSION_DETAIL));
    expect(await fetchPromptVersion('my-prompt', 2)).toEqual({ success: true, body: VERSION_DETAIL });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/prompts/my-prompt/versions/2');
  });

  it('posts the restore with expectedCurrentVersion', async () => {
    const restored = { success: true, restored: true, prompt: { ...DETAIL, version: 3 } };
    const fetchMock = stubFetch(Response.json(restored));
    expect(await restorePromptVersion('my-prompt', 1, 2)).toEqual({ success: true, body: restored });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect([String(url), init?.method, init?.body]).toEqual([
      '/api/prompts/my-prompt/versions/1/restore',
      'POST',
      JSON.stringify({ expectedCurrentVersion: 2 }),
    ]);
  });

  it.each([
    ['list', () => fetchPromptVersions('my-prompt')],
    ['read', () => fetchPromptVersion('my-prompt', 1)],
    ['restore', () => restorePromptVersion('my-prompt', 1, 2)],
  ])('%s returns the status and code of an HTTP error instead of throwing', async (_label, run) => {
    stubFetch(Response.json({ success: false, error: 'raw english text', code: 'PROMPT_VERSION_CONFLICT' }, { status: 409 }));
    const result = await run();
    expect(result).toEqual({ success: false, status: 409, code: 'PROMPT_VERSION_CONFLICT' });
    expect(JSON.stringify(result)).not.toContain('raw english text');
  });

  it.each([
    ['list', () => fetchPromptVersions('my-prompt')],
    ['read', () => fetchPromptVersion('my-prompt', 1)],
    ['restore', () => restorePromptVersion('my-prompt', 1, 2)],
  ])('%s returns a failure for a proxy HTML body', async (_label, run) => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await run()).toEqual({ success: false, status: 502, code: null });
  });

  it.each([
    ['list', () => fetchPromptVersions('my-prompt')],
    ['read', () => fetchPromptVersion('my-prompt', 1)],
    ['restore', () => restorePromptVersion('my-prompt', 1, 2)],
  ])('%s returns a failure for a 200 that does not match the contract', async (_label, run) => {
    stubFetch(Response.json({ success: true, versions: 'nope' }));
    expect(await run()).toEqual({ success: false, status: 200, code: null });
  });

  it.each([
    ['list', () => fetchPromptVersions('my-prompt')],
    ['read', () => fetchPromptVersion('my-prompt', 1)],
    ['restore', () => restorePromptVersion('my-prompt', 1, 2)],
  ])('%s returns status 0 when the network is down', async (_label, run) => {
    stubFetch(new TypeError('Failed to fetch'));
    expect(await run()).toEqual({ success: false, status: 0, code: null });
  });
});
