import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));

import { fetchPromptComparison } from '../comparison-query';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

const BODY = { success: true, window: '24h', truncated: false, accounts: [] };

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPromptComparison', () => {
  it('asks for the window and returns the parsed comparison', async () => {
    const fetchMock = stubFetch(Response.json(BODY));
    expect(await fetchPromptComparison('24h')).toEqual(BODY);
    expect(fetchMock).toHaveBeenCalledWith('/api/experiments?window=24h');
    expect(notifyIfSessionExpired).toHaveBeenCalled();
  });

  it('returns a failure for a non-2xx answer', async () => {
    stubFetch(Response.json({ success: false }, { status: 500 }));
    expect(await fetchPromptComparison('7d')).toEqual({ success: false, error: 'HTTP 500' });
  });

  it('returns a failure for a body that is not the comparison, including an HTML proxy page', async () => {
    stubFetch(Response.json({ success: true, accounts: 'nope' }));
    expect(await fetchPromptComparison('7d')).toEqual({ success: false, error: 'unexpected response' });
    stubFetch(new Response('<html>bad gateway</html>', { status: 200 }));
    expect(await fetchPromptComparison('7d')).toEqual({ success: false, error: 'unexpected response' });
  });

  it('returns a failure when the request throws', async () => {
    stubFetch(new Error('offline'));
    expect(await fetchPromptComparison('7d')).toEqual({ success: false, error: 'offline' });
  });
});
