import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANNED_PHRASES,
  buildPrompt,
  generateScript,
  resolveLlmModels,
  pickAngle,
  validateScript,
  writeScriptFile,
} from './write-script.mjs';

function goodScript(overrides = {}) {
  return {
    title: 'Porto in one day: what to visit first',
    segments: [
      { kind: 'hook', text: 'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.' },
      { kind: 'content', text: 'Start in Ribeira in the morning, walk along the water, cross the Dom Luis I bridge on the lower deck, and look back at the coloured houses from the Gaia side.' },
      { kind: 'content', text: 'Spend the afternoon in one cellar in Vila Nova de Gaia, taste a ruby and a tawny port, and finish back in Ribeira for dinner when the lights come on over the river.' },
      { kind: 'content', text: 'Save this one day plan and tell me which stop you would skip first.' },
    ],
    ...overrides,
  };
}

test('validateScript accepts a good script', () => {
  const result = validateScript(goodScript());
  assert.equal(result.ok, true);
  assert.equal(result.value.totalWords, 102);
});

test('validateScript rejects a hook that is too short and content that is too short', () => {
  assert.equal(validateScript(goodScript({ segments: [
    { kind: 'hook', text: 'Porto is nice.' },
    { kind: 'content', text: 'Walk around and eat something good while you are there.' },
    { kind: 'content', text: 'Save this.' },
  ] })).ok, false);
  assert.match(validateScript(goodScript({ segments: [
    { kind: 'hook', text: 'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.' },
    { kind: 'content', text: 'Walk around.' },
    { kind: 'content', text: 'Save this one day plan and tell me which stop you would skip first.' },
  ] })).error.rule, /Content must have at least/);
});

test('validateScript accepts short and long content takes: there is no CTA word range', () => {
  // Issue #577: a two-word content take and a 21-word content take
  // both pass — the old 5-20 CTA range does not apply to content takes.
  assert.equal(validateScript(goodScript({ segments: [
    { kind: 'hook', text: 'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.' },
    { kind: 'content', text: 'Start in Ribeira in the morning, walk along the water, cross the Dom Luis I bridge on the lower deck, and look back at the coloured houses from the Gaia side.' },
    { kind: 'content', text: 'Spend the afternoon in one cellar in Vila Nova de Gaia, taste a ruby and a tawny port, and finish back in Ribeira for dinner when the lights come on over the river.' },
    { kind: 'content', text: 'Save this.' },
  ] })).ok, true);
  assert.equal(validateScript(goodScript({ segments: [
    { kind: 'hook', text: 'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.' },
    { kind: 'content', text: 'Start in Ribeira in the morning, walk along the water, cross the Dom Luis I bridge on the lower deck, and look back at the coloured houses from the Gaia side.' },
    { kind: 'content', text: Array.from({ length: 21 }, () => 'word').join(' ') + '.' },
  ] })).ok, true);
});

test('validateScript accepts a CTA take in the middle of the video', () => {
  // Issue #577: a CTA is just a content take, so it may sit anywhere
  // after the hook — here in the middle — and the video still renders
  // in take order.
  assert.equal(validateScript(goodScript({ segments: [
    { kind: 'hook', text: 'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.' },
    { kind: 'content', text: 'Save this one day plan and tell me which stop you would skip first.' },
    { kind: 'content', text: 'Start in Ribeira in the morning, walk along the water, cross the Dom Luis I bridge on the lower deck, and look back at the coloured houses from the Gaia side.' },
  ] })).ok, true);
});

test('validateScript rejects wrong order, repeated text, and forbidden content', () => {
  const script = goodScript();
  assert.equal(validateScript({ ...script, segments: [...script.segments].reverse() }).ok, false);
  const repeated = goodScript();
  repeated.segments[2] = { kind: 'content', text: repeated.segments[1].text };
  assert.match(validateScript(repeated).error.rule, /must not repeat/);
  const linked = goodScript();
  linked.segments[1] = { kind: 'content', text: 'Start in Ribeira, see https://example.com for details, and walk along the water to the bridge in the morning.' };
  assert.equal(validateScript(linked).ok, false);
  const slop = goodScript();
  slop.segments[1] = { kind: 'content', text: 'Start in Ribeira in the morning for a seamless experience that will unlock the next-level magic of Porto, and walk along the water to the bridge.' };
  assert.equal(validateScript(slop).ok, false);
});

test('validateScript rejects every banned phrase in the prompt base', () => {
  for (const phrase of BANNED_PHRASES) {
    const script = goodScript();
    script.segments[1] = { kind: 'content', text: `Start in Ribeira in the morning, walk along the water, cross the bridge, and enjoy ${phrase} while you look back at the coloured houses from the Gaia side today.` };
    assert.equal(validateScript(script).ok, false, phrase);
  }
});

test('writeScriptFile with an explicit topic skips the history fetch and the LLM topic step', async () => {
  const seenUrls = [];
  const fetchFn = async (url, options) => {
    seenUrls.push(url);
    const body = JSON.parse(options.body);
    assert.ok(body.messages[0].content.includes('short spoken video scripts'));
    return sseResponse([{ choices: [{ delta: { content: JSON.stringify(goodScript()) } }] }]);
  };
  let written = '';
  const out = await writeScriptFile({
    TEST_FLIGHT_TOPIC: '  Francesinha restaurants in Porto ',
    TEST_FLIGHT_RUN_ID: 'run-9',
    TEST_FLIGHT_SCRIPT_PATH: 'out.json',
    TEST_FLIGHT_LLM_API_KEY: 'llm-key',
    TEST_FLIGHT_LLM_BASE_URL: 'https://llm.example.test/v1',
    TEST_FLIGHT_LLM_MODEL: 'm',
  }, {
    fetchFn,
    search: { provider: 'tavily', facts: '- Ribeira (https://example.test/r): Ribeira is the old riverside district.', sources: ['https://example.test/r'] },
    writeFile: async (path, content) => { written = content; },
  });
  assert.equal(out.topic, 'Francesinha restaurants in Porto');
  assert.equal(out.topicSource, 'explicit');
  assert.equal(seenUrls.some((url) => url.includes('/api/schedule/status')), false);
  assert.ok(written.includes('Francesinha restaurants in Porto'));
});

test('writeScriptFile with no explicit topic fetches history, asks the LLM for a topic, then writes the script', async () => {
  const seenUrls = [];
  const fetchFn = async (url, options) => {
    seenUrls.push(url);
    if (url.includes('/api/schedule/status')) {
      return new Response(JSON.stringify({
        success: true,
        upcoming: [],
        recent: [{ title: 'Where locals eat in Porto', status: 'published', published_at: '2026-10-28T10:00:00Z', slot_at: '2026-10-28T10:00:00Z' }],
      }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    if (body.messages[0].content.includes('propose video topics')) {
      return sseResponse([{ choices: [{ delta: { content: JSON.stringify({ topic: 'Best beaches in the Algarve', whyDifferent: 'A different region.' }) } }] }]);
    }
    return sseResponse([{ choices: [{ delta: { content: JSON.stringify(goodScript()) } }] }]);
  };
  const out = await writeScriptFile({
    TEST_FLIGHT_TOPIC: '',
    TEST_FLIGHT_RUN_ID: 'run-10',
    TEST_FLIGHT_SCRIPT_PATH: 'out.json',
    TEST_FLIGHT_LLM_API_KEY: 'llm-key',
    TEST_FLIGHT_LLM_BASE_URL: 'https://llm.example.test/v1',
    TEST_FLIGHT_LLM_MODEL: 'm',
    TEST_FLIGHT_POST_ENGINEER_API_KEY: 'pe-key',
    TEST_FLIGHT_API_BASE_URL: 'https://post-engineer.com',
  }, {
    fetchFn,
    search: { provider: 'tavily', facts: '- Algarve (https://example.test/a): The Algarve is the southern coast.', sources: ['https://example.test/a'] },
    writeFile: async () => {},
    now: new Date('2026-11-01T12:00:00Z'),
  });
  assert.equal(out.topic, 'Best beaches in the Algarve');
  assert.equal(out.topicSource, 'llm');
  assert.equal(seenUrls.some((url) => url.includes('/api/schedule/status')), true);
});

test('writeScriptFile fails before search or script when the history fetch fails', async () => {
  const fetchFn = async (url) => {
    if (url.includes('/api/schedule/status')) return { ok: false, status: 500, text: async () => 'down' };
    throw new Error(`unexpected fetch to ${url}`);
  };
  await assert.rejects(() => writeScriptFile({
    TEST_FLIGHT_TOPIC: '',
    TEST_FLIGHT_RUN_ID: 'run-11',
    TEST_FLIGHT_SCRIPT_PATH: 'out.json',
    TEST_FLIGHT_LLM_API_KEY: 'llm-key',
    TEST_FLIGHT_LLM_BASE_URL: 'https://llm.example.test/v1',
    TEST_FLIGHT_LLM_MODEL: 'm',
    TEST_FLIGHT_POST_ENGINEER_API_KEY: 'pe-key',
    TEST_FLIGHT_API_BASE_URL: 'https://post-engineer.com',
  }, { fetchFn }), /topic history/);
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

function sseResponse(chunks) {
  const text = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function streamFetch(content, extra = {}) {
  return async () => sseResponse([{
    model: extra.model ?? 'test-model',
    choices: [{ delta: { content: JSON.stringify(content), ...(extra.reasoning ? { reasoning: extra.reasoning } : {}) } }],
  }]);
}

function delayedStream(lines, delayMs, hangAfter = -1) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (hangAfter !== -1 && index > hangAfter) {
        await new Promise(() => {});
        return;
      }
      if (index < lines.length) {
        if (delayMs > 0) await new Promise((resolve) => { setTimeout(resolve, delayMs); });
        controller.enqueue(new TextEncoder().encode(lines[index]));
        index += 1;
      } else {
        controller.close();
      }
    },
  });
}

test('generateScript uses a valid LLM script and never returns the key in the output', async () => {
  const script = await generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'llm-key', baseUrl: 'https://llm.example.test/v1', model: 'test-model' },
    fetchFn: streamFetch(goodScript()),
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
    return sseResponse([{ choices: [{ delta: { content: JSON.stringify(bad) } }] }]);
  };
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn,
  }), /failing the job instead of publishing a repeat script/);
  assert.equal(calls, 2);
});

test('resolveLlmModels defaults to a fixed free model first with paid GLM last, and puts an explicit model last without duplicating it', () => {
  assert.deepEqual(resolveLlmModels({}), ['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash']);
  assert.deepEqual(resolveLlmModels({ TEST_FLIGHT_LLM_MODEL: 'paid-model' }), ['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash', 'paid-model']);
  assert.deepEqual(resolveLlmModels({ TEST_FLIGHT_LLM_MODEL: 'z-ai/glm-5.3-flash' }), ['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash']);
  assert.deepEqual(resolveLlmModels({ TEST_FLIGHT_LLM_MODELS: 'a-model, b-model' }), ['a-model', 'b-model']);
});

test('generateScript falls through a fixed free model failure to paid GLM and returns it as the model used', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    if (model === 'z-ai/glm-5.3-flash') {
      return sseResponse([{ choices: [{ delta: { content: JSON.stringify(goodScript()) } }] }]);
    }
    return { ok: false, status: 429, text: async () => '{"error": {"message": "No free model available."}}' };
  };
  const script = await generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: resolveLlmModels({}) },
    fetchFn,
  });
  assert.deepEqual(calls, ['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash']);
  assert.equal(script.source, 'llm');
  assert.equal(script.model, 'z-ai/glm-5.3-flash');
});

test('generateScript throws when the fixed free model and paid GLM both fail, instead of publishing a repeat script', async () => {
  const failing = async () => ({ ok: false, status: 429, text: async () => '{"error": {"type": "FreeUsageLimitError"}}' });
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: resolveLlmModels({}) },
    fetchFn: failing,
  }), /failing the job instead of publishing a repeat script/);
});

test('generateScript tries the chain in order and reports the model used', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    assert.equal(JSON.parse(options.body).stream, true);
    if (model === 'nvidia/nemotron-3.5-lightning:free') return { ok: false, status: 500, text: async () => 'down' };
    return sseResponse([{ choices: [{ delta: { content: JSON.stringify(goodScript()) } }] }]);
  };
  const script = await generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash'] },
    fetchFn,
  });
  assert.deepEqual(calls, ['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash']);
  assert.equal(script.model, 'z-ai/glm-5.3-flash');
});

test('generateScript logs the actual response model and reasoning/content lengths, never reasoning text', async () => {
  const logged = [];
  const originalLog = console.log;
  console.log = (...args) => { logged.push(args.join(' ')); };
  try {
    const fetchFn = async () => sseResponse([{
      model: 'nvidia/nemotron-3.5-lightning:free',
      choices: [{ delta: { content: JSON.stringify(goodScript()), reasoning: 'thinking that must never appear in logs' } }],
    }]);
    const script = await generateScript({
      topic: 'Porto in one day: what to visit first',
      angle: 'budget',
      llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['nvidia/nemotron-3.5-lightning:free'] },
      fetchFn,
    });
    assert.equal(script.model, 'nvidia/nemotron-3.5-lightning:free');
    const responseLine = logged.find((line) => line.includes('LLM response model='));
    assert.match(responseLine, /model=nvidia\/nemotron-3\.5-lightning:free reasoning=39 chars content=\d+ chars/);
    assert.equal(logged.some((line) => line.includes('thinking that must never appear in logs')), false);
  } finally {
    console.log = originalLog;
  }
});

test('generateScript distinguishes an empty completion with reasoning from one without', async () => {
  const withReasoning = async () => sseResponse([{
    choices: [{ delta: { content: '', reasoning_content: 'some internal thinking' } }],
  }]);
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['m'] },
    fetchFn: withReasoning,
  }), /LLM returned an empty completion \(reasoning present, 22 chars\)/);
  const withoutReasoning = async () => sseResponse([{
    choices: [{ delta: { content: '   ' } }],
  }]);
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['m'] },
    fetchFn: withoutReasoning,
  }), /LLM returned an empty completion \(no reasoning\)/);
});

test('generateScript never parses reasoning text as the script', async () => {
  const reasoningScript = goodScript();
  reasoningScript.title = 'Title hidden in reasoning only';
  const fetchFn = async () => sseResponse([{
    choices: [{ delta: { content: JSON.stringify(goodScript()), reasoning: JSON.stringify(reasoningScript), reasoning_details: [{ text: JSON.stringify(reasoningScript) }] } }],
  }]);
  const script = await generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', models: ['m'] },
    fetchFn,
  });
  assert.equal(script.title, 'Porto in one day: what to visit first');
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

test('generateScript accumulates streamed content across multiple chunks', async () => {
  const json = JSON.stringify(goodScript());
  const fetchFn = async () => sseResponse([
    { choices: [{ delta: { content: json.slice(0, 40) } }] },
    { choices: [{ delta: { content: json.slice(40, 120) } }] },
    { choices: [{ delta: { content: json.slice(120) } }] },
  ]);
  const script = await generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn,
  });
  assert.equal(script.title, goodScript().title);
});

test('generateScript accepts thinking chunks in real time, then the final content', async () => {
  const fetchFn = async () => sseResponse([
    { choices: [{ delta: { reasoning: 'first I think about the hook' } }] },
    { choices: [{ delta: { reasoning_content: 'then I think about the body' } }] },
    { choices: [{ delta: { content: JSON.stringify(goodScript()) } }] },
  ]);
  const script = await generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn,
  });
  assert.equal(script.title, goodScript().title);
});

test('generateScript succeeds on a slow but alive stream, below the silence timeout', async () => {
  const json = JSON.stringify(goodScript());
  const fetchFn = async () => ({
    ok: true,
    body: delayedStream([`data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(0, 50) } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(50) } }] })}\n\n`, 'data: [DONE]\n\n'], 20),
  });
  const script = await generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn,
    streamTimeouts: { silenceMs: 200, totalMs: 5000 },
  });
  assert.equal(script.title, goodScript().title);
});

test('generateScript aborts on stream silence, not on total elapsed time alone', async () => {
  const fetchFn = async () => ({
    ok: true,
    body: delayedStream([`data: ${JSON.stringify({ choices: [{ delta: { content: '{"partial' } }] })}\n\n`], 0, 0),
  });
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn,
    streamTimeouts: { silenceMs: 50, totalMs: 10000 },
  }), /silence timeout/);
});

test('generateScript aborts on the total cap even when chunks keep arriving', async () => {
  // A never-closing stream: chunks keep arriving, so only the total cap
  // can stop it.
  const neverClosing = async () => ({
    ok: true,
    body: new ReadableStream({
      async pull(controller) {
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`));
      },
    }),
  });
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn: neverClosing,
    streamTimeouts: { silenceMs: 10000, totalMs: 100 },
  }), /total timeout/);
});

test('generateScript fails the attempt on a non-SSE response instead of guessing', async () => {
  const fetchFn = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodScript()) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn,
  }), /ended without SSE data/);
});

test('generateScript fails the attempt on an unparseable stream chunk', async () => {
  const fetchFn = async () => new Response('data: {not json\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(() => generateScript({
    topic: 'Porto in one day: what to visit first',
    angle: 'budget',
    llm: { apiKey: 'k', baseUrl: 'https://llm.example.test/v1', model: 'm' },
    fetchFn,
  }), /unparseable chunk/);
});
