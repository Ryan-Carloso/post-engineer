import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyIfSessionExpired = vi.hoisted(() => vi.fn());
vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired }));

import {
  createPrompt,
  deletePrompt,
  fetchPrompt,
  fetchPrompts,
  promptFailureKey,
  updatePrompt,
} from '@/lib/user-prompts-client';

const DETAIL = { slug: 'my-prompt', title: 'T', description: 'D', source: 'own', visibility: 'private', prompt: 'Base\n\nP', body: 'P', versionId: '44444444-4444-4444-8444-444444444444', version: 1 };

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
    [{ status: 409, code: 'PROMPT_SLUG_RESERVED' }, 'userPrompts.errorSlugReserved'],
    [{ status: 400, code: 'VALIDATION_FAILED' }, 'userPrompts.errorValidation'],
    [{ status: 429, code: null }, 'userPrompts.errorRateLimited'],
    [{ status: 403, code: 'PERSONA_SCOPE_DENIED' }, 'userPrompts.errorForbidden'],
    [{ status: 500, code: 'INTERNAL_ERROR' }, 'userPrompts.errorGeneric'],
    [{ status: 0, code: null }, 'userPrompts.errorGeneric'],
  ])('maps %o to %s', (failure, key) => {
    expect(promptFailureKey({ success: false, ...failure })).toBe(key);
  });
});
