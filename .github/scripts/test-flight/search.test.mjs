import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFacts, searchExa, searchFacts, searchTavily } from './search.mjs';

test('searchTavily reads title, url, and content, and drops empty snippets', async () => {
  const fetchFn = async (url, options) => {
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal(options.headers.authorization, 'Bearer tavily-key');
    assert.equal(JSON.parse(options.body).search_depth, 'basic');
    return {
      ok: true,
      json: async () => ({ results: [
        { title: 'Ribeira', url: 'https://example.test/ribeira', content: 'Ribeira is the old riverside district of Porto.' },
        { title: 'Empty', url: 'https://example.test/empty', content: '   ' },
      ] }),
    };
  };
  const results = await searchTavily({ query: 'Porto Ribeira', apiKey: 'tavily-key', fetchFn });
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://example.test/ribeira');
  assert.equal(JSON.stringify(results).includes('tavily-key'), false);
});

test('searchExa reads highlights, falling back to text', async () => {
  const fetchFn = async (url, options) => {
    assert.equal(url, 'https://api.exa.ai/search');
    return {
      ok: true,
      json: async () => ({ results: [
        { title: 'Gaia', url: 'https://example.test/gaia', highlights: ['Port wine cellars line the Gaia riverfront.'] },
        { title: 'Bridge', url: 'https://example.test/bridge', text: 'The Dom Luis I bridge crosses the Douro.' },
      ] }),
    };
  };
  const results = await searchExa({ query: 'Porto Gaia', apiKey: 'exa-key', fetchFn });
  assert.equal(results.length, 2);
  assert.match(results[0].snippet, /cellars/);
  assert.match(results[1].snippet, /bridge/);
});

test('searchFacts tries Tavily first, then Exa on failure, and reports the provider', async () => {
  const fetchFn = async (url) => {
    if (url.includes('tavily')) return { ok: false, status: 500 };
    return { ok: true, json: async () => ({ results: [{ title: 'Gaia', url: 'https://example.test/gaia', highlights: ['Cellars in Gaia.'] }] }) };
  };
  const found = await searchFacts({ topic: 'Porto', tavilyKey: 't', exaKey: 'e', fetchFn });
  assert.equal(found.provider, 'exa');
  assert.equal(found.sources.length, 1);
  assert.match(found.facts, /Gaia/);
});

test('searchFacts uses Tavily alone when no Exa key is set', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ results: [{ title: 'Ribeira', url: 'https://example.test/r', content: 'Ribeira.' }] }) });
  const found = await searchFacts({ topic: 'Porto', tavilyKey: 't', exaKey: '', fetchFn });
  assert.equal(found.provider, 'tavily');
});

test('searchFacts throws when no key is set and when both providers fail', async () => {
  await assert.rejects(() => searchFacts({ topic: 'Porto', tavilyKey: '', exaKey: '', fetchFn: async () => ({ ok: true }) }), /no TEST_FLIGHT_TAVILY_API_KEY or TEST_FLIGHT_EXA_API_KEY set/);
  const failing = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => searchFacts({ topic: 'Porto', tavilyKey: 't', exaKey: 'e', fetchFn: failing }), /all providers failed/);
});

test('formatFacts caps snippet length so the prompt stays bounded', () => {
  const facts = formatFacts([{ title: 'X', url: 'https://example.test/x', snippet: 'a'.repeat(1000) }]);
  assert.ok(facts.length < 600);
});
