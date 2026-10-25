import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

describe('fetchPostDetail generation warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps generation warning strings and drops the rest', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      kind: 'generation',
      generation: {
        id: 'row-1',
        generationId: 'gen-3',
        progress: 10,
        stage: 'audio',
        warnings: ['avatar_disabled', 2, ''],
      },
    }));
    const { fetchPostDetail } = await import('@/lib/api');
    const withCodes = await fetchPostDetail('gen-3');
    if (withCodes?.kind !== 'generation') throw new Error('expected generation');
    expect(withCodes.generation.warnings).toEqual(['avatar_disabled', '']);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      kind: 'generation',
      generation: { id: 'row-1', generationId: 'gen-3', progress: 10, stage: 'audio', warnings: 'nope' },
    }));
    const malformed = await fetchPostDetail('gen-3');
    if (malformed?.kind !== 'generation') throw new Error('expected generation');
    expect(malformed.generation.warnings).toEqual([]);
  });
});
