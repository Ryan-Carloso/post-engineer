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

const baseInput = () => ({
  apiKey: API_KEY,
  title: 'Why short videos win',
  hook: 'Stop scrolling.',
  body: 'Short videos keep attention.',
  cta: 'Follow for more.',
  providers: ['youtube'],
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
    assert.equal(input.faceless, false);
    assert.equal(input.waitForCompletion, true);
    assert.equal(input.timeoutMinutes, 30);
    assert.equal(input.schedule, undefined);
  });

  const rejects = [
    ['a non-object input', null, /must be a JSON object/],
    ['a missing apiKey', { ...baseInput(), apiKey: undefined }, /apiKey is required/],
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
    assert.equal(body.options.faceless, true);
    assert.equal(body.idempotencyKey, 'apify-run-abc');
    assert.deepEqual(body.publishing, { mode: 'asap', providers: ['youtube'] });
    assert.equal('personaId' in body, false);
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
    assert.deepEqual([...schema.required].sort(), ['apiKey', 'body', 'cta', 'hook', 'providers', 'title']);
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
  });
});
