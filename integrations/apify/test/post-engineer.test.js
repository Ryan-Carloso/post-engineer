import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ActorInputError,
  DEFAULT_API_URL,
  POLL_INTERVAL_MS,
  PostEngineerApiError,
  PROVIDERS,
  buildGenerateBody,
  parseInput,
  redact,
  runActor,
} from '../src/post-engineer.js';

const API_KEY = 'pe_live_testkey123';

const urls = (count) => Array.from({ length: count }, (_, index) => `https://e.com/${index}.jpg`);

const baseInput = () => ({
  apiKey: API_KEY,
  title: 'Why short videos win',
  hook: 'Stop scrolling.',
  body: 'Short videos keep attention.',
  cta: 'Follow for more.',
  providers: ['youtube'],
  voiceId: 'chatterbox:kokoro_af_heart',
  // One image per segment: the density rule needs exactly 3 here.
  images: urls(3),
});

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status });

// A fetch double that answers by "METHOD path" and records every call.
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const key = `${init.method} ${path}`;
    calls.push({ key, url, init });
    const handler = routes[key];
    if (handler === undefined) throw new Error(`unexpected request ${key}`);
    return typeof handler === 'function' ? handler(calls.filter((c) => c.key === key).length) : handler;
  };
  return { fetchImpl, calls };
}

function runWith(routes, input, clock = { t: 0 }) {
  const { fetchImpl, calls } = fakeFetch(routes);
  const logs = [];
  const promise = runActor({
    input,
    fetchImpl,
    sleep: async (ms) => {
      clock.t += ms;
    },
    now: () => clock.t,
    idempotencyKey: 'apify-run-abc',
    log: (message) => logs.push(message),
  });
  return { promise, calls, logs };
}

const accepted = (taskId = 'task-1') =>
  jsonResponse(200, {
    success: true,
    schedule: { id: 'sched-1', mode: 'asap' },
    slots: [{ slotId: 'slot-1', slotAt: '2026-11-02T00:00:00Z', title: 't', taskId, status: 'generating' }],
    replayed: false,
  });

const validScript = () => jsonResponse(200, { success: true, valid: true });

describe('parseInput', () => {
  it('normalizes a minimal valid input with defaults', () => {
    const input = parseInput(baseInput());
    assert.equal(input.apiUrl, DEFAULT_API_URL);
    assert.equal(input.mode, 'asap');
    // No persona: faceless by default (generate-and-schedule refuses otherwise).
    assert.equal(input.videoType, 'faceless');
    // Description defaults to the hook when omitted.
    assert.equal(input.description, 'Stop scrolling.');
    assert.equal(input.waitForCompletion, true);
    assert.equal(input.timeoutMinutes, 30);
    assert.equal(input.schedule, undefined);
  });

  const rejects = [
    ['a non-object input', null, /must be a JSON object/],
    ['an empty apiKey', { ...baseInput(), apiKey: '  ' }, /apiKey must be a non-empty string/],
    ['a key without the pe_live_ prefix', { ...baseInput(), apiKey: 'sk-123' }, /starts with pe_live_/],
    ['an empty hook', { ...baseInput(), hook: '  ' }, /hook is required/],
    ['an unknown provider', { ...baseInput(), providers: ['tiktok'] }, /Unknown provider "tiktok"/],
    ['an empty provider list', { ...baseInput(), providers: [] }, /providers must be a non-empty list/],
    ['repeated providers', { ...baseInput(), providers: ['youtube', 'youtube'] }, /must not repeat/],
    ['accounts for an unselected provider', { ...baseInput(), accounts: { instagram: ['a'] } }, /not one of the selected providers/],
    ['an unknown mode', { ...baseInput(), mode: 'later' }, /mode must be one of/],
    ['a schedule in asap mode', { ...baseInput(), schedule: { startAt: 'x', times: ['18:00'], timezone: 'UTC' } }, /only allowed when mode is "scheduled"/],
    ['scheduled mode without a schedule', { ...baseInput(), mode: 'scheduled' }, /schedule is required/],
    ['an http apiUrl that is not loopback', { ...baseInput(), apiUrl: 'http://example.com' }, /must use https/],
    ['an apiUrl with credentials', { ...baseInput(), apiUrl: 'https://u:p@example.com' }, /must not contain credentials/],
    ['a string boolean', { ...baseInput(), faceless: 'true' }, /faceless must be true or false/],
    ['no persona with faceless off', { ...baseInput(), faceless: false }, /without a persona must be faceless/],
    ['no persona and no voice', { ...baseInput(), voiceId: undefined }, /without a persona needs a voice/],
    ['full lip-sync without a persona', { ...baseInput(), fullLipsync: true }, /fullLipsync needs a persona/],
    ['full lip-sync with faceless', { ...baseInput(), personaId: 'p1', faceless: true, fullLipsync: true }, /fullLipsync needs a persona/],
    ['images with full lip-sync', { ...baseInput(), personaId: 'p1', fullLipsync: true }, /not used with fullLipsync/],
    ['a timeout above the cap', { ...baseInput(), timeoutMinutes: 61 }, /timeoutMinutes must be an integer from 1 to 60/],
  ];
  for (const [name, raw, pattern] of rejects) {
    it(`rejects ${name}`, () => {
      assert.throws(() => parseInput(raw), (error) => error instanceof ActorInputError && pattern.test(error.message));
    });
  }

  it('accepts http only for loopback apiUrl and keeps just the origin', () => {
    assert.equal(parseInput({ ...baseInput(), apiUrl: 'http://localhost:3434/' }).apiUrl, 'http://localhost:3434');
  });

  it('accepts a full scheduled input', () => {
    const input = parseInput({
      ...baseInput(),
      mode: 'scheduled',
      schedule: { startAt: '2026-12-01T09:00:00Z', times: ['18:00'], timezone: 'America/Sao_Paulo' },
    });
    assert.deepEqual(input.schedule.times, ['18:00']);
  });
});

describe('buildGenerateBody', () => {
  it('sends segments hook, body, cta in order with the idempotency key', () => {
    const body = buildGenerateBody(parseInput({ ...baseInput(), faceless: true }), 'apify-run-abc');
    assert.deepEqual(body.options.segments.map((s) => s.kind), ['hook', 'body', 'cta']);
    assert.equal(body.options.videoType, 'faceless');
    assert.equal(body.options.voiceId, 'chatterbox:kokoro_af_heart');
    assert.equal('faceless' in body.options, false);
    assert.equal('fullLipsync' in body.options, false);
    assert.equal(body.description, 'Stop scrolling.');
    assert.equal(body.idempotencyKey, 'apify-run-abc');
    assert.deepEqual(body.publishing, { mode: 'asap', providers: ['youtube'] });
    assert.equal('personaId' in body, false);
  });
});

describe('buildGenerateBody look options', () => {
  it('sends faceless videoType when faceless is true even with a persona (voice-only, 1 token)', () => {
    const body = buildGenerateBody(parseInput({ ...baseInput(), personaId: 'p1', faceless: true }));
    assert.equal(body.personaId, 'p1');
    assert.equal(body.options.videoType, 'faceless');
    assert.equal(body.options.voiceId, 'chatterbox:kokoro_af_heart');
    assert.equal('faceless' in body.options, false);
  });

  it('sends a persona video with full lip-sync videoType and no faceless flag', () => {
    const body = buildGenerateBody(parseInput({ ...baseInput(), voiceId: undefined, personaId: 'p1', fullLipsync: true, images: undefined }));
    assert.equal(body.personaId, 'p1');
    assert.equal(body.options.videoType, 'full_lipsync');
    assert.equal('faceless' in body.options, false);
    assert.equal('voiceId' in body.options, false);
  });

  it('passes an explicit description through instead of the hook', () => {
    const body = buildGenerateBody(parseInput({ ...baseInput(), description: 'My caption.' }));
    assert.equal(body.description, 'My caption.');
  });

  it('sends no material: images is the only material', () => {
    const body = buildGenerateBody(parseInput(baseInput()));
    assert.equal('facelessMaterial' in body.options, false);
  });
});

describe('redact', () => {
  it('replaces every occurrence of the key', () => {
    assert.equal(redact(`a ${API_KEY} b ${API_KEY}`, API_KEY), 'a [redacted] b [redacted]');
  });
});

describe('runActor', () => {
  it('validates the script, generates once with Bearer auth, and returns the completed video', async () => {
    const { promise, calls } = runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': accepted(),
        'GET /api/persona/video-status/task-1': (n) =>
          n === 1
            ? jsonResponse(200, { status: 200, message: 'ok', body: { state: 4 } })
            : jsonResponse(200, { status: 200, message: 'ok', body: { state: 1, videos: ['https://v/1.mp4'] } }),
      },
      baseInput(),
    );
    const result = await promise;
    assert.deepEqual(calls.map((c) => c.key), [
      'POST /api/videos/validate-script',
      'POST /api/videos/generate-and-schedule',
      'GET /api/persona/video-status/task-1',
      'GET /api/persona/video-status/task-1',
    ]);
    for (const call of calls) assert.equal(call.init.headers.Authorization, `Bearer ${API_KEY}`);
    assert.equal(JSON.parse(calls[1].init.body).idempotencyKey, 'apify-run-abc');
    assert.equal(result.scheduleId, 'sched-1');
    assert.equal(result.slots[0].videoStatus, 'complete');
    assert.deepEqual(result.slots[0].videos, ['https://v/1.mp4']);
  });

  it('runs dry without an apiKey: no request, the payload it would send', async () => {
    const { promise, calls, logs } = runWith({}, { ...baseInput(), apiKey: undefined });
    const result = await promise;
    assert.equal(calls.length, 0);
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.request.options.segments.map((s) => s.kind), ['hook', 'body', 'cta']);
    assert.match(logs[0], /dry run/);
  });

  it('stops before spending tokens when the script is rejected', async () => {
    const { promise, calls } = runWith(
      { 'POST /api/videos/validate-script': jsonResponse(400, { success: false, error: 'Script too short.' }) },
      baseInput(),
    );
    await assert.rejects(promise, (error) => error instanceof ActorInputError && /Script too short/.test(error.message));
    assert.equal(calls.length, 1);
  });

  it('reports an invalid key as a key problem, not a script problem', async () => {
    const { promise, calls } = runWith(
      { 'POST /api/videos/validate-script': jsonResponse(401, { success: false, error: 'Authentication required.' }) },
      baseInput(),
    );
    await assert.rejects(promise, (error) =>
      error instanceof PostEngineerApiError
      && error.status === 401
      && error.message.startsWith('API key rejected')
      && !error.message.includes('Script rejected'));
    assert.equal(calls.length, 1);
  });

  it('fails with the API error and never echoes the key', async () => {
    const { promise } = runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': jsonResponse(402, { success: false, error: `Not enough tokens for ${API_KEY}` }),
      },
      baseInput(),
    );
    await assert.rejects(promise, (error) =>
      error instanceof PostEngineerApiError
      && error.status === 402
      && error.message.includes('Not enough tokens')
      && !error.message.includes(API_KEY));
  });

  it('treats a 2xx without success:true as a failure', async () => {
    const { promise } = runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': jsonResponse(200, { success: false, error: 'nope' }),
      },
      baseInput(),
    );
    await assert.rejects(promise, PostEngineerApiError);
  });

  it('fails on a non-JSON response instead of guessing', async () => {
    const { promise } = runWith(
      { 'POST /api/videos/validate-script': new Response('<html>proxy</html>', { status: 502 }) },
      baseInput(),
    );
    await assert.rejects(promise, /non-JSON response \(HTTP 502\)/);
  });

  it('returns right after acceptance when waitForCompletion is false', async () => {
    const { promise, calls } = runWith(
      { 'POST /api/videos/validate-script': validScript(), 'POST /api/videos/generate-and-schedule': accepted() },
      { ...baseInput(), waitForCompletion: false },
    );
    const result = await promise;
    assert.equal(calls.length, 2);
    assert.equal(result.slots[0].status, 'generating');
    assert.equal('videoStatus' in result.slots[0], false);
  });

  it('reports a failed task with its redacted engine error', async () => {
    const { promise } = runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': accepted(),
        'GET /api/persona/video-status/task-1': jsonResponse(200, { body: { state: -1, error: `boom ${API_KEY}` } }),
      },
      baseInput(),
    );
    const result = await promise;
    assert.equal(result.slots[0].videoStatus, 'failed');
    assert.equal(result.slots[0].error, 'boom [redacted]');
  });

  // The web proxy answers the same 410 for a delivered and a failed task;
  // the slot status is what tells them apart.
  const gone = () => jsonResponse(410, { success: false, terminal: true, error: 'The video task no longer exists.' });
  const goneWithSlot = (slotResponse) =>
    runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': accepted(),
        'GET /api/persona/video-status/task-1': gone(),
        'GET /api/schedule/slots/slot-1': slotResponse,
      },
      baseInput(),
    );

  it('reports 410 Gone as failed when the slot failed', async () => {
    const { promise, calls } = goneWithSlot(jsonResponse(200, { success: true, slot: { status: 'failed' } }));
    const result = await promise;
    assert.equal(result.slots[0].videoStatus, 'failed');
    assert.equal(calls.at(-1).key, 'GET /api/schedule/slots/slot-1');
  });

  for (const status of ['ready', 'publishing', 'published', 'completed']) {
    it(`reports 410 Gone as complete when the slot is ${status} (delivered before the engine lost it)`, async () => {
      const result = await goneWithSlot(jsonResponse(200, { success: true, slot: { status } })).promise;
      assert.equal(result.slots[0].videoStatus, 'complete');
    });
  }

  it('reports 410 Gone as unknown, never failed, when the slot lookup fails', async () => {
    const result = await goneWithSlot(jsonResponse(503, { success: false, error: 'busy' })).promise;
    assert.equal(result.slots[0].videoStatus, 'unknown');
  });

  it('retries transient status errors and fails fast on auth errors', async () => {
    const transient = runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': accepted(),
        'GET /api/persona/video-status/task-1': (n) =>
          n === 1 ? jsonResponse(503, { error: 'busy' }) : jsonResponse(200, { body: { state: 1 } }),
      },
      baseInput(),
    );
    assert.equal((await transient.promise).slots[0].videoStatus, 'complete');

    const auth = runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': accepted(),
        'GET /api/persona/video-status/task-1': jsonResponse(401, { error: 'Invalid API key.' }),
      },
      baseInput(),
    );
    await assert.rejects(auth.promise, (error) => error instanceof PostEngineerApiError && error.status === 401);
  });

  it('returns timeout when the task never finishes before the deadline', async () => {
    const { promise, calls } = runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': accepted(),
        'GET /api/persona/video-status/task-1': () => jsonResponse(200, { body: { state: 4 } }),
      },
      { ...baseInput(), timeoutMinutes: 1 },
    );
    const result = await promise;
    assert.equal(result.slots[0].videoStatus, 'timeout');
    assert.equal(calls.length - 2, 60_000 / POLL_INTERVAL_MS);
  });

  it('skips polling for slots that failed to dispatch', async () => {
    const { promise, calls } = runWith(
      {
        'POST /api/videos/validate-script': validScript(),
        'POST /api/videos/generate-and-schedule': jsonResponse(200, {
          success: true,
          schedule: { id: 's' },
          slots: [{ slotId: 'x', taskId: null, status: 'failed', errorCode: 'engine_rejected' }],
        }),
      },
      baseInput(),
    );
    const result = await promise;
    assert.equal(calls.length, 2);
    assert.equal(result.slots[0].errorCode, 'engine_rejected');
  });
});

describe('Actor definition files', () => {
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const schema = read('../.actor/input_schema.json');

  it('marks the API key as a secret input', () => {
    assert.equal(schema.properties.apiKey.isSecret, true);
  });

  it('requires exactly the fields parseInput requires', () => {
    assert.deepEqual([...schema.required].sort(), ['body', 'cta', 'hook', 'providers', 'title']);
  });

  // The Store auto-tests the Actor daily with its default (prefilled) input.
  it('prefills every required field, so the default input is a valid dry run', () => {
    const defaults = Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([, p]) => p.prefill !== undefined)
        .map(([k, p]) => [k, p.prefill]),
    );
    for (const key of schema.required) assert.ok(key in defaults, `${key} has no prefill`);
    assert.equal('apiKey' in defaults, false);
    assert.equal(parseInput(defaults).apiKey, null);
  });

  // The prefilled voice must be the web app's own default voice id, so the
  // default input also works once a key is added.
  it('prefills the voice with the web default voice id', () => {
    const fallback = readFileSync(new URL('../../../apps/web/lib/voice-fallback.ts', import.meta.url), 'utf8');
    assert.ok(fallback.includes(`DEFAULT_VOICE_FEMALE = '${schema.properties.voiceId.prefill}'`));
  });

  it('has no faceless material input: images is the only material', () => {
    assert.equal('facelessMaterial' in schema.properties, false);
  });

  it('documents every provider and mode the code accepts', () => {
    for (const provider of PROVIDERS) assert.ok(schema.properties.providers.description.includes(provider));
    assert.deepEqual(schema.properties.mode.enum, ['asap', 'scheduled']);
  });

  it('points actor.json at the input schema, Dockerfile and README', () => {
    const actor = read('../.actor/actor.json');
    assert.equal(actor.actorSpecification, 1);
    assert.equal(actor.input, './input_schema.json');
    assert.equal(actor.dockerfile, '../Dockerfile');
    assert.equal(actor.readme, '../README.md');
    assert.equal(actor.output, './output_schema.json');
  });

  // The Store refuses to publish an Actor without an output schema.
  it('declares an output schema that links the dataset items and the OUTPUT record', () => {
    const output = read('../.actor/output_schema.json');
    assert.equal(output.actorOutputSchemaVersion, 1);
    const templates = Object.values(output.properties).map((p) => p.template);
    assert.ok(templates.includes('{{links.apiDefaultDatasetUrl}}/items'));
    // main.js saves the result under this key.
    assert.ok(templates.includes('{{links.apiDefaultKeyValueStoreUrl}}/records/OUTPUT'));
    assert.ok(readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').includes("Actor.setValue('OUTPUT'"));
  });
});

describe('images material', () => {
  const imagesInput = (images, body = 'Short videos keep attention.\n\nThey show a face early.') => ({
    ...baseInput(),
    body,
    images,
  });

  it('splits the body into paragraphs and puts one image on each segment, in order', () => {
    const body = buildGenerateBody(parseInput(imagesInput(urls(4))));
    assert.deepEqual(body.options.segments, [
      { kind: 'hook', text: 'Stop scrolling.', media: [{ url: 'https://e.com/0.jpg' }] },
      { kind: 'body', text: 'Short videos keep attention.', media: [{ url: 'https://e.com/1.jpg' }] },
      { kind: 'body', text: 'They show a face early.', media: [{ url: 'https://e.com/2.jpg' }] },
      { kind: 'cta', text: 'Follow for more.', media: [{ url: 'https://e.com/3.jpg' }] },
    ]);
  });

  it('keeps the body as one segment without images for full lip sync', () => {
    const body = buildGenerateBody(parseInput({ ...baseInput(), personaId: 'p1', fullLipsync: true, images: undefined, body: 'One.\n\nTwo.' }));
    assert.deepEqual(body.options.segments.map((s) => s.kind), ['hook', 'body', 'cta']);
    assert.equal(body.options.segments.some((s) => 'media' in s), false);
  });

  const rejects = [
    ['no images without full lip-sync', { ...baseInput(), images: undefined }, /images are required/],
    ['an empty image list', imagesInput([]), /images are required/],
    ['too few images for the segments', imagesInput(urls(3)), /between 4 and 4 URLs/],
    ['too many images for the segments', imagesInput(urls(5)), /between 4 and 4 URLs/],
    [
      'per-segment minimums above the 30-image cap',
      {
        ...baseInput(),
        hook: `${Array(25).fill('hook').join(' ')}.`,
        body: Array.from({ length: 6 }, (_, i) => Array(25).fill(`body${i}`).join(' ')).join('\n\n'),
        cta: Array(20).fill('cta').join(' '),
        images: urls(31),
      },
      /merge body paragraphs/,
    ],
    ['an http image', imagesInput(['http://e.com/0.jpg', ...urls(3).slice(1)]), /images\[0\] must be an https URL/],
    ['a non-URL image', imagesInput(['https://e.com/0.jpg', 'not a url', ...urls(2)]), /images\[1\] must be an absolute https URL/],
    ['a non-string image', imagesInput([42, ...urls(3)]), /images\[0\] must be an absolute https URL/],
    ['more paragraphs than segments allow', imagesInput(urls(13), Array(11).fill('Para.').join('\n\n')), /at most 10 paragraphs/],
  ];
  for (const [name, input, pattern] of rejects) {
    it(`rejects ${name}`, () => assert.throws(() => parseInput(input), (error) => error instanceof ActorInputError && pattern.test(error.message)));
  }

  it('allows twelve images: hook, ten paragraphs, CTA', () => {
    const input = parseInput(imagesInput(urls(12), Array(10).fill('Para.').join('\n\n')));
    assert.equal(buildGenerateBody(input).options.segments.length, 12);
  });

  it('sends videoType to validate-script so a missing image costs nothing', async () => {
    const { promise, calls } = runWith(
      {
        'POST /api/videos/validate-script': jsonResponse(400, { success: false, error: 'images need media on every segment' }),
      },
      imagesInput(urls(4)),
    );
    await assert.rejects(promise);
    assert.equal(calls.length, 1);
    const sent = JSON.parse(calls[0].init.body);
    // No persona in the input: the Actor's videoType is faceless.
    assert.equal(sent.videoType, 'faceless');
    assert.equal('facelessMaterial' in sent, false);
    assert.equal(sent.segments.length, 4);
  });

  it('sends videoType faceless to validate-script for an images video', async () => {
    const { promise, calls } = runWith(
      { 'POST /api/videos/validate-script': jsonResponse(400, { success: false, error: 'Script too short.' }) },
      baseInput(),
    );
    await assert.rejects(promise);
    const sent = JSON.parse(calls[0].init.body);
    // No persona in the input: the Actor's videoType is faceless.
    assert.equal(sent.videoType, 'faceless');
    assert.equal('facelessMaterial' in sent, false);
  });

  it('documents the images input in the input schema', () => {
    const schema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8'));
    assert.equal(schema.properties.images.type, 'array');
    assert.equal(schema.properties.images.editor, 'stringList');
    assert.equal(schema.required.includes('images'), false);
  });
});
