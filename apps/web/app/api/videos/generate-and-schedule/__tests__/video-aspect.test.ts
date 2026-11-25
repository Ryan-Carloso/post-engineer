// @vitest-environment node
import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { resolveVideoAspect } from '../video-aspect';

describe('resolveVideoAspect', () => {
  it('prefers the request aspect over the persona aspect', () => {
    expect(resolveVideoAspect({ videoAspect: '16:9' }, { videoAspect: '1:1' })).toBe('16:9');
  });

  it('falls back to the persona aspect, then to portrait', () => {
    expect(resolveVideoAspect({}, { videoAspect: '1:1' })).toBe('1:1');
    expect(resolveVideoAspect({}, { videoAspect: null })).toBe('9:16');
  });

  it('rejects an aspect the persona stores that no video format uses, pointing at the persona', async () => {
    const result = resolveVideoAspect({}, { videoAspect: '4:3' });

    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error('expected a response');
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'personaId' });
  });
});
