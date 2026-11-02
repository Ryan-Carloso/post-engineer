import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUPLICATE_JACCARD_THRESHOLD,
  buildTopicPrompt,
  fetchRecentTitles,
  generateTopic,
  jaccardSimilarity,
  normalizeTopic,
  validateTopic,
} from './topic-llm.mjs';

function sseResponse(chunks) {
  const text = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function topicFetch(topic, extra = {}) {
  return async () => sseResponse([{
    model: extra.model ?? 'test-model',
    choices: [{ delta: { content: JSON.stringify({ topic, whyDifferent: extra.whyDifferent ?? 'A different place and dish.' }) } }],
  }]);
}

test('normalizeTopic strips case, punctuation, and accents', () => {
  assert.equal(normalizeTopic('  Açores: Best Beaches! '), 'acores best beaches');
  assert.equal(normalizeTopic('Where Locals Eat in Porto'), 'where locals eat in porto');
});

test('jaccardSimilarity treats a rewording as a near-duplicate and a different topic as distinct', () => {
  assert.ok(jaccardSimilarity('Best beaches in the Algarve', 'The best Algarve beaches') >= DUPLICATE_JACCARD_THRESHOLD);
  assert.ok(jaccardSimilarity('Best beaches in the Algarve', 'Francesinha restaurants in Porto') < DUPLICATE_JACCARD_THRESHOLD);
  assert.equal(jaccardSimilarity('Francesinha in Porto', 'Francesinha in Porto'), 1);
});

test('validateTopic rejects an empty topic, an exact repeat, and a near-duplicate', () => {
  const recent = ['Where locals eat in Porto', 'Best beaches in the Algarve'];
  assert.equal(validateTopic('', recent).ok, false);
  assert.equal(validateTopic('  ', recent).ok, false);
  assert.match(validateTopic('Where locals eat in Porto!', recent).error.rule, /repeats a title/);
  assert.match(validateTopic('The best Algarve beaches', recent).error.rule, /near-duplicate/);
});

test('validateTopic rejects topics outside food/travel in Portugal', () => {
  assert.equal(validateTopic('Best sushi restaurants in Tokyo', []).ok, false);
  assert.equal(validateTopic('How to fix a bicycle', []).ok, false);
  assert.equal(validateTopic('Bacalhau dishes', []).ok, false, 'food with no place signal is not enough');
  assert.equal(validateTopic('Bacalhau dishes in Lisbon', []).ok, true);
  assert.equal(validateTopic('Best beaches in the Algarve', []).ok, true);
  assert.equal(validateTopic('Francesinha restaurants in Porto', []).ok, true);
  assert.equal(validateTopic('Portuguese custard tarts in Lisbon', []).ok, true);
});

test('buildTopicPrompt carries the niche, the recent titles, and the JSON shape', () => {
  const prompt = buildTopicPrompt({ recentTitles: ['Where locals eat in Porto'] });
  assert.ok(prompt.includes('food or travel in a place in Portugal'));
  assert.ok(prompt.includes('Where locals eat in Porto'));
  assert.ok(prompt.includes('{"topic":'));
  const empty = buildTopicPrompt({ recentTitles: [] });
  assert.ok(empty.includes('none'));
});

test('fetchRecentTitles keeps published titles inside 30 days plus upcoming, and drops failed and old titles', async () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const fetchFn = async (url, options) => {
    assert.ok(url.includes('/api/schedule/status?limit=500'));
    assert.equal(options.headers.authorization, 'Bearer test-key');
    return new Response(JSON.stringify({
      success: true,
      upcoming: [{ title: 'Queued Algarve beaches', slot_at: '2026-11-02T10:00:00Z', status: 'pending' }],
      recent: [
        { title: 'Recent Porto food walk', status: 'published', published_at: '2026-10-20T10:00:00Z', slot_at: '2026-10-20T10:00:00Z' },
        { title: 'Old Porto food walk', status: 'published', published_at: '2026-09-01T10:00:00Z', slot_at: '2026-09-01T10:00:00Z' },
        { title: 'Failed Porto food walk', status: 'failed', published_at: '2026-10-25T10:00:00Z', slot_at: '2026-10-25T10:00:00Z' },
        { title: '  ', status: 'published', published_at: '2026-10-28T10:00:00Z', slot_at: '2026-10-28T10:00:00Z' },
      ],
    }), { status: 200 });
  };
  const titles = await fetchRecentTitles({ apiBaseUrl: 'https://post-engineer.com', apiKey: 'test-key', fetchFn, now });
  assert.deepEqual(titles, ['Recent Porto food walk', 'Queued Algarve beaches']);
});

test('fetchRecentTitles returns an empty list when the API returns no slots', async () => {
  const fetchFn = async () => new Response(JSON.stringify({ success: true, recent: [], upcoming: [] }), { status: 200 });
  assert.deepEqual(await fetchRecentTitles({ apiBaseUrl: 'https://x.example.test', apiKey: 'k', fetchFn, now: new Date() }), []);
});

test('fetchRecentTitles throws on HTTP errors, success:false, and unparseable bodies', async () => {
  const badStatus = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(() => fetchRecentTitles({ apiBaseUrl: 'https://x.example.test', apiKey: 'k', fetchFn: badStatus, now: new Date() }), /HTTP 403/);
  const badEnvelope = async () => new Response(JSON.stringify({ success: false }), { status: 200 });
  await assert.rejects(() => fetchRecentTitles({ apiBaseUrl: 'https://x.example.test', apiKey: 'k', fetchFn: badEnvelope, now: new Date() }), /unexpected shape/);
  const badJson = async () => new Response('not json', { status: 200 });
  await assert.rejects(() => fetchRecentTitles({ apiBaseUrl: 'https://x.example.test', apiKey: 'k', fetchFn: badJson, now: new Date() }), /unexpected shape/);
  await assert.rejects(() => fetchRecentTitles({ apiBaseUrl: 'https://x.example.test', apiKey: '', fetchFn: badStatus, now: new Date() }), /missing TEST_FLIGHT_POST_ENGINEER_API_KEY/);
});

test('generateTopic returns a validated topic and never logs the key', async () => {
  const result = await generateTopic({
    llm: { apiKey: 'llm-key', baseUrl: 'https://llm.example.test/v1', models: ['m'] },
    recentTitles: ['Where locals eat in Porto'],
    fetchFn: topicFetch('Best beaches in the Algarve'),
  });
  assert.equal(result.topic, 'Best beaches in the Algarve');
  assert.equal(JSON.stringify(result).includes('llm-key'), false);
});

test('generateTopic retries once after a duplicate proposal, then succeeds', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return sseResponse([{ choices: [{ delta: { content: JSON.stringify({ topic: calls === 1 ? 'Where locals eat in Porto' : 'Best beaches in the Algarve', whyDifferent: 'Different place.' }) } }] }]);
  };
  const result = await generateTopic({
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['m'] },
    recentTitles: ['Where locals eat in Porto'],
    fetchFn,
  });
  assert.equal(result.topic, 'Best beaches in the Algarve');
  assert.equal(calls, 2);
});

test('generateTopic falls through a model failure to the next model, then throws instead of inventing a topic', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    if (model === 'second-model') return sseResponse([{ choices: [{ delta: { content: JSON.stringify({ topic: 'Francesinha restaurants in Porto', whyDifferent: 'Different dish.' }) } }] }]);
    return { ok: false, status: 500, text: async () => 'down' };
  };
  const result = await generateTopic({
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['first-model', 'second-model'] },
    recentTitles: [],
    fetchFn,
  });
  assert.deepEqual(calls, ['first-model', 'second-model']);
  assert.equal(result.topic, 'Francesinha restaurants in Porto');
  const failing = async () => ({ ok: false, status: 500, text: async () => 'down' });
  await assert.rejects(() => generateTopic({
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['m'] },
    recentTitles: [],
    fetchFn: failing,
  }), /failing the job instead of publishing a repeat/);
  await assert.rejects(() => generateTopic({ llm: null, recentTitles: [], fetchFn: failing }), /missing TEST_FLIGHT_LLM_API_KEY/);
});

test('generateTopic rejects an out-of-niche proposal and retries with the named failure', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return sseResponse([{ choices: [{ delta: { content: JSON.stringify({ topic: calls === 1 ? 'Best sushi in Tokyo' : 'Best beaches in the Algarve', whyDifferent: 'Portugal, not Tokyo.' }) } }] }]);
  };
  const result = await generateTopic({
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['m'] },
    recentTitles: [],
    fetchFn,
  });
  assert.equal(result.topic, 'Best beaches in the Algarve');
  assert.equal(calls, 2);
});
