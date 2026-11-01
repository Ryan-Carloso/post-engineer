import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvent, reportFailure } from './report-posthog.mjs';

test('buildEvent carries workflow, run, and faceless flag, never a key', () => {
  const event = buildEvent({ workflow: 'Test flight (faceless)', runId: '123', faceless: 'true', runUrl: 'https://example.test/runs/123' });
  assert.equal(event.event, 'test_flight_failed');
  assert.equal(event.distinct_id, 'test-flight');
  assert.equal(event.properties.faceless, true);
  assert.equal(event.properties.run_url, 'https://example.test/runs/123');
  assert.equal(event.api_key, undefined);
});

test('reportFailure skips quietly when no PostHog key is set', async () => {
  let called = 0;
  const result = await reportFailure({ TEST_FLIGHT_POSTHOG_KEY: '' }, async () => { called += 1; return { ok: true }; });
  assert.equal(result.reported, false);
  assert.equal(called, 0);
});

test('reportFailure sends the event with the key in the body, never in logs', async () => {
  let body = null;
  const result = await reportFailure(
    {
      TEST_FLIGHT_POSTHOG_KEY: 'phc-test-key',
      GITHUB_WORKFLOW: 'Test flight (faceless)',
      GITHUB_RUN_ID: '123',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'Ryan-Carloso/post-engineer',
      TEST_FLIGHT_FACELESS: 'true',
    },
    async (url, options) => { body = JSON.parse(options.body); return { ok: true }; },
  );
  assert.equal(result.reported, true);
  assert.equal(body.api_key, 'phc-test-key');
  assert.equal(body.event, 'test_flight_failed');
});

test('reportFailure never throws when PostHog is down', async () => {
  const result = await reportFailure({ TEST_FLIGHT_POSTHOG_KEY: 'phc-test-key' }, async () => ({ ok: false, status: 500 }));
  assert.equal(result.reported, false);
});
