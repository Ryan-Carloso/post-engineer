import { describe, it, expect, afterEach } from 'vitest';
import { GET } from '../route';

describe('GET /api/coverage', () => {
  afterEach(() => {
    // Never leak fake coverage into other tests sharing this process.
    delete globalThis.__coverage__;
  });

  it('returns 204 when the server was built without instrumentation', async () => {
    delete globalThis.__coverage__;
    const res = await GET();
    expect(res.status).toBe(204);
  });

  it('returns the instrumented coverage map as JSON under body.coverage', async () => {
    // Shape matches what @cypress/code-coverage expects: it reads
    // `body.coverage` from this endpoint and merges it into the report.
    const fakeCoverage = {
      '/app/app/api/health/route.ts': {
        path: '/app/app/api/health/route.ts',
        s: { 1: 3 },
      },
    };
    globalThis.__coverage__ = fakeCoverage;

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ coverage: fakeCoverage });
  });

  it('never crashes when the coverage global is present but empty', async () => {
    globalThis.__coverage__ = {};
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ coverage: {} });
  });
});
