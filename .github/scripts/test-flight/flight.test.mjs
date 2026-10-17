// Unit tests for the test-flight script (pure logic + poll loop with a stubbed slot fetch).
// Run: node --test .github/scripts/test-flight/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FlightError,
  MONITOR_TOPICS,
  PROVIDER_ORDER,
  assertPublishedSlot,
  assertScheduledSlot,
  buildAsapPayload,
  buildScheduledPayload,
  discoverAccounts,
  resolveConfig,
  resolveFlightAccounts,
  resolveTopic,
  rotateTopic,
  scheduledTarget,
  singleSlot,
  waitForPublished,
  SCHEDULE_LEAD_MS,
} from './flight.mjs';

function baseEnv(overrides = {}) {
  return {
    TEST_FLIGHT_POST_ENGINEER_API_KEY: 'key-for-tests',
    TEST_FLIGHT_PERSONA_ID: 'persona-uuid',
    TEST_FLIGHT_BLUESKY_ACCOUNT_ID: 'bsky-acct',
    TEST_FLIGHT_INSTAGRAM_ACCOUNT_ID: 'ig-acct',
    TEST_FLIGHT_YOUTUBE_ACCOUNT_ID: 'yt-acct',
    ...overrides,
  };
}

describe('resolveConfig', () => {
  it('resolves accounts per provider and defaults', () => {
    const cfg = resolveConfig(baseEnv());
    assert.deepEqual(cfg.accounts, {
      bluesky: ['bsky-acct'],
      instagram: ['ig-acct'],
      youtube: ['yt-acct'],
    });
    assert.equal(cfg.scheduledAction, 'cancel');
    assert.equal(cfg.apiBaseUrl, 'https://post-engineer.com');
  });

  it('skips providers without an account id', () => {
    const cfg = resolveConfig(
      baseEnv({ TEST_FLIGHT_INSTAGRAM_ACCOUNT_ID: '', TEST_FLIGHT_YOUTUBE_ACCOUNT_ID: '   ' }),
    );
    assert.deepEqual(cfg.accounts, { bluesky: ['bsky-acct'] });
  });

  it('fails when the API key is missing', () => {
    assert.throws(() => resolveConfig(baseEnv({ TEST_FLIGHT_POST_ENGINEER_API_KEY: '' })), FlightError);
  });

  it('fails when the persona id is missing', () => {
    assert.throws(() => resolveConfig(baseEnv({ TEST_FLIGHT_PERSONA_ID: '  ' })), FlightError);
  });

  it('allows empty accounts (auto-discovery runs in main)', () => {
    const cfg = resolveConfig(
      baseEnv({
        TEST_FLIGHT_BLUESKY_ACCOUNT_ID: '',
        TEST_FLIGHT_INSTAGRAM_ACCOUNT_ID: '',
        TEST_FLIGHT_YOUTUBE_ACCOUNT_ID: '',
      }),
    );
    assert.deepEqual(cfg.accounts, {});
  });

  it('fails on an unknown scheduled action', () => {
    assert.throws(() => resolveConfig(baseEnv({ TEST_FLIGHT_SCHEDULED_ACTION: 'explode' })), FlightError);
  });

  it('fails on a non-https base URL', () => {
    assert.throws(
      () => resolveConfig(baseEnv({ TEST_FLIGHT_API_BASE_URL: 'http://post-engineer.com' })),
      /must be https/,
    );
  });

  it('fails on a malformed base URL', () => {
    assert.throws(
      () => resolveConfig(baseEnv({ TEST_FLIGHT_API_BASE_URL: 'not a url' })),
      /not a valid URL/,
    );
  });
});

describe('discoverAccounts', () => {
  const client = { apiBaseUrl: 'https://post-engineer.com', apiKey: 'key-for-tests' };
  const okFetch = (body, status = 200) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  it('maps each provider to its account id field', async () => {
    const accounts = await discoverAccounts(
      client,
      okFetch({
        authenticated: true,
        accounts: [
          { provider: 'youtube', channelId: 'UC-1' },
          { provider: 'bluesky', did: 'did:plc:abc' },
          { provider: 'instagram', igUserId: 'ig-9' },
        ],
      }),
    );
    assert.deepEqual(accounts, {
      youtube: ['UC-1'],
      bluesky: ['did:plc:abc'],
      instagram: ['ig-9'],
    });
  });

  it('collects several accounts of the same provider', async () => {
    const accounts = await discoverAccounts(
      client,
      okFetch({
        authenticated: true,
        accounts: [
          { provider: 'bluesky', did: 'did:plc:one' },
          { provider: 'bluesky', did: 'did:plc:two' },
        ],
      }),
    );
    assert.deepEqual(accounts, { bluesky: ['did:plc:one', 'did:plc:two'] });
  });

  it('skips unknown providers and entries without an id', async () => {
    const accounts = await discoverAccounts(
      client,
      okFetch({
        authenticated: true,
        accounts: [
          { provider: 'linkedin', providerAccountId: 'li-1' },
          { provider: 'bluesky', did: '   ' },
          { provider: 'youtube' },
          { provider: 'youtube', channelId: 'UC-2' },
        ],
      }),
    );
    assert.deepEqual(accounts, { youtube: ['UC-2'] });
  });

  it('fails when no usable accounts are connected', async () => {
    await assert.rejects(
      discoverAccounts(client, okFetch({ authenticated: true, accounts: [] })),
      /no connected social accounts/,
    );
  });

  it('fails on a non-2xx response', async () => {
    await assert.rejects(
      discoverAccounts(client, okFetch({ message: 'nope' }, 401)),
      /GET \/api\/account -> HTTP 401/,
    );
  });

  it('fails when the response is not an authenticated account list', async () => {
    await assert.rejects(
      discoverAccounts(client, okFetch({ authenticated: false, accounts: [] })),
      /GET \/api\/account -> HTTP 200/,
    );
  });

  it('fails on malformed JSON', async () => {
    await assert.rejects(discoverAccounts(client, okFetch('not json{{{')), /GET \/api\/account/);
  });

  it('fails when the request itself errors', async () => {
    await assert.rejects(
      discoverAccounts(client, async () => {
        throw new Error('socket hang up');
      }),
      /GET \/api\/account failed: socket hang up/,
    );
  });
});

describe('resolveFlightAccounts', () => {
  const client = { apiBaseUrl: 'https://post-engineer.com', apiKey: 'key-for-tests' };

  it('prefers explicit account ids and never discovers', async () => {
    let discovered = false;
    const accounts = await resolveFlightAccounts({
      explicit: { bluesky: ['did:plc:explicit'] },
      client,
      discover: async () => {
        discovered = true;
        return { youtube: ['UC-x'] };
      },
    });
    assert.deepEqual(accounts, { bluesky: ['did:plc:explicit'] });
    assert.equal(discovered, false);
  });

  it('discovers when no explicit account ids exist', async () => {
    const accounts = await resolveFlightAccounts({
      explicit: {},
      client,
      discover: async () => ({ instagram: ['ig-1'] }),
    });
    assert.deepEqual(accounts, { instagram: ['ig-1'] });
  });
});

describe('resolveTopic', () => {
  it('prefers the explicit topic', () => {
    assert.equal(resolveTopic(baseEnv({ TEST_FLIGHT_TOPIC: '  hello world ' })), 'hello world');
  });

  it('rotates monitor topics when empty', () => {
    const topic = resolveTopic(baseEnv({ TEST_FLIGHT_TOPIC: '' }), new Date('2026-01-15T00:00:00Z'));
    assert.ok(MONITOR_TOPICS.includes(topic));
  });
});

describe('rotateTopic', () => {
  it('is deterministic for a date and cycles through the list', () => {
    const a = rotateTopic(['a', 'b', 'c'], new Date('2026-03-01T12:00:00Z'));
    const b = rotateTopic(['a', 'b', 'c'], new Date('2026-03-01T23:59:59Z'));
    assert.equal(a, b);
    const seen = new Set();
    for (let day = 1; day <= 9; day++) {
      seen.add(rotateTopic(['a', 'b', 'c'], new Date(`2026-01-${String(day).padStart(2, '0')}T00:00:00Z`)));
    }
    assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
  });

  it('rejects an empty list', () => {
    assert.throws(() => rotateTopic([], new Date()), FlightError);
  });
});

describe('buildAsapPayload', () => {
  it('sends mode=asap with no schedule key (a stray schedule is a 400)', () => {
    const payload = buildAsapPayload({
      personaId: 'p1',
      topic: 't',
      accounts: { bluesky: ['b1'] },
      idempotencyKey: 'k1',
    });
    assert.equal(payload.publishing.mode, 'asap');
    assert.ok(!('schedule' in payload.publishing));
    assert.deepEqual(payload.topics, ['t']);
    assert.equal(payload.idempotencyKey, 'k1');
  });
});

describe('scheduledTarget', () => {
  it('lands ~3h10m out in UTC wall-clock fields', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    const target = scheduledTarget(now);
    assert.equal(target.target.getTime() - now.getTime(), SCHEDULE_LEAD_MS);
    assert.equal(target.timezone, 'UTC');
    assert.match(target.startAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(target.times[0], /^\d{2}:\d{2}$/);
    // 10:00 + 3h10m = 13:10 UTC.
    assert.equal(target.times[0], '13:10');
  });
});

describe('buildScheduledPayload', () => {
  it('sends mode=scheduled with the schedule plan', () => {
    const payload = buildScheduledPayload({
      personaId: 'p1',
      topic: 't',
      accounts: { youtube: ['y1'] },
      idempotencyKey: 'k2',
      schedule: { startAt: '2026-10-17', times: ['13:10'], timezone: 'UTC' },
    });
    assert.equal(payload.publishing.mode, 'scheduled');
    assert.deepEqual(payload.publishing.schedule, {
      startAt: '2026-10-17',
      times: ['13:10'],
      timezone: 'UTC',
    });
  });
});

describe('singleSlot', () => {
  it('returns the only slot', () => {
    assert.equal(singleSlot({ slots: [{ slotId: 's1' }] }, 'ASAP').slotId, 's1');
  });

  it('rejects zero or many slots', () => {
    assert.throws(() => singleSlot({ slots: [] }, 'ASAP'), /exactly 1 slot/);
    assert.throws(() => singleSlot({ slots: [{}, {}] }, 'ASAP'), /exactly 1 slot/);
    assert.throws(() => singleSlot({}, 'ASAP'), /exactly 1 slot/);
  });
});

describe('assertPublishedSlot', () => {
  const providers = ['bluesky', 'youtube'];

  it('accepts a published slot with links for every provider', () => {
    const links = assertPublishedSlot(
      {
        slotId: 's1',
        status: 'published',
        publishLinks: [
          { provider: 'bluesky', url: 'https://bsky.app/x' },
          { provider: 'youtube', url: 'https://youtu.be/y' },
        ],
      },
      providers,
    );
    assert.equal(links.length, 2);
  });

  it('rejects a non-published terminal status', () => {
    assert.throws(
      () => assertPublishedSlot({ slotId: 's1', status: 'failed', error: 'boom' }, providers),
      /ended as 'failed'/,
    );
  });

  it('rejects a published slot missing a provider link', () => {
    assert.throws(
      () =>
        assertPublishedSlot(
          { slotId: 's1', status: 'published', publishLinks: [{ provider: 'bluesky', url: 'u' }] },
          providers,
        ),
      /no post link for: youtube/,
    );
  });
});

describe('assertScheduledSlot', () => {
  it('accepts a slot landing near the target', () => {
    const target = new Date('2026-10-17T13:10:00Z');
    assert.doesNotThrow(() =>
      assertScheduledSlot({ slotId: 's2', status: 'scheduled', slotAt: '2026-10-17T13:12:00Z' }, target),
    );
  });

  it('rejects a slot landing far from the target', () => {
    const target = new Date('2026-10-17T13:10:00Z');
    assert.throws(
      () => assertScheduledSlot({ slotId: 's2', status: 'scheduled', slotAt: '2026-10-18T13:10:00Z' }, target),
      /exceeds 10m/,
    );
  });

  it('rejects failed slots and unparsable slotAt', () => {
    const target = new Date('2026-10-17T13:10:00Z');
    assert.throws(
      () => assertScheduledSlot({ slotId: 's2', status: 'failed', slotAt: '2026-10-17T13:10:00Z' }, target),
      /ended as 'failed'/,
    );
    assert.throws(
      () => assertScheduledSlot({ slotId: 's2', status: 'scheduled', slotAt: 'not-a-date' }, target),
      /unparsable slotAt/,
    );
  });
});

describe('waitForPublished', () => {
  const providers = PROVIDER_ORDER;

  it('returns links once the slot publishes', async () => {
    const states = [{ status: 'generating' }, { status: 'publishing' }, { status: 'published' }];
    let calls = 0;
    const fetchSlot = async () => {
      const state = states[Math.min(calls, states.length - 1)];
      calls += 1;
      return {
        slotId: 's1',
        ...state,
        publishLinks: providers.map((provider) => ({ provider, url: `https://${provider}/p` })),
      };
    };
    const links = await waitForPublished(null, 's1', providers, {
      timeoutMs: 60_000,
      intervalMs: 1_000,
      fetchSlot,
      sleepFn: async () => {},
      nowFn: () => 0,
    });
    assert.equal(links.length, 3);
    assert.equal(calls, 3);
  });

  it('throws when the slot fails', async () => {
    const fetchSlot = async () => ({ slotId: 's1', status: 'failed', error: 'engine blew up' });
    await assert.rejects(
      waitForPublished(null, 's1', providers, {
        timeoutMs: 60_000,
        intervalMs: 1_000,
        fetchSlot,
        sleepFn: async () => {},
        nowFn: () => 0,
      }),
      /ended as 'failed'/,
    );
  });

  it('throws on timeout', async () => {
    let now = 0;
    const fetchSlot = async () => ({ slotId: 's1', status: 'generating' });
    await assert.rejects(
      waitForPublished(null, 's1', providers, {
        timeoutMs: 5_000,
        intervalMs: 1_000,
        fetchSlot,
        sleepFn: async () => {
          now += 10_000;
        },
        nowFn: () => now,
      }),
      /timed out/,
    );
  });
});
