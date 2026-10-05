import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewNames } from './llm.mjs';

const CONFIG = {
  apiPaths: [],
  denylist: {},
  allowlist: [],
  llm: {
    enabled: true,
    baseUrl: 'https://llm.example.test/v1',
    model: 'test-model',
    maxNames: 20,
    timeoutMs: 5000,
  },
};

function candidate(name, context) {
  return {
    file: 'apps/web/app/api/x/route.ts',
    line: 10,
    name,
    context: context ?? `${name}: 0`,
    renamedFrom: null,
  };
}

/** Build a mock fetch that answers from a name -> verdict map. */
function mockFetch(verdicts, { status = 200, raw = null, calls = null } = {}) {
  return async (url, init) => {
    if (calls) calls.push({ url, init });
    if (raw !== null) {
      return { ok: status >= 200 && status < 300, status, json: async () => { throw new Error('no json'); }, text: async () => raw };
    }
    const body = JSON.parse(init.body);
    const promptText = JSON.stringify(body.messages);
    // Names appear JSON-escaped in the serialized body: named \"retry\".
    const name = Object.keys(verdicts).find((n) => promptText.includes(`\\"${n}\\"`)) ?? 'unknown';
    const verdict = verdicts[name] ?? { verdict: 'pass', reason: 'Clear.', alternatives: [] };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(verdict) } }] }),
      text: async () => 'error-body',
    };
  };
}

describe('reviewNames', () => {
  it('flags retry used as a counter with alternatives, passes retryCount', async () => {
    const calls = [];
    const res = await reviewNames(
      [
        candidate('retry', 'return NextResponse.json({ retry: 3 }); // number of attempts so far'),
        candidate('retryCount', 'return NextResponse.json({ retryCount: 3 });'),
      ],
      CONFIG,
      {
        apiKey: 'k',
        fetchImpl: mockFetch(
          {
            retry: {
              verdict: 'warn',
              reason: 'Ambiguous: could be a boolean, a count, or an object.',
              alternatives: ['retryCount', 'attemptCount'],
            },
          },
          { calls },
        ),
      },
    );
    assert.equal(res.findings.length, 1);
    const f = res.findings[0];
    assert.equal(f.name, 'retry');
    assert.equal(f.severity, 'warn');
    assert.equal(f.source, 'llm');
    assert.deepEqual(f.alternatives, ['retryCount', 'attemptCount']);
    assert.match(f.reason, /Ambiguous/);
    assert.equal(calls.length, 2);
    // The request targets the configured OpenAI-compatible endpoint.
    assert.equal(calls[0].url, 'https://llm.example.test/v1/chat/completions');
  });

  it('maps an LLM fail verdict to error severity', async () => {
    const res = await reviewNames([candidate('replay')], CONFIG, {
      apiKey: 'k',
      fetchImpl: mockFetch({ replay: { verdict: 'fail', reason: 'Bad.', alternatives: ['x'] } }),
    });
    assert.equal(res.findings[0].severity, 'error');
  });

  it('skips gracefully with a warning when no API key is configured', async () => {
    const res = await reviewNames([candidate('retry')], CONFIG, { apiKey: '' });
    assert.deepEqual(res.findings, []);
    assert.equal(res.skipped, 1);
    assert.ok(res.warnings.some((w) => w.includes('API_NAMING_LLM_API_KEY')));
  });

  it('never fails on LLM infrastructure errors (HTTP 500)', async () => {
    const res = await reviewNames([candidate('retry')], CONFIG, {
      apiKey: 'k',
      fetchImpl: mockFetch({}, { status: 500 }),
    });
    assert.deepEqual(res.findings, []);
    assert.ok(res.warnings.some((w) => w.includes('500')));
  });

  it('never fails on malformed model output', async () => {
    const res = await reviewNames([candidate('retry')], CONFIG, {
      apiKey: 'k',
      fetchImpl: mockFetch({}, { raw: 'not json at all' }),
    });
    assert.deepEqual(res.findings, []);
    assert.ok(res.warnings.length > 0);
  });

  it('respects maxNames and reports skipped extras', async () => {
    const cfg = { ...CONFIG, llm: { ...CONFIG.llm, maxNames: 1 } };
    const res = await reviewNames([candidate('a'), candidate('b')], cfg, {
      apiKey: 'k',
      fetchImpl: mockFetch({}),
    });
    assert.equal(res.skipped, 1);
    assert.ok(res.warnings.some((w) => w.includes('maxNames') || w.includes('cap')));
  });

  it('strips markdown code fences from model output', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"verdict":"fail","reason":"r","alternatives":[]}\n```' } }],
      }),
      text: async () => '',
    });
    const res = await reviewNames([candidate('x')], CONFIG, { apiKey: 'k', fetchImpl });
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].severity, 'error');
  });
});
