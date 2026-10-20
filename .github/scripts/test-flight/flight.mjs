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
//      generate-and-schedule dispatches immediately, so the slot is
//      `generating` and DELETE /api/schedule/slots/:id refuses it (and
//      refuses the last slot of a schedule). Cancel is DELETE /api/schedule
//      with the schedule id from the create response, which removes
//      unpublished slot rows. The flight only treats the slot as stopped
//      when a follow-up GET returns 404. Cleanup runs even when the
//      assertion fails. Do not run this until that cancel is deployed:
//      an older server leaves the generating slot in place and the post
//      still goes out ~3h later.
//
// Auth is a Post Engineer API key (TEST_FLIGHT_POST_ENGINEER_API_KEY) belonging to the
// funded test account; the key only ever lives in CI secrets. Account ids
// arrive via workflow_dispatch inputs (manual flight) or repo Variables/Secrets
// (scheduled monitor) — or are auto-discovered from GET /api/account when none
// are configured. Explicit ids always win. Nothing is hardcoded here.
//
// Configuration (environment, fail-fast — every missing value is an error):
//   TEST_FLIGHT_POST_ENGINEER_API_KEY  required. Post Engineer API key of
//                                  the test account.
//   TEST_FLIGHT_PERSONA_ID         required. Persona UUID (must be in the
//                                  key's persona scope).
//   TEST_FLIGHT_BLUESKY_ACCOUNT_ID / TEST_FLIGHT_INSTAGRAM_ACCOUNT_ID /
//   TEST_FLIGHT_YOUTUBE_ACCOUNT_ID optional. When none is set, the flight
//                                  discovers the key's connected accounts
//                                  via GET /api/account.
//   TEST_FLIGHT_TOPIC              optional. When empty, every flight
//                                  (manual or scheduled) rotates MONITOR_TOPICS.
//   TEST_FLIGHT_API_BASE_URL       default https://post-engineer.com.
//   TEST_FLIGHT_SCHEDULED_ACTION   'cancel' (default) or 'leave'.
//   TEST_FLIGHT_FACELESS             'true' to generate faceless videos
//                                  (persona kept for voice + account
//                                  routing, but options.faceless=true
//                                  skips the GPU lipsync render). Used by
//                                  the test-flight-faceless workflow;
//                                  unset/false for the persona flight.
//   TEST_FLIGHT_RUN_ID             idempotency base. The workflow passes
//                                  `${github.run_id}-${github.run_attempt}`
//                                  so a re-run is not treated as a replay.
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
// Field carrying the provider account id in GET /api/account items.
// Mirrors toPublicAccount in apps/web/lib/providers/registry.ts.
export const ACCOUNT_ID_FIELDS = {
  youtube: 'channelId',
  instagram: 'igUserId',
  bluesky: 'did',
};
// 3h10m: safely inside the [3h, 30d] schedule window (SCHEDULE_MIN_ADVANCE_HOURS).
export const SCHEDULE_LEAD_MS = (3 * 60 + 10) * 60 * 1000;
export const SLOT_AT_TOLERANCE_MS = 10 * 60 * 1000;
export const DEFAULT_POLL_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
export const REQUEST_TIMEOUT_MS = 60 * 1000;

// Evergreen topics for the scheduled monitor (manual flights pass their own).
export const MONITOR_TOPICS = [
  'Where to eat francesinha in Porto like a local',
  'The best viewpoints in Porto you can visit for free',
  'Porto in one day: what to visit first',
  'Where locals actually eat in Porto (not tourist traps)',
  'The hidden streets of Porto worth getting lost in',
  'Port wine cellars in Vila Nova de Gaia: what to know before you go',
  'Morning in Porto: the perfect riverside walk',
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
  const apiKey = requiredEnv(env, 'TEST_FLIGHT_POST_ENGINEER_API_KEY');
  const personaId = requiredEnv(env, 'TEST_FLIGHT_PERSONA_ID');
  const accounts = {};
  for (const provider of PROVIDER_ORDER) {
    const accountId = optionalEnv(env, `TEST_FLIGHT_${provider.toUpperCase()}_ACCOUNT_ID`);
    if (accountId !== '') accounts[provider] = [accountId];
  }
  // Empty is fine: main() auto-discovers the key's connected accounts via
  // GET /api/account when nothing explicit was configured.
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
  // Faceless mode: persona is still passed (for voice + account routing) but
  // options.faceless=true skips the GPU lipsync render — used by the
  // test-flight-faceless workflow when Modal/GPU is unavailable.
  const faceless = optionalEnv(env, 'TEST_FLIGHT_FACELESS') === 'true';
  return {
    apiKey,
    personaId,
    accounts,
    scheduledAction,
    apiBaseUrl,
    faceless,
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
// Account discovery
//---------------

// GET /api/account does not use the { success: true } envelope, so discovery
// reads the raw response instead of going through apiJson.
export async function discoverAccounts(client, fetchFn = fetch) {
  let res;
  try {
    res = await fetchFn(`${client.apiBaseUrl}/api/account`, {
      headers: { authorization: `Bearer ${client.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new FlightError(
      `test-flight: GET /api/account failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!res.ok || parsed === null || parsed.authenticated !== true || !Array.isArray(parsed.accounts)) {
    const detail = parsed !== null ? JSON.stringify(parsed).slice(0, 500) : text.slice(0, 200);
    throw new FlightError(`test-flight: GET /api/account -> HTTP ${res.status}: ${detail}`);
  }
  const accounts = {};
  for (const item of parsed.accounts) {
    const provider = item !== null && typeof item === 'object' ? item.provider : undefined;
    const field = typeof provider === 'string' ? ACCOUNT_ID_FIELDS[provider] : undefined;
    if (field === undefined) continue;
    const id = item[field];
    if (typeof id !== 'string' || id.trim() === '') continue;
    (accounts[provider] ??= []).push(id);
  }
  if (Object.keys(accounts).length === 0) {
    throw new FlightError(
      'test-flight: no connected social accounts found for this API key — ' +
        'connect at least one account (Perfil → Contas) on the test account first',
    );
  }
  return accounts;
}

// Explicit account ids always win; when none are configured the flight
// discovers the key's connected accounts instead of failing.
export async function resolveFlightAccounts({ explicit, client, discover = discoverAccounts }) {
  if (Object.keys(explicit).length > 0) return explicit;
  return discover(client);
}

//---------------
// Payloads
//---------------

export function buildAsapPayload({ personaId, topic, accounts, idempotencyKey, faceless = false }) {
  return {
    personaId,
    topics: [topic],
    publishing: {
      mode: 'asap',
      providers: Object.keys(accounts),
      accounts,
    },
    ...(faceless ? { options: { faceless: true } } : {}),
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

export function buildScheduledPayload({ personaId, topic, accounts, idempotencyKey, schedule, faceless = false }) {
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
    ...(faceless ? { options: { faceless: true } } : {}),
    idempotencyKey,
  };
}

//---------------
// HTTP (the API key never appears in an error message)
//---------------

async function apiRequest(client, path, { method = 'GET', body } = {}) {
  const doFetch = client.fetchFn ?? fetch;
  let res;
  try {
    res = await doFetch(`${client.apiBaseUrl}${path}`, {
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
  return { status: res.status, parsed, ok: res.ok };
}

async function apiJson(client, path, options) {
  const { method = 'GET' } = options ?? {};
  const result = await apiRequest(client, path, options);
  if (!result.ok || result.parsed === null || result.parsed.success !== true) {
    const detail = result.parsed !== null ? JSON.stringify(result.parsed).slice(0, 500) : '';
    throw new FlightError(`test-flight: ${method} ${path} -> HTTP ${result.status}: ${detail}`);
  }
  return result.parsed;
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

// The create response names the slot id `slotId`; the slot-detail
// response (GET /api/schedule/slots/[slotId]) names it `id`. The ASAP
// assertion runs against the detail shape (waitForPublished) and the
// scheduled assertion against the create shape, so resolve the label
// from either field instead of printing "undefined" (flight 2026-10-20).
export function slotLabel(slot) {
  if (slot && typeof slot.slotId === 'string' && slot.slotId) return slot.slotId;
  if (slot && typeof slot.id === 'string' && slot.id) return slot.id;
  return 'unknown';
}

export function assertPublishedSlot(slot, providers) {
  if (slot.status !== 'published') {
    throw new FlightError(
      `test-flight: ASAP slot ${slotLabel(slot)} ended as '${slot.status}'${slot.error ? `: ${slot.error}` : ''}`,
    );
  }
  const links = Array.isArray(slot.publishLinks) ? slot.publishLinks : [];
  const have = new Set(
    links.map((link) => link && link.provider).filter((provider) => typeof provider === 'string'),
  );
  const missing = providers.filter((provider) => !have.has(provider));
  if (missing.length > 0) {
    throw new FlightError(
      `test-flight: ASAP slot ${slotLabel(slot)} published but has no post link for: ${missing.join(', ')}`,
    );
  }
  return links;
}

// Statuses a just-created scheduled slot may report. `generating` is the
// normal one: generate-and-schedule dispatches every slot before it
// responds. Cancellation is DELETE /api/schedule, not the per-slot DELETE
// (that route 409s on generating and on the last slot).
const SCHEDULED_LANDING_STATUSES = new Set(['pending', 'awaiting', 'generating', 'ready']);

export function assertScheduledSlot(slot, target) {
  if (!SCHEDULED_LANDING_STATUSES.has(slot.status)) {
    throw new FlightError(
      `test-flight: scheduled slot ${slotLabel(slot)} ended as '${slot.status}'${slot.error ? `: ${slot.error}` : ''}`,
    );
  }
  const slotAt = new Date(slot.slotAt).getTime();
  if (Number.isNaN(slotAt)) {
    throw new FlightError(`test-flight: scheduled slot ${slotLabel(slot)} has an unparsable slotAt: ${slot.slotAt}`);
  }
  const driftMs = Math.abs(slotAt - target.getTime());
  if (driftMs > SLOT_AT_TOLERANCE_MS) {
    throw new FlightError(
      `test-flight: scheduled slot ${slotLabel(slot)} lands at ${slot.slotAt}, ` +
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

// DELETE /api/schedule removes unpublished slot rows. A 2xx is not proof:
// a server that only deletes the schedule row (or 409s) leaves a generating
// slot that the publisher will post. Only a follow-up GET 404 means the
// slot is gone. Never `return` from the caller's finally — that would
// swallow the assertion error this cleanup runs beside.
async function confirmScheduleCancelled(client, created) {
  const deletePath = `/api/schedule?id=${encodeURIComponent(created.scheduleId)}`;
  const deleted = await apiRequest(client, deletePath, { method: 'DELETE' });
  if (created.slotId === null || created.slotId === undefined) {
    const ids =
      deleted.parsed !== null && Array.isArray(deleted.parsed.cancelledSlotIds)
        ? deleted.parsed.cancelledSlotIds
        : [];
    if (!deleted.ok || ids.length === 0) {
      throw new FlightError(
        `test-flight: a scheduled post on schedule ${created.scheduleId} may still publish; ` +
          `DELETE /api/schedule returned HTTP ${deleted.status} and did not report a removed slot. ` +
          `Remove it before it is due.`,
      );
    }
    return;
  }
  const probe = await apiRequest(client, `/api/schedule/slots/${encodeURIComponent(created.slotId)}`);
  if (probe.status !== 404) {
    const slot = probe.parsed !== null && probe.parsed.slot !== null && typeof probe.parsed.slot === 'object'
      ? probe.parsed.slot
      : {};
    const status = typeof slot.status === 'string' ? slot.status : 'unknown';
    const slotAt = typeof slot.slotAt === 'string' ? slot.slotAt : created.slotAt ?? 'unknown';
    throw new FlightError(
      `test-flight: scheduled slot ${created.slotId} is still '${status}' at ${slotAt} and CAN still publish. ` +
        `DELETE /api/schedule?id=${created.scheduleId} returned HTTP ${deleted.status}. ` +
        `Remove the schedule before ${slotAt}.`,
    );
  }
  if (!deleted.ok) {
    throw new FlightError(
      `test-flight: scheduled slot ${created.slotId} is gone and will not publish, ` +
        `but DELETE /api/schedule did not fully succeed (HTTP ${deleted.status}).`,
    );
  }
  const refunds = deleted.parsed !== null && Array.isArray(deleted.parsed.refunds) ? deleted.parsed.refunds : null;
  if (refunds !== null) {
    const unpaid = refunds.filter((item) => item.refunded !== true && item.alreadyRefunded !== true);
    if (unpaid.length > 0) {
      const ids = unpaid.map((item) => (typeof item.slotId === 'string' ? item.slotId : 'unknown')).join(', ');
      throw new FlightError(
        `test-flight: scheduled slot ${created.slotId} was cancelled and will not publish, ` +
          `but the prepaid refund did not land for: ${ids}`,
      );
    }
  }
}

//---------------
// Main flow
//---------------

export async function runFlight(env = process.env, options = {}) {
  const now = options.now ?? new Date();
  const cfg = resolveConfig(env);
  const topic = resolveTopic(env, now);
  const client = {
    apiBaseUrl: cfg.apiBaseUrl,
    apiKey: cfg.apiKey,
    fetchFn: options.fetchFn,
  };
  const accounts = await resolveFlightAccounts({ explicit: cfg.accounts, client });
  const providers = Object.keys(accounts);
  const summary = [];

  console.log(`test-flight: leg 1/2 (ASAP) topic="${topic}" providers=${providers.join(',')}${cfg.faceless ? ' faceless' : ''}`);
  const asapBody = await apiJson(client, '/api/videos/generate-and-schedule', {
    method: 'POST',
    body: buildAsapPayload({
      personaId: cfg.personaId,
      topic,
      accounts,
      idempotencyKey: `test-flight-${cfg.runId}-asap`,
      faceless: cfg.faceless,
    }),
  });
  const asapSlot = singleSlot(asapBody, 'ASAP');
  const links = await waitForPublished(client, asapSlot.slotId, providers, {
    timeoutMs: cfg.pollTimeoutMs,
    intervalMs: cfg.pollIntervalMs,
    sleepFn: options.sleepFn,
    nowFn: options.nowFn,
  });
  summary.push(`ASAP slot ${asapSlot.slotId} published: ${links.map((link) => `${link.provider}=${link.url}`).join(' ')}`);

  console.log('test-flight: leg 2/2 (scheduled)');
  const target = scheduledTarget(now);
  let created = null;
  let flightError = null;
  let cancelNote = null;
  try {
    const scheduledBody = await apiJson(client, '/api/videos/generate-and-schedule', {
      method: 'POST',
      body: buildScheduledPayload({
        personaId: cfg.personaId,
        topic,
        accounts,
        idempotencyKey: `test-flight-${cfg.runId}-scheduled`,
        schedule: target,
        faceless: cfg.faceless,
      }),
    });
    const scheduleId = scheduledBody.schedule !== null && typeof scheduledBody.schedule === 'object'
      ? scheduledBody.schedule.id
      : undefined;
    if (typeof scheduleId !== 'string' || scheduleId.length === 0) {
      throw new FlightError(
        'test-flight: scheduled response has no schedule.id; the post may still publish and this flight cannot cancel it',
      );
    }
    created = { scheduleId, slotId: null, slotAt: null };
    const schedSlot = singleSlot(scheduledBody, 'scheduled');
    created.slotId = typeof schedSlot.slotId === 'string' ? schedSlot.slotId : null;
    created.slotAt = schedSlot.slotAt;
    assertScheduledSlot(schedSlot, target.target);
    summary.push(`scheduled slot ${slotLabel(schedSlot)} at ${schedSlot.slotAt}`);
  } catch (error) {
    flightError = error instanceof Error ? error : new FlightError(String(error));
  } finally {
    if (cfg.scheduledAction === 'cancel' && created !== null) {
      try {
        await confirmScheduleCancelled(client, created);
        const label = created.slotId ?? 'unknown slot';
        cancelNote =
          `scheduled slot ${label} cancelled via DELETE /api/schedule?id=${created.scheduleId}; ` +
          'the slot is gone and will not publish';
      } catch (cancelError) {
        const message = cancelError instanceof Error ? cancelError.message : String(cancelError);
        flightError = flightError ? new FlightError(`${flightError.message}\n${message}`) : cancelError;
        cancelNote = null;
      }
    }
  }
  if (flightError) {
    if (cancelNote !== null) {
      throw new FlightError(`${flightError.message}\n${cancelNote}`);
    }
    throw flightError;
  }
  if (cancelNote !== null) {
    summary.push(cancelNote);
  } else if (created !== null) {
    summary.push(`scheduled slot ${slotLabel(created)} left to fire at ${created.slotAt}`);
  }

  const lines = ['## test-flight: PASS', '', ...summary.map((line) => `- ${line}`)];
  const summaryPath = optionalEnv(env, 'GITHUB_STEP_SUMMARY');
  if (summaryPath !== '') {
    await writeFile(summaryPath, `${lines.join('\n')}\n`, { flag: 'a' });
  }
  for (const line of summary) console.log(`test-flight: ${line}`);
  return summary;
}

async function main(env = process.env, now = new Date()) {
  await runFlight(env, { now });
}

const invokedAsMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
