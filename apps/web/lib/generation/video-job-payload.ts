import { logger } from '@/lib/logger';
//---------------
// buildJobPayload — SINGLE assembly of the engine (money-print) payload.
// Used by the normal flow (DB persona) and by debug (virtual persona from
// the form): explicit request > persona > house default.
//---------------

//---------------
// PERSONA_PREFERENCE_FIELDS — persona content preferences applied as job
// defaults when the request does not carry the field.
//---------------
const PERSONA_PREFERENCE_FIELDS: ReadonlyArray<{
  personaKey: string;
  jobKey: string;
}> = [
  { personaKey: 'language', jobKey: 'video_language' },
  { personaKey: 'video_aspect', jobKey: 'video_aspect' },
  { personaKey: 'script_prompt', jobKey: 'video_script_prompt' },
  { personaKey: 'paragraph_number', jobKey: 'paragraph_number' },
];

//---------------
// REQUEST_FORWARD_FIELDS — the only request keys forwarded to the engine.
// Unknown keys are dropped (one aggregated, capped warn) instead of
// traveling verbatim: a mistyped engine field would otherwise surface as
// the opaque 502, and guarding fields one by one is whack-a-mole.
// personaId/lipsync are consumed by the route itself and never reach the
// engine under their own names. The persona face MIX is gone entirely
// (migration 007): `lipsync` is the one and only face-shaped switch, and the
// route sets it from the per-post `faceless` choice.
//---------------
const REQUEST_FORWARD_FIELDS: ReadonlyArray<string> = [
  'video_subject',
  'video_language',
  'video_aspect',
  'video_script_prompt',
  'video_quality',
  'paragraph_number',
  // webhook_url is a first-class engine field (TaskVideoRequest validates it
  // as http(s)); it must survive the allowlist so per-request callbacks
  // (MCP webhookUrl) reach the engine's terminal dispatch.
  'webhook_url',
  // generation_id is the video_generations row id for this job: the engine
  // stamps it on the task row and on every PostHog lifecycle event, so
  // generation_id x task_id join in PostHog without a Supabase lookup.
  'generation_id',
];

export interface JobPersona {
  name: string;
  photo_url?: string;
  voice_id?: string;
  voice_audio_url?: string;
  language?: string | null;
  video_aspect?: string | null;
  script_prompt?: string | null;
  paragraph_number?: number | null;
  niche?: string | null;
  face_quality?: string | null;
}

//---------------
// hasNonEmptyString — "the field was actually provided" check. null counts as
// absent (clients commonly serialize missing fields as null); only a string
// with non-whitespace content counts as present.
//---------------
export function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildJobPayload(
  persona: JobPersona,
  request: Record<string, unknown>,
): Record<string, unknown> {
  const { personaId: _requestPersonaId, lipsync: _lipsync, ...jobRequest } = request;
  // Allowlist: only known engine-facing keys travel to the engine. Anything
  // else is dropped so a mistyped field can never reach the engine verbatim
  // and surface as the opaque 502 — guarding fields one by one is
  // whack-a-mole. personaId/lipsync are consumed by the route itself and
  // never reach the engine under their own names.
  const forwardedRequest: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(jobRequest)) {
    if (REQUEST_FORWARD_FIELDS.includes(key)) {
      forwardedRequest[key] = value;
    } else {
      droppedKeys.push(key);
    }
  }
  if (droppedKeys.length > 0) {
    // One aggregated warn (capped): a request carrying thousands of junk keys
    // must not flood the server logs with one line per key. Keys are
    // JSON-quoted: raw key names may contain control characters (e.g. \n),
    // which would otherwise let an authenticated caller forge log lines.
    const shown = droppedKeys.slice(0, 10).map((key) => JSON.stringify(key)).join(', ');
    const remainder = droppedKeys.length > 10 ? ` (+${droppedKeys.length - 10} more)` : '';
    logger.warn(`[video-job] dropping ${droppedKeys.length} unknown request field(s): ${shown}${remainder}`);
  }
  const personaRecord: Record<string, unknown> = { ...persona };
  const jobPayload = applyPersonaPreferences(
    { ...forwardedRequest, persona: { name: persona.name, photo_url: persona.photo_url, voice_id: persona.voice_id, voice_audio_url: persona.voice_audio_url } },
    personaRecord,
  );

  // Face quality (the persona's own, kebab-cased for the engine) becomes the
  // job's video_quality only when the job actually shows the face: a faceless
  // video has no face to resolve, so its resolution is the engine's business,
  // not the persona's.
  const showsFace = request.lipsync !== false;
  if (showsFace) {
    const hasQuality =
      typeof jobPayload.video_quality === 'string' &&
      (jobPayload.video_quality as string).trim().length > 0;
    if (!hasQuality) {
      jobPayload.video_quality = persona.face_quality === 'very_good' ? 'very-good' : 'ok';
    }
  }
  // Faceless: the persona's face quality does not apply. An explicit
  // request-level video_quality already in the payload is left alone —
  // explicit request beats the persona default.

  // The per-post "no face" choice reaches the engine as lipsync_enabled: false.
  // The route always sets it explicitly (it owns the faceless option), so an
  // absent request flag stays absent rather than being invented here.
  if (typeof request.lipsync === 'boolean') {
    jobPayload.lipsync_enabled = request.lipsync;
  } else if (typeof persona.niche === 'string' && persona.niche.trim().length > 0) {
    // Without a defined script (neither request nor persona), the niche guides the script.
    if (!hasNonEmptyString(jobPayload.video_script_prompt)) {
      jobPayload.video_script_prompt = `The content niche is: ${persona.niche.trim()}.`;
    }
  }

  // The engine requires video_subject; default it from the persona niche when
  // the request does not provide one. null counts as absent: clients commonly
  // serialize missing fields as null, and forwarding it verbatim would make
  // the engine reject the job (surfacing as the opaque 502).
  if (typeof persona.niche === 'string' && persona.niche.trim().length > 0) {
    if (!hasNonEmptyString(jobPayload.video_subject)) {
      jobPayload.video_subject = persona.niche.trim();
    }
  }

  // Final null pass: null counts as absent for every engine-facing field —
  // "null/empty values are never forwarded verbatim to the engine".
  // applyPersonaPreferences only strips the null marker for the preference
  // fields, and the face-mix repair only runs for numeric face mixes, so
  // without this a legacy persona receiving video_quality: null would
  // forward it verbatim and the engine (video_quality is non-Optional)
  // would reject the job with the opaque 502.
  for (const key of REQUEST_FORWARD_FIELDS) {
    if (jobPayload[key] === null) {
      delete jobPayload[key];
    }
  }
  // video_quality is the one non-Optional enum field outside the preference
  // machinery: an empty string can never be engine-valid, so drop it as
  // absent too instead of letting it travel verbatim.
  if (typeof jobPayload.video_quality === 'string' && jobPayload.video_quality.trim().length === 0) {
    delete jobPayload.video_quality;
  }

  return jobPayload;
}

//---------------
// applyPersonaPreferences — injects the persona preferences as job
// defaults: explicit request > persona > house default
// (when neither the request nor the persona carries the field, it is not
// sent and money-print applies its own default).
//---------------
function applyPersonaPreferences(
  jobPayload: { personaId?: string } & Record<string, unknown>,
  persona: Record<string, unknown>,
): { personaId?: string } & Record<string, unknown> {
  const result: { personaId?: string } & Record<string, unknown> = { ...jobPayload };
  for (const { personaKey, jobKey } of PERSONA_PREFERENCE_FIELDS) {
    const explicit = result[jobKey];
    // null counts as absent: clients commonly serialize missing fields as
    // null. Only a non-empty string or a defined non-string value counts as
    // explicitly present.
    const explicitPresent =
      typeof explicit === 'string' ? explicit.trim().length > 0 : explicit !== undefined && explicit !== null;
    if (explicitPresent) continue;
    // Drop the absent marker so null/empty values are never forwarded
    // verbatim to the engine.
    delete result[jobKey];
    const preference = persona[personaKey];
    if (preference !== null && preference !== undefined && preference !== '') {
      result[jobKey] = preference;
    }
  }
  return result;
}
