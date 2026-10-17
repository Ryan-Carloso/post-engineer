//---------------
// test-flight — CI-only end-to-end smoke of generate + publish (production).
//
// Two legs, one topic, real tokens, real public posts:
//   1. ASAP leg: POST /api/videos/generate-and-schedule with
//      publishing.mode='asap', then poll the slot until it is published and
//      assert every requested provider returned a post link.
//   2. Scheduled leg: POST the same endpoint with publishing.mode='scheduled'
//      for a slot ~3h10m out, assert the slot lands where expected, then
//      cancel it (default) or leave it to fire
//      (TEST_FLIGHT_SCHEDULED_ACTION=leave).
//
// Auth is a Post Engineer API key (TEST_FLIGHT_API_KEY) belonging to the
// funded test account; the key only ever lives in CI secrets. Account ids
// arrive via workflow_dispatch inputs (manual flight) or repo Variables
// (scheduled monitor) — nothing is hardcoded here.
//
// Configuration (environment, fail-fast — every missing value is an error):
//   TEST_FLIGHT_API_KEY            required. API key of the test account.
//   TEST_FLIGHT_PERSONA_ID         required. Persona UUID (must be in the
//                                  key's persona scope).
//   TEST_FLIGHT_BLUESKY_ACCOUNT_ID / TEST_FLIGHT_INSTAGRAM_ACCOUNT_ID /
//   TEST_FLIGHT_YOUTUBE_ACCOUNT_ID at least one required.
//   TEST_FLIGHT_TOPIC              required for manual flights; the scheduled
//                                  monitor rotates MONITOR_TOPICS when empty.
//   TEST_FLIGHT_API_BASE_URL       default https://post-engineer.com.
//   TEST_FLIGHT_SCHEDULED_ACTION   'cancel' (default) or 'leave'.
//   TEST_FLIGHT_RUN_ID             idempotency base (the workflow passes
//                                  github.run_id).
//   TEST_FLIGHT_POLL_TIMEOUT_MIN   default 60. TEST_FLIGHT_POLL_INTERVAL_SEC
//                                  default 30.
//
// Dependency-free Node 20+ ESM (repo precedent: .github/scripts/api-naming/).
// Pure logic is unit-tested in flight.test.mjs via `node --test`.
//---------------

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_API_BASE_URL = 'https://post-engineer.com';
export const PROVIDER_ORDER = ['bluesky', 'instagram', 'youtube'];
// 3h10m: safely inside the [3h, 30d] schedule window (SCHEDULE_MIN_ADVANCE_HOURS).
export const SCHEDULE_LEAD_MS = (3 * 60 + 10) * 60 * 1000;
export const SLOT_AT_TOLERANCE_MS = 10 * 60 * 1000;
export const DEFAULT_POLL_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
export const REQUEST_TIMEOUT_MS = 60 * 1000;

// Evergreen topics for the scheduled monitor (manual flights pass their own).
export const MONITOR_TOPICS = [
  'Why small teams ship faster than big companies',
  'The one productivity habit that actually compounds',
  'What I learned automating my own video pipeline',
  'A simple framework for testing business ideas quickly',
  'Why consistency beats intensity in content creation',
  'The hidden cost of manual repetitive work',
  'How to validate an idea before building anything',
];

export class FlightError extends Error {}

//---------------
// Config
//---------------

function optionalEnv(env, name) {
  return (env[name] ?? '').trim();
}

function requiredEnv(env, name) {
  const value = optionalEnv(env, name);
  if (value === '') throw new FlightError(`test-flight: missing required ${name}`);
  return value;
}

function parsePositiveInt(raw, name, fallback) {
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new FlightError(`test-flight: ${name} must be a positive integer, got '${raw}'`);
  }
  return n;
}

export function resolveConfig(env) {
  const apiKey = requiredEnv(env, 'TEST_FLIGHT_API_KEY');
  const personaId = requiredEnv(env, 'TEST_FLIGHT_PERSONA_ID');
  const accounts = {};
  for (const provider of PROVIDER_ORDER) {
    const accountId = optionalEnv(env, `TEST_FLIGHT_${provider.toUpperCase()}_ACCOUNT_ID`);
    if (accountId !== '') accounts[provider] = [accountId];
  }
  if (Object.keys(accounts).length === 0) {
    throw new FlightError(
      'test-flight: at least one provider account id is required ' +
        '(TEST_FLIGHT_BLUESKY_ACCOUNT_ID / TEST_FLIGHT_INSTAGRAM_ACCOUNT_ID / TEST_FLIGHT_YOUTUBE_ACCOUNT_ID)',
    );
  }
  const scheduledAction = optionalEnv(env, 'TEST_FLIGHT_SCHEDULED_ACTION') || 'cancel';
  if (scheduledAction !== 'cancel' && scheduledAction !== 'leave') {
    throw new FlightError(
      `test-flight: TEST_FLIGHT_SCHEDULED_ACTION must be 'cancel' or 'leave', got '${scheduledAction}'`,
    );
  }
  const rawBaseUrl = optionalEnv(env, 'TEST_FLIGHT_API_BASE_URL') || DEFAULT_API_BASE_URL;
  const apiBaseUrl = rawBaseUrl.replace(/\/+$/, '');
  let parsedUrl;
  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    throw new FlightError(`test-flight: TEST_FLIGHT_API_BASE_URL is not a valid URL, got '${apiBaseUrl}'`);
  }
  // Same rule as the rest of the repo: HTTPS or loopback only.
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== 'https:' && !isLoopback) {
    throw new FlightError(`test-flight: TEST_FLIGHT_API_BASE_URL must be https (got '${apiBaseUrl}')`);
  }
  return {
    apiKey,
    personaId,
    accounts,
    scheduledAction,
    apiBaseUrl,
    runId: optionalEnv(env, 'TEST_FLIGHT_RUN_ID') || `manual-${Date.now()}`,
    pollTimeoutMs: parsePositiveInt(optionalEnv(env, 'TEST_FLIGHT_POLL_TIMEOUT_MIN'), 'TEST_FLIGHT_POLL_TIMEOUT_MIN', DEFAULT_POLL_TIMEOUT_MS / 60000) * 60000,
    pollIntervalMs: parsePositiveInt(optionalEnv(env, 'TEST_FLIGHT_POLL_INTERVAL_SEC'), 'TEST_FLIGHT_POLL_INTERVAL_SEC', DEFAULT_POLL_INTERVAL_MS / 1000) * 1000,
  };
}

export function resolveTopic(env, now = new Date()) {
  const topic = optionalEnv(env, 'TEST_FLIGHT_TOPIC');
  if (topic !== '') return topic;
  return rotateTopic(MONITOR_TOPICS, now);
}

export function rotateTopic(topics, now = new Date()) {
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new FlightError('test-flight: topic rotation needs a non-empty list');
  }
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const dayIndex = Math.floor((now.getTime() - startOfYear) / (24 * 3600 * 1000));
  return topics[((dayIndex % topics.length) + topics.length) % topics.length];
}

//---------------
// Payloads
//---------------

export function buildAsapPayload({ personaId, topic, accounts, idempotencyKey }) {
  return {
    personaId,
    topics: [topic],
    publishing: {
      mode: 'asap',
      providers: Object.keys(accounts),
      accounts,
    },
    idempotencyKey,
  };
}

export function scheduledTarget(now = new Date()) {
  const target = new Date(now.getTime() + SCHEDULE_LEAD_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    startAt: `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`,
    times: [`${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`],
    timezone: 'UTC',
    target,
  };
}

export function buildScheduledPayload({ personaId, topic, accounts, idempotencyKey, schedule }) {
  return {
    personaId,
    topics: [topic],
    publishing: {
      mode: 'scheduled',
      providers: Object.keys(accounts),
      accounts,
      schedule: {
        startAt: schedule.startAt,
        times: schedule.times,
        timezone: schedule.timezone,
      },
    },
    idempotencyKey,
  };
}

//---------------
// HTTP (the API key never appears in an error message)
//---------------

async function apiJson(client, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${client.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${client.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new FlightError(
      `test-flight: request ${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!res.ok || parsed === null || parsed.success !== true) {
    const detail = parsed !== null ? JSON.stringify(parsed).slice(0, 500) : text.slice(0, 200);
    throw new FlightError(`test-flight: ${method} ${path} -> HTTP ${res.status}: ${detail}`);
  }
  return parsed;
}

//---------------
// Assertions
//---------------

export function singleSlot(body, leg) {
  const slots = body.slots;
  if (!Array.isArray(slots) || slots.length !== 1) {
    throw new FlightError(
      `test-flight: ${leg} leg expected exactly 1 slot, got ${Array.isArray(slots) ? slots.length : 'none'}`,
    );
  }
  return slots[0];
}

export function assertPublishedSlot(slot, providers) {
  if (slot.status !== 'published') {
    throw new FlightError(
      `test-flight: ASAP slot ${slot.slotId} ended as '${slot.status}'${slot.error ? `: ${slot.error}` : ''}`,
    );
  }
  const links = Array.isArray(slot.publishLinks) ? slot.publishLinks : [];
  const have = new Set(
    links.map((link) => link && link.provider).filter((provider) => typeof provider === 'string'),
  );
  const missing = providers.filter((provider) => !have.has(provider));
  if (missing.length > 0) {
    throw new FlightError(
      `test-flight: ASAP slot ${slot.slotId} published but has no post link for: ${missing.join(', ')}`,
    );
  }
  return links;
}

export function assertScheduledSlot(slot, target) {
  if (slot.status === 'failed' || slot.status === 'cancelled') {
    throw new FlightError(
      `test-flight: scheduled slot ${slot.slotId} ended as '${slot.status}'${slot.error ? `: ${slot.error}` : ''}`,
    );
  }
  const slotAt = new Date(slot.slotAt).getTime();
  if (Number.isNaN(slotAt)) {
    throw new FlightError(`test-flight: scheduled slot ${slot.slotId} has an unparsable slotAt: ${slot.slotAt}`);
  }
  const driftMs = Math.abs(slotAt - target.getTime());
  if (driftMs > SLOT_AT_TOLERANCE_MS) {
    throw new FlightError(
      `test-flight: scheduled slot ${slot.slotId} lands at ${slot.slotAt}, ` +
        `expected ~${target.toISOString()} (drift ${Math.round(driftMs / 60000)}m exceeds 10m)`,
    );
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForPublished(client, slotId, providers, { timeoutMs, intervalMs, fetchSlot, sleepFn = sleep, nowFn = Date.now } = {}) {
  const getSlot =
    fetchSlot ??
    (async () => {
      const body = await apiJson(client, `/api/schedule/slots/${slotId}`);
      return body.slot;
    });
  const deadline = nowFn() + timeoutMs;
  for (;;) {
    const slot = await getSlot();
    if (slot.status === 'published') return assertPublishedSlot(slot, providers);
    if (slot.status === 'failed' || slot.status === 'cancelled') {
      throw new FlightError(
        `test-flight: ASAP slot ${slotId} ended as '${slot.status}'${slot.error ? `: ${slot.error}` : ''}`,
      );
    }
    if (nowFn() >= deadline) {
      throw new FlightError(
        `test-flight: timed out after ${Math.round(timeoutMs / 60000)}m waiting for slot ${slotId} to publish (last status '${slot.status}')`,
      );
    }
    await sleepFn(intervalMs);
  }
}

//---------------
// Main flow
//---------------

async function main(env = process.env, now = new Date()) {
  const cfg = resolveConfig(env);
  const topic = resolveTopic(env, now);
  const providers = Object.keys(cfg.accounts);
  const client = { apiBaseUrl: cfg.apiBaseUrl, apiKey: cfg.apiKey };
  const summary = [];

  console.log(`test-flight: leg 1/2 (ASAP) topic="${topic}" providers=${providers.join(',')}`);
  const asapBody = await apiJson(client, '/api/videos/generate-and-schedule', {
    method: 'POST',
    body: buildAsapPayload({
      personaId: cfg.personaId,
      topic,
      accounts: cfg.accounts,
      idempotencyKey: `test-flight-${cfg.runId}-asap`,
    }),
  });
  const asapSlot = singleSlot(asapBody, 'ASAP');
  const links = await waitForPublished(client, asapSlot.slotId, providers, {
    timeoutMs: cfg.pollTimeoutMs,
    intervalMs: cfg.pollIntervalMs,
  });
  summary.push(`ASAP slot ${asapSlot.slotId} published: ${links.map((link) => `${link.provider}=${link.url}`).join(' ')}`);

  console.log('test-flight: leg 2/2 (scheduled)');
  const target = scheduledTarget(now);
  const scheduledBody = await apiJson(client, '/api/videos/generate-and-schedule', {
    method: 'POST',
    body: buildScheduledPayload({
      personaId: cfg.personaId,
      topic,
      accounts: cfg.accounts,
      idempotencyKey: `test-flight-${cfg.runId}-scheduled`,
      schedule: target,
    }),
  });
  const schedSlot = singleSlot(scheduledBody, 'scheduled');
  assertScheduledSlot(schedSlot, target.target);
  summary.push(`scheduled slot ${schedSlot.slotId} at ${schedSlot.slotAt}`);
  if (cfg.scheduledAction === 'cancel') {
    await apiJson(client, `/api/schedule/slots/${schedSlot.slotId}`, { method: 'DELETE' });
    summary.push(`scheduled slot ${schedSlot.slotId} cancelled`);
  } else {
    summary.push(`scheduled slot ${schedSlot.slotId} left to fire at ${schedSlot.slotAt}`);
  }

  const lines = ['## test-flight: PASS', '', ...summary.map((line) => `- ${line}`)];
  const summaryPath = optionalEnv(env, 'GITHUB_STEP_SUMMARY');
  if (summaryPath !== '') {
    await writeFile(summaryPath, `${lines.join('\n')}\n`, { flag: 'a' });
  }
  for (const line of summary) console.log(`test-flight: ${line}`);
}

const invokedAsMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
