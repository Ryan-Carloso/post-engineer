import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_API_BASE_URL = 'https://post-engineer.com';
export const PROVIDER_ORDER = ['bluesky', 'instagram', 'youtube'];
export const SCHEDULE_LEAD_MS = (3 * 60 + 10) * 60 * 1000;
export const SLOT_AT_TOLERANCE_MS = 10 * 60 * 1000;
export const DEFAULT_POLL_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
export const REQUEST_TIMEOUT_MS = 60 * 1000;

export class FlightError extends Error {}

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
  if (Object.keys(accounts).length === 0) {
    throw new FlightError(
      'test-flight: no explicit account ids configured — set TEST_FLIGHT_<PROVIDER>_ACCOUNT_ID for at least one provider (bluesky, instagram, youtube).',
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
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== 'https:' && !isLoopback) {
    throw new FlightError(`test-flight: TEST_FLIGHT_API_BASE_URL must be https (got '${apiBaseUrl}')`);
  }
  const voiceover = optionalEnv(env, 'TEST_FLIGHT_VOICEOVER') === 'true';
  return {
    apiKey,
    personaId,
    accounts,
    scheduledAction,
    apiBaseUrl,
    videoType: voiceover ? 'voiceover' : 'hook_lipsync',
    runId: optionalEnv(env, 'TEST_FLIGHT_RUN_ID') || `manual-${Date.now()}`,
    pollTimeoutMs: parsePositiveInt(optionalEnv(env, 'TEST_FLIGHT_POLL_TIMEOUT_MIN'), 'TEST_FLIGHT_POLL_TIMEOUT_MIN', DEFAULT_POLL_TIMEOUT_MS / 60000) * 60000,
    pollIntervalMs: parsePositiveInt(optionalEnv(env, 'TEST_FLIGHT_POLL_INTERVAL_SEC'), 'TEST_FLIGHT_POLL_INTERVAL_SEC', DEFAULT_POLL_INTERVAL_MS / 1000) * 1000,
  };
}

export function resolveScript(env, { readFile = readFileSync } = {}) {
  const inline = optionalEnv(env, 'TEST_FLIGHT_SCRIPT_JSON');
  const scriptPath = optionalEnv(env, 'TEST_FLIGHT_SCRIPT_PATH');
  let raw = inline;
  if (raw === '') {
    if (scriptPath === '') {
      throw new FlightError(
        'test-flight: missing TEST_FLIGHT_SCRIPT_PATH or TEST_FLIGHT_SCRIPT_JSON — run write-script first',
      );
    }
    try {
      raw = readFile(scriptPath, 'utf8');
    } catch (error) {
      throw new FlightError(
        `test-flight: cannot read script file ${scriptPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FlightError('test-flight: script JSON is not valid JSON');
  }
  const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
  const segments = parsed?.segments;
  if (title === '' || !Array.isArray(segments) || segments.length === 0) {
    throw new FlightError('test-flight: script must have a non-empty title and a non-empty segments array');
  }
  for (const segment of segments) {
    if (
      typeof segment !== 'object' ||
      segment === null ||
      (segment.kind !== 'hook' && segment.kind !== 'content') ||
      typeof segment.text !== 'string' ||
      segment.text.trim() === ''
    ) {
      throw new FlightError('test-flight: every script segment must be { kind: hook|content, text: non-empty }');
    }
  }
  return {
    title,
    description: segments.map((segment) => segment.text).join('\n\n'),
    segments,
    topic: typeof parsed?.topic === 'string' ? parsed.topic : '',
    source: typeof parsed?.source === 'string' ? parsed.source : 'unknown',
  };
}

export function buildAsapPayload({ personaId, title, description, segments, accounts, idempotencyKey, videoType = 'hook_lipsync' }) {
  return {
    personaId,
    title,
    description,
    publishing: {
      mode: 'asap',
      providers: Object.keys(accounts),
      accounts,
    },
    options: {
      segments,
      videoType,
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

export function buildScheduledPayload({ personaId, title, description, segments, accounts, idempotencyKey, schedule, videoType = 'hook_lipsync' }) {
  return {
    personaId,
    title,
    description,
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
    options: {
      segments,
      videoType,
    },
    idempotencyKey,
  };
}

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

export function singleSlot(body, leg) {
  const slots = body.slots;
  if (!Array.isArray(slots) || slots.length !== 1) {
    throw new FlightError(
      `test-flight: ${leg} leg expected exactly 1 slot, got ${Array.isArray(slots) ? slots.length : 'none'}`,
    );
  }
  return slots[0];
}

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

export async function runFlight(env = process.env, options = {}) {
  const now = options.now ?? new Date();
  const cfg = resolveConfig(env);
  const script = resolveScript(env, { readFile: options.readFile });
  const client = {
    apiBaseUrl: cfg.apiBaseUrl,
    apiKey: cfg.apiKey,
    fetchFn: options.fetchFn,
  };
  const accounts = cfg.accounts;
  const providers = Object.keys(accounts);
  const summary = [`script source: ${script.source}${script.topic ? ` (topic: ${script.topic})` : ''}`];

  console.log(`test-flight: leg 1/2 (ASAP) title="${script.title}" source=${script.source} providers=${providers.join(',')}${cfg.videoType === 'voiceover' ? ' voiceover' : ''}`);
  const asapBody = await apiJson(client, '/api/videos/generate-and-schedule', {
    method: 'POST',
    body: buildAsapPayload({
      personaId: cfg.personaId,
      title: script.title,
      description: script.description,
      segments: script.segments,
      accounts,
      idempotencyKey: `test-flight-${cfg.runId}-asap`,
      videoType: cfg.videoType,
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
        title: script.title,
        description: script.description,
        segments: script.segments,
        accounts,
        idempotencyKey: `test-flight-${cfg.runId}-scheduled`,
        schedule: target,
        videoType: cfg.videoType,
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
