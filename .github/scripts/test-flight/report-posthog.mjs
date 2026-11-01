#!/usr/bin/env node
//---------------
// Report a failed test-flight job to PostHog.
//
// The write-script and flight steps fail loudly on purpose: no fallback
// script is ever published. A GitHub Actions failure alone is easy to
// miss, so this step runs with `if: failure()` and sends one
// test_flight_failed event to the PostHog EU ingest API.
//
// Telemetry must never mask the original failure:
// - Missing TEST_FLIGHT_POSTHOG_KEY: log a warning, exit 0. The job
//   still fails from the step that actually failed.
// - PostHog request failure: log a warning, exit 0.
// - The key is never logged. Only workflow name, run id, faceless flag,
//   and the GitHub run URL are sent, never API keys, persona ids, or
//   account ids.
//---------------

import { pathToFileURL } from 'node:url';

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

export function buildEvent({ workflow, runId, faceless, runUrl }) {
  return {
    api_key: undefined, // set by reportFailure, never part of the tested shape
    event: 'test_flight_failed',
    distinct_id: 'test-flight',
    properties: {
      workflow: workflow || 'test-flight',
      run_id: runId || '',
      faceless: faceless === 'true',
      run_url: runUrl || '',
      $lib: 'test-flight-ci',
    },
    timestamp: new Date().toISOString(),
  };
}

export async function reportFailure(env = process.env, fetchFn = fetch) {
  const key = (env.TEST_FLIGHT_POSTHOG_KEY || '').trim();
  if (!key) {
    console.log('report-posthog: TEST_FLIGHT_POSTHOG_KEY not set — skipping PostHog alert (job failure still stands)');
    return { reported: false, reason: 'no key' };
  }
  const host = (env.TEST_FLIGHT_POSTHOG_HOST || DEFAULT_POSTHOG_HOST).replace(/\/+$/, '');
  const event = buildEvent({
    workflow: env.GITHUB_WORKFLOW,
    runId: env.GITHUB_RUN_ID,
    faceless: env.TEST_FLIGHT_FACELESS,
    runUrl:
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : '',
  });
  event.api_key = key;
  let res;
  try {
    res = await fetchFn(`${host}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    console.log(`report-posthog: PostHog request failed (${error.message}) — job failure still stands`);
    return { reported: false, reason: 'request failed' };
  }
  if (!res.ok) {
    console.log(`report-posthog: PostHog returned HTTP ${res.status} — job failure still stands`);
    return { reported: false, reason: `HTTP ${res.status}` };
  }
  console.log('report-posthog: test_flight_failed event sent');
  return { reported: true };
}

const invokedAsMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  reportFailure().catch((error) => {
    console.log(`report-posthog: unexpected error (${error.message}) — job failure still stands`);
  });
}
