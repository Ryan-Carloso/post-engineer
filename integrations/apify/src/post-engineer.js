// Pure Actor logic: validates the Actor input, calls the Post Engineer API
// through an injected fetch, and polls the video task. No Apify SDK here so
// it is unit-tested with node:test and no dependencies. The API key is sent
// only as the Bearer header and is redacted from every message it returns.

export const DEFAULT_API_URL = 'https://post-engineer.com';
export const PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'rumble'];
export const MODES = ['asap', 'scheduled'];
export const FACELESS_MATERIALS = ['broll', 'svg', 'images'];
// The "images" material renders only the given images, one per segment;
// the segments cap (MAX_SEGMENTS in the shared validator) bounds them.
export const IMAGES_MATERIAL = 'images';
export const MAX_IMAGES = 12;
export const API_KEY_PREFIX = 'pe_live_';
export const REQUEST_TIMEOUT_MS = 60_000;
export const POLL_INTERVAL_MS = 15_000;
export const DEFAULT_TIMEOUT_MINUTES = 30;
export const MAX_TIMEOUT_MINUTES = 60;

// Engine task states (AGENTS.md billing rules): only -1 and 1 are terminal.
const STATE_FAILED = -1;
const STATE_COMPLETE = 1;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export class ActorInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActorInputError';
  }
}

export class PostEngineerApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PostEngineerApiError';
    this.status = status;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

function requireString(raw, key) {
  const value = raw[key];
  if (!isNonEmptyString(value)) throw new ActorInputError(`${key} is required and must be a non-empty string.`);
  return value.trim();
}

function optionalString(raw, key) {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (!isNonEmptyString(value)) throw new ActorInputError(`${key} must be a non-empty string when given.`);
  return value.trim();
}

function optionalBoolean(raw, key, fallback) {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new ActorInputError(`${key} must be true or false.`);
  return value;
}

function parseApiUrl(raw) {
  const value = raw.apiUrl;
  if (value === undefined || value === null) return DEFAULT_API_URL;
  if (!isNonEmptyString(value)) throw new ActorInputError('apiUrl must be a non-empty string when given.');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ActorInputError('apiUrl must be an absolute URL.');
  }
  const loopback = LOOPBACK_HOSTS.includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ActorInputError('apiUrl must use https (http is allowed only for localhost).');
  }
  if (url.username !== '' || url.password !== '') {
    throw new ActorInputError('apiUrl must not contain credentials.');
  }
  return url.origin;
}

function parseProviders(raw) {
  const value = raw.providers;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ActorInputError(`providers must be a non-empty list of: ${PROVIDERS.join(', ')}.`);
  }
  for (const provider of value) {
    if (!PROVIDERS.includes(provider)) {
      throw new ActorInputError(`Unknown provider "${String(provider)}". Use: ${PROVIDERS.join(', ')}.`);
    }
  }
  if (new Set(value).size !== value.length) throw new ActorInputError('providers must not repeat.');
  return [...value];
}

function parseAccounts(raw, providers) {
  const value = raw.accounts;
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new ActorInputError('accounts must be an object of provider -> account id list.');
  for (const [provider, ids] of Object.entries(value)) {
    if (!providers.includes(provider)) {
      throw new ActorInputError(`accounts.${provider} is not one of the selected providers.`);
    }
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isNonEmptyString)) {
      throw new ActorInputError(`accounts.${provider} must be a non-empty list of account ids.`);
    }
  }
  return value;
}

function parseSchedule(raw, mode) {
  const value = raw.schedule;
  const given = value !== undefined && value !== null;
  if (mode === 'asap') {
    if (given) throw new ActorInputError('schedule is only allowed when mode is "scheduled".');
    return undefined;
  }
  if (!isRecord(value)) throw new ActorInputError('schedule is required when mode is "scheduled".');
  const { startAt, times, timezone } = value;
  if (!isNonEmptyString(startAt)) throw new ActorInputError('schedule.startAt must be an ISO datetime string.');
  if (!Array.isArray(times) || times.length === 0 || !times.every(isNonEmptyString)) {
    throw new ActorInputError('schedule.times must be a non-empty list of times (HH:MM).');
  }
  if (!isNonEmptyString(timezone)) throw new ActorInputError('schedule.timezone must be an IANA zone.');
  return { startAt, times, timezone };
}

function parseTimeoutMinutes(raw) {
  const value = raw.timeoutMinutes;
  if (value === undefined || value === null) return DEFAULT_TIMEOUT_MINUTES;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MINUTES) {
    throw new ActorInputError(`timeoutMinutes must be an integer from 1 to ${MAX_TIMEOUT_MINUTES}.`);
  }
  return value;
}

// How the video looks, with the rules generate-and-schedule enforces before
// any charge (route.ts): a post without a persona must be faceless and needs
// a voice; full lip-sync needs a persona's face, so never with faceless.
function parseLook(raw, personaId) {
  const faceless = optionalBoolean(raw, 'faceless', personaId === undefined);
  const voiceId = optionalString(raw, 'voiceId');
  const fullLipsync = optionalBoolean(raw, 'fullLipsync', false);
  const facelessMaterial = raw.facelessMaterial ?? undefined;
  if (facelessMaterial !== undefined && !FACELESS_MATERIALS.includes(facelessMaterial)) {
    throw new ActorInputError(`facelessMaterial must be one of: ${FACELESS_MATERIALS.join(', ')}.`);
  }
  if (personaId === undefined && !faceless) {
    throw new ActorInputError('A video without a persona must be faceless: set faceless to true or give a personaId.');
  }
  if (personaId === undefined && voiceId === undefined) {
    throw new ActorInputError('A video without a persona needs a voice: set voiceId (an id from GET /api/persona/voices).');
  }
  if (fullLipsync && (faceless || personaId === undefined)) {
    throw new ActorInputError('fullLipsync needs a persona with a face, so it cannot be used with faceless videos.');
  }
  return { faceless, voiceId, fullLipsync, facelessMaterial };
}

// Body paragraphs (split on blank lines). With images each paragraph is its
// own segment, so a long body can carry one image per paragraph.
function bodyParagraphs(body) {
  return body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph !== '');
}

// images: public https URLs, one per segment (hook, each body paragraph,
// CTA), only with the "images" material, which in turn needs them. The
// web fetches them with its own SSRF guard; here only the shape is checked.
function parseImages(raw, facelessMaterial, body) {
  const value = raw.images;
  const given = value !== undefined && value !== null;
  if (facelessMaterial !== IMAGES_MATERIAL) {
    if (given) throw new ActorInputError('images can only be used with facelessMaterial "images".');
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new ActorInputError('facelessMaterial "images" needs images: one public image URL per segment.');
  }
  for (const [index, url] of value.entries()) {
    let parsed;
    try {
      parsed = new URL(isNonEmptyString(url) ? url.trim() : '');
    } catch {
      throw new ActorInputError(`images[${index}] must be an absolute https URL.`);
    }
    if (parsed.protocol !== 'https:') throw new ActorInputError(`images[${index}] must be an https URL.`);
  }
  const segmentCount = bodyParagraphs(body).length + 2;
  if (segmentCount > MAX_IMAGES) {
    throw new ActorInputError(`With images the body may have at most ${MAX_IMAGES - 2} paragraphs (one segment each).`);
  }
  if (value.length !== segmentCount) {
    throw new ActorInputError(
      `images must have exactly ${segmentCount} URLs: one for the hook, one per body paragraph (${segmentCount - 2}), one for the CTA.`,
    );
  }
  return value.map((url) => url.trim());
}

/** Validates and normalizes the Actor input; throws ActorInputError. */
export function parseInput(raw) {
  if (!isRecord(raw)) throw new ActorInputError('Actor input must be a JSON object.');
  // No key means a dry run (see runActor): the Store's daily auto-test runs
  // the default input, which cannot carry anyone's key.
  const apiKey = optionalString(raw, 'apiKey') ?? null;
  if (apiKey !== null && !apiKey.startsWith(API_KEY_PREFIX)) {
    throw new ActorInputError(`apiKey must be a Post Engineer API key (starts with ${API_KEY_PREFIX}).`);
  }
  const mode = raw.mode === undefined || raw.mode === null ? 'asap' : raw.mode;
  if (!MODES.includes(mode)) throw new ActorInputError(`mode must be one of: ${MODES.join(', ')}.`);
  const providers = parseProviders(raw);
  const personaId = optionalString(raw, 'personaId');
  const look = parseLook(raw, personaId);
  const body = requireString(raw, 'body');
  return {
    apiKey,
    apiUrl: parseApiUrl(raw),
    title: requireString(raw, 'title'),
    hook: requireString(raw, 'hook'),
    body,
    images: parseImages(raw, look.facelessMaterial, body),
    cta: requireString(raw, 'cta'),
    personaId,
    ...look,
    providers,
    accounts: parseAccounts(raw, providers),
    mode,
    schedule: parseSchedule(raw, mode),
    waitForCompletion: optionalBoolean(raw, 'waitForCompletion', true),
    timeoutMinutes: parseTimeoutMinutes(raw),
  };
}

/** Hook first, body, CTA last: the segments contract of generate-and-schedule.
 *  With images, each body paragraph is a segment and segment i shows images[i]. */
export function buildSegments(input) {
  if (input.images === undefined) {
    return [
      { kind: 'hook', text: input.hook },
      { kind: 'body', text: input.body },
      { kind: 'cta', text: input.cta },
    ];
  }
  const texts = [
    { kind: 'hook', text: input.hook },
    ...bodyParagraphs(input.body).map((text) => ({ kind: 'body', text })),
    { kind: 'cta', text: input.cta },
  ];
  return texts.map((segment, index) => ({ ...segment, media: { url: input.images[index] } }));
}

/** Request body for POST /api/videos/generate-and-schedule. */
export function buildGenerateBody(input, idempotencyKey) {
  return {
    title: input.title,
    ...(input.personaId !== undefined ? { personaId: input.personaId } : {}),
    publishing: {
      mode: input.mode,
      providers: input.providers,
      ...(input.accounts !== undefined ? { accounts: input.accounts } : {}),
      ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
    },
    options: {
      segments: buildSegments(input),
      ...(input.faceless ? { faceless: true } : {}),
      ...(input.voiceId !== undefined ? { voiceId: input.voiceId } : {}),
      ...(input.facelessMaterial !== undefined ? { facelessMaterial: input.facelessMaterial } : {}),
      ...(input.fullLipsync ? { fullLipsync: true } : {}),
    },
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  };
}

/** Removes the API key from any text that may reach logs or the run output. */
export function redact(text, apiKey) {
  return apiKey === null || apiKey === '' ? text : text.split(apiKey).join('[redacted]');
}

function errorMessageOf(json, status) {
  if (isRecord(json)) {
    if (isNonEmptyString(json.error)) return json.error;
    if (isNonEmptyString(json.message)) return json.message;
  }
  return `HTTP ${status}`;
}

async function callApi(ctx, method, path, body) {
  const headers = { Authorization: `Bearer ${ctx.input.apiKey}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await ctx.fetchImpl(`${ctx.input.apiUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let json;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    throw new PostEngineerApiError(`${method} ${path} returned a non-JSON response (HTTP ${response.status}).`, response.status);
  }
  return { status: response.status, ok: response.ok, json };
}

function taskPayload(json) {
  if (!isRecord(json)) return null;
  return isRecord(json.body) ? json.body : json;
}

function taskStateOf(task) {
  for (const candidate of [task.state, task.task_state]) {
    if (Number.isInteger(candidate)) return candidate;
    if (typeof candidate === 'string' && /^-?\d+$/.test(candidate.trim())) return Number.parseInt(candidate, 10);
  }
  return null;
}

const isTransient = (status) => status === 429 || status >= 500;

// Slot statuses (GET /api/schedule/slots/{id}) that mean the video exists.
// 'completed' is the presentation of a slot whose lost task was settled as
// delivered (apps/web/lib/schedule-slot-presentation.ts).
const DELIVERED_SLOT_STATUSES = ['ready', 'publishing', 'published', 'completed'];

// 410 Gone means the engine no longer has the task, but the web proxy sends
// the same 410 whether the video was delivered first (completed, no refund)
// or not (failed and refunded). The slot status carries that verdict.
async function settleGoneTask(ctx, slotId, goneJson) {
  const { ok, json } = await callApi(ctx, 'GET', `/api/schedule/slots/${encodeURIComponent(slotId)}`);
  const slotStatus = ok && isRecord(json) && isRecord(json.slot) ? json.slot.status : null;
  if (slotStatus === 'failed') {
    return { videoStatus: 'failed', error: redact(errorMessageOf(goneJson, 410), ctx.input.apiKey) };
  }
  if (DELIVERED_SLOT_STATUSES.includes(slotStatus)) return { videoStatus: 'complete', videos: [] };
  return {
    videoStatus: 'unknown',
    error: 'The engine no longer has this task and the slot status could not confirm the result; check the post in Post Engineer.',
  };
}

async function waitForTask(ctx, slotId, taskId, deadline) {
  const path = `/api/persona/video-status/${encodeURIComponent(taskId)}`;
  while (ctx.now() < deadline) {
    const { status, ok, json } = await callApi(ctx, 'GET', path);
    if (status === 410) return settleGoneTask(ctx, slotId, json);
    if (ok) {
      const task = taskPayload(json);
      const state = task === null ? null : taskStateOf(task);
      if (state === STATE_COMPLETE) {
        return { videoStatus: 'complete', videos: Array.isArray(task.videos) ? task.videos : [] };
      }
      if (state === STATE_FAILED) {
        const error = isNonEmptyString(task.error) ? task.error : 'Video generation failed.';
        return { videoStatus: 'failed', error: redact(error, ctx.input.apiKey) };
      }
    } else if (!isTransient(status)) {
      throw new PostEngineerApiError(redact(`Video status check failed: ${errorMessageOf(json, status)}`, ctx.input.apiKey), status);
    }
    ctx.log(`Task ${taskId}: still processing.`);
    await ctx.sleep(POLL_INTERVAL_MS);
  }
  return { videoStatus: 'timeout' };
}

/**
 * Runs one Actor job: validate the script (no tokens), generate and
 * schedule one video, then optionally wait for it. Throws ActorInputError
 * or PostEngineerApiError with a redacted message on failure. Without an
 * API key it is a dry run: the input is validated and the request that
 * would be sent is returned, with no API call and no tokens spent.
 */
export async function runActor({ input: rawInput, fetchImpl, sleep, now, idempotencyKey, log }) {
  const input = parseInput(rawInput);
  if (input.apiKey === null) {
    log('No apiKey: dry run, nothing is generated or published.');
    return {
      dryRun: true,
      message: 'Dry run: no apiKey was given, so nothing was generated, published or charged. Add your Post Engineer API key (https://post-engineer.com/recipes) to create the video.',
      request: buildGenerateBody(input, idempotencyKey),
    };
  }
  const ctx = { input, fetchImpl, sleep, now, log };

  const validation = await callApi(ctx, 'POST', '/api/videos/validate-script', {
    segments: buildSegments(input),
    ...(input.facelessMaterial !== undefined ? { facelessMaterial: input.facelessMaterial } : {}),
  });
  if (!validation.ok) {
    const detail = errorMessageOf(validation.json, validation.status);
    // Only a 400 is about the script; anything else is the key or the service.
    if (validation.status === 400) throw new ActorInputError(redact(`Script rejected: ${detail}`, input.apiKey));
    const prefix = validation.status === 401 || validation.status === 403
      ? 'API key rejected (create one at https://post-engineer.com/recipes)'
      : 'Script validation failed';
    throw new PostEngineerApiError(redact(`${prefix}: ${detail}`, input.apiKey), validation.status);
  }

  const generated = await callApi(ctx, 'POST', '/api/videos/generate-and-schedule', buildGenerateBody(input, idempotencyKey));
  if (!generated.ok || !isRecord(generated.json) || generated.json.success !== true) {
    throw new PostEngineerApiError(
      redact(`Video generation was not accepted: ${errorMessageOf(generated.json, generated.status)}`, input.apiKey),
      generated.status,
    );
  }

  const { schedule, slots, replayed, warnings } = generated.json;
  const result = {
    scheduleId: isRecord(schedule) ? schedule.id : null,
    mode: input.mode,
    replayed: replayed === true,
    warnings: Array.isArray(warnings) ? warnings : [],
    slots: Array.isArray(slots) ? slots.map((slot) => ({ ...slot })) : [],
  };
  if (!input.waitForCompletion) return result;

  const deadline = now() + input.timeoutMinutes * 60_000;
  for (const slot of result.slots) {
    if (!isNonEmptyString(slot.taskId)) continue;
    Object.assign(slot, await waitForTask(ctx, slot.slotId, slot.taskId, deadline));
  }
  return result;
}
