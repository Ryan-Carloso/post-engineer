import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANNED_PHRASES,
  MONITOR_TOPICS,
  buildPrompt,
  generateScript,
  pickAngle,
  resolveTopic,
  rotateTopic,
  validateScript,
} from './write-script.mjs';

function goodScript(overrides = {}) {
  return {
    title: 'Porto in one day: what to visit first',
    segments: [
      { kind: 'hook', text: 'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.' },
      { kind: 'body', text: 'Start in Ribeira in the morning, walk along the water, cross the Dom Luis I bridge on the lower deck, and look back at the coloured houses from the Gaia side.' },
      { kind: 'body', text: 'Spend the afternoon in one cellar in Vila Nova de Gaia, taste a ruby and a tawny port, and finish back in Ribeira for dinner when the lights come on over the river.' },
      { kind: 'cta', text: 'Save this one day plan and tell me which stop you would skip first.' },
    ],
    ...overrides,
  };
}

test('validateScript accepts a good script', () => {
  const result = validateScript(goodScript());
  assert.equal(result.ok, true);
  assert.equal(result.value.totalWords, 102);
});

test('validateScript rejects a hook that is too short, a body that is too short, and a CTA out of range', () => {
  assert.equal(validateScript(goodScript({ segments: [
    { kind: 'hook', text: 'Porto is nice.' },
    { kind: 'body', text: 'Walk around and eat something good while you are there.' },
    { kind: 'cta', text: 'Save this.' },
  ] })).ok, false);
  assert.match(validateScript(goodScript({ segments: [
    { kind: 'hook', text: 'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.' },
    { kind: 'body', text: 'Walk around.' },
    { kind: 'cta', text: 'Save this one day plan and tell me which stop you would skip first.' },
  ] })).error.rule, /Body must have at least/);
  assert.match(validateScript(goodScript({ segments: [
    { kind: 'hook', text: 'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.' },
    { kind: 'body', text: 'Start in Ribeira in the morning, walk along the water, cross the Dom Luis I bridge on the lower deck, and look back at the coloured houses from the Gaia side.' },
    { kind: 'body', text: 'Spend the afternoon in one cellar in Vila Nova de Gaia, taste a ruby and a tawny port, and finish back in Ribeira for dinner when the lights come on over the river.' },
    { kind: 'cta', text: 'Save this.' },
  ] })).error.rule, /CTA must be/);
});

test('validateScript rejects wrong order, repeated text, and forbidden content', () => {
  const script = goodScript();
  assert.equal(validateScript({ ...script, segments: [...script.segments].reverse() }).ok, false);
  const repeated = goodScript();
  repeated.segments[2] = { kind: 'body', text: repeated.segments[1].text };
  assert.match(validateScript(repeated).error.rule, /must not repeat/);
  const linked = goodScript();
  linked.segments[1] = { kind: 'body', text: 'Start in Ribeira, see https://example.com for details, and walk along the water to the bridge in the morning.' };
  assert.equal(validateScript(linked).ok, false);
  const slop = goodScript();
  slop.segments[1] = { kind: 'body', text: 'Start in Ribeira in the morning for a seamless experience that will unlock the next-level magic of Porto, and walk along the water to the bridge.' };
  assert.equal(validateScript(slop).ok, false);
});

test('validateScript rejects every banned phrase in the prompt base', () => {
  for (const phrase of BANNED_PHRASES) {
    const script = goodScript();
    script.segments[1] = { kind: 'body', text: `Start in Ribeira in the morning, walk along the water, cross the bridge, and enjoy ${phrase} while you look back at the coloured houses from the Gaia side today.` };
    assert.equal(validateScript(script).ok, false, phrase);
  }
});

test('rotateTopic is deterministic for a date and cycles through the list', () => {
  const a = rotateTopic(['a', 'b', 'c'], new Date('2026-03-01T12:00:00Z'));
  const b = rotateTopic(['a', 'b', 'c'], new Date('2026-03-01T23:59:59Z'));
  assert.equal(a, b);
  assert.throws(() => rotateTopic([], new Date()));
});

test('resolveTopic prefers the explicit topic and rotates when empty', () => {
  assert.equal(resolveTopic({ TEST_FLIGHT_TOPIC: '  hello world ' }), 'hello world');
  assert.ok(MONITOR_TOPICS.includes(resolveTopic({ TEST_FLIGHT_TOPIC: '' }, new Date('2026-01-15T00:00:00Z'))));
});

test('pickAngle is deterministic and varies with the run seed', () => {
  assert.equal(pickAngle('run-1-2026-11-01'), pickAngle('run-1-2026-11-01'));
  const angles = new Set(['run-1', 'run-2', 'run-3', 'run-4', 'run-5', 'run-6', 'run-7', 'run-8'].map(pickAngle));
  assert.ok(angles.size > 1);
});

test('buildPrompt with facts restricts the LLM to the search results', () => {
  const prompt = buildPrompt({ topic: 'Porto in one day', angle: 'budget', facts: '- Ribeira (https://example.test/r): Ribeira is the old riverside district.' });
  assert.ok(prompt.includes('Use ONLY facts from these results'));
  assert.ok(prompt.includes('Ribeira is the old riverside district'));
});

test('buildPrompt is standalone: it carries topic, angle, contract, and banned phrases, with no em dash', () => {
  const prompt = buildPrompt({ topic: 'Porto in one day', angle: 'budget: the best version that costs little or nothing' });
  assert.ok(prompt.includes('Porto in one day'));
  assert.ok(prompt.includes('budget:'));
  assert.ok(prompt.includes('60-200 words'));
  assert.ok(prompt.includes('Hook 15-40 words'));
  assert.ok(prompt.includes('unlock'));
  assert.ok(prompt.includes('JSON only'));
  assert.equal(prompt.includes('—'), false);
  assert.equal(prompt.includes('see the base'), false);
});

function jsonFetch(content) {
  return async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  });
}

test('generateScript uses a valid LLM script and never returns the key in the output', async () => {
  const script = await generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'llm-key', baseUrl: 'https://llm.example.test/v1', model: 'test-model' },
    fetchFn: jsonFetch(goodScript()),
  });
  assert.equal(script.source, 'llm');
  assert.equal(script.title, goodScript().title);
  assert.equal(JSON.stringify(script).includes('llm-key'), false);
});

test('generateScript retries once after a validation failure, then throws instead of publishing a repeat script', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    const bad = goodScript();
    bad.segments[0] = { kind: 'hook', text: 'Porto is nice.' };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(bad) } }] }) };
  };
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn,
  }), /failing the job instead of publishing a repeat script/);
  assert.equal(calls, 2);
});

test('generateScript throws when the LLM endpoint fails or no key is configured', async () => {
  const failing = async () => ({ ok: false, status: 500, text: async () => 'down' });
  await assert.rejects(() => generateScript({
    topic: 'Morning in Porto: the perfect riverside walk',
    angle: 'walking-route',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn: failing,
  }), /failing the job instead of publishing a repeat script/);
  await assert.rejects(() => generateScript({ topic: 'Morning in Porto: the perfect riverside walk', angle: 'walking-route', llm: null }), /missing TEST_FLIGHT_LLM_API_KEY/);
});
