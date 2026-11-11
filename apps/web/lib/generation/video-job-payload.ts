import type { EngineVideoRequestField } from '@/lib/engine/types';
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
  jobKey: EngineVideoRequestField;
}> = [
  { personaKey: 'language', jobKey: 'video_language' },
  { personaKey: 'video_aspect', jobKey: 'video_aspect' },
  { personaKey: 'video_layout', jobKey: 'video_layout' },
  { personaKey: 'cta_text', jobKey: 'video_cta' },
  { personaKey: 'paragraph_number', jobKey: 'paragraph_number' },
];

//---------------
// REQUEST_FORWARD_FIELDS — the only request keys forwarded to the engine.
// Unknown keys are dropped (one aggregated, capped warn) instead of
// traveling verbatim: a mistyped engine field would otherwise surface as
// the opaque 502, and guarding fields one by one is whack-a-mole.
// personaId is consumed by the route itself and never reaches the engine
// under its own name. The video mode rides as video_type: the engine's
// lipsync_active rule reads it (faceless = no face, no photo needed).
// Typed against the generated engine contract (lib/engine/types.ts): a key
// the engine's TaskVideoRequest does not accept fails the typecheck.
//---------------
const REQUEST_FORWARD_FIELDS: ReadonlyArray<EngineVideoRequestField> = [
  // Agent-supplied publish copy (issue #542 follow-up): the video title
  // and description ride the direct dispatch payload into the task.
  'video_title',
  'video_description',
  // The one video mode (issue #542 follow-up): full_lipsync, hook_lipsync
  // or faceless. The route always sends it; without it the engine
  // rejects the job (the mode decides the render path and the price).
  'video_type',
  'video_language',
  'video_aspect',
  'video_layout',
  // video_script is a first-class engine field (VideoParams carries it as
  // the supplied script); a segments request joins its segments into this
  // field so the engine takes the supplied-script path, never the LLM one.
  'video_script',
  'video_quality',
  'paragraph_number',
  // webhook_url is a first-class engine field (TaskVideoRequest validates it
  // as http(s)); it must survive the allowlist so per-request callbacks
  // (MCP webhookUrl) reach the engine's terminal dispatch.
  'webhook_url',
  // generation_id is a first-class engine field (TaskVideoRequest carries
  // it as the web-side correlation id); it must survive the allowlist so
  // the engine can tag its PostHog events with it.
  'generation_id',
  // slot_id is a first-class engine field (TaskVideoRequest carries it as
  // the web-side slot id); it must survive the allowlist so boot orphan
  // triage can requeue web-created tasks on engine restart.
  'slot_id',
  // music_mood is a first-class engine field (VideoParams carries it as
  // the per-post BGM mood); without it a requested mood would be dropped
  // here and the engine would default every video to the first mood.
  'music_mood',
  // segments is a first-class engine field (TaskVideoRequest carries it):
  // without it a segments request would render the neutral canvas for
  // every segment and drop every user photo with no warning.
  'segments',
];
// String-keyed view for membership checks on untyped request keys.
const REQUEST_FORWARD_FIELD_SET: ReadonlySet<string> = new Set(REQUEST_FORWARD_FIELDS);

export interface JobPersona {
  name: string;
  photo_url?: string;
  voice_id?: string;
  voice_audio_url?: string;
  language?: string | null;
  video_aspect?: string | null;
  video_layout?: string | null;
  cta_text?: string | null;
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
  const { personaId: _requestPersonaId, ...jobRequest } = request;
  // Allowlist: only known engine-facing keys travel to the engine. Anything
  // else is dropped so a mistyped field can never reach the engine verbatim
  // and surface as the opaque 502 — guarding fields one by one is
  // whack-a-mole. personaId is consumed by the route itself and never
  // reaches the engine under its own name.
  const forwardedRequest: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(jobRequest)) {
    if (REQUEST_FORWARD_FIELD_SET.has(key)) {
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
  // The niche rides the engine-facing persona record as channel context.
  // Absent/blank niches are omitted, never forwarded verbatim.
  const enginePersona: Record<string, unknown> = {
    name: persona.name,
    photo_url: persona.photo_url,
    voice_id: persona.voice_id,
    voice_audio_url: persona.voice_audio_url,
  };
  if (hasNonEmptyString(persona.niche)) {
    enginePersona.niche = persona.niche;
  }
  const jobPayload = applyPersonaPreferences(
    { ...forwardedRequest, persona: enginePersona },
    personaRecord,
  );

  // Face quality (the persona's own, kebab-cased for the engine) becomes the
  // job's video_quality only when the job actually shows the face: a faceless
  // video has no face to resolve, so its resolution is the engine's business,
  // not the persona's.
  const showsFace = request.video_type !== 'faceless';
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
