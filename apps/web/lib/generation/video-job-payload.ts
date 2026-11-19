import type { EngineVideoRequestField } from '@/lib/engine/types';
import { logger } from '@/lib/logger';
const PERSONA_PREFERENCE_FIELDS: ReadonlyArray<{
  personaKey: string;
  jobKey: EngineVideoRequestField;
}> = [
  { personaKey: 'language', jobKey: 'video_language' },
  { personaKey: 'video_aspect', jobKey: 'video_aspect' },
  { personaKey: 'video_layout', jobKey: 'video_layout' },
  { personaKey: 'paragraph_number', jobKey: 'paragraph_number' },
];

const REQUEST_FORWARD_FIELDS: ReadonlyArray<EngineVideoRequestField> = [
  'video_title',
  'video_description',
  'video_type',
  'video_language',
  'video_aspect',
  'video_layout',
  'video_script',
  'video_quality',
  'paragraph_number',
  'webhook_url',
  'generation_id',
  'slot_id',
  'music_mood',
  'segments',
  'cta_type',
];
const REQUEST_FORWARD_FIELD_SET: ReadonlySet<string> = new Set(REQUEST_FORWARD_FIELDS);

export interface JobPersona {
  name: string;
  photo_url?: string;
  voice_id?: string;
  voice_audio_url?: string;
  language?: string | null;
  video_aspect?: string | null;
  video_layout?: string | null;
  paragraph_number?: number | null;
  niche?: string | null;
  face_quality?: string | null;
}

export function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildJobPayload(
  persona: JobPersona,
  request: Record<string, unknown>,
): Record<string, unknown> {
  const { personaId: _requestPersonaId, ...jobRequest } = request;
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
    const shown = droppedKeys.slice(0, 10).map((key) => JSON.stringify(key)).join(', ');
    const remainder = droppedKeys.length > 10 ? ` (+${droppedKeys.length - 10} more)` : '';
    logger.warn(`[video-job] dropping ${droppedKeys.length} unknown request field(s): ${shown}${remainder}`);
  }
  const personaRecord: Record<string, unknown> = { ...persona };
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

  const showsFace = request.video_type !== 'faceless';
  if (showsFace) {
    const hasQuality =
      typeof jobPayload.video_quality === 'string' &&
      (jobPayload.video_quality as string).trim().length > 0;
    if (!hasQuality) {
      jobPayload.video_quality = persona.face_quality === 'very_good' ? 'very-good' : 'ok';
    }
  }
  for (const key of REQUEST_FORWARD_FIELDS) {
    if (jobPayload[key] === null) {
      delete jobPayload[key];
    }
  }
  if (typeof jobPayload.video_quality === 'string' && jobPayload.video_quality.trim().length === 0) {
    delete jobPayload.video_quality;
  }

  return jobPayload;
}

function applyPersonaPreferences(
  jobPayload: { personaId?: string } & Record<string, unknown>,
  persona: Record<string, unknown>,
): { personaId?: string } & Record<string, unknown> {
  const result: { personaId?: string } & Record<string, unknown> = { ...jobPayload };
  for (const { personaKey, jobKey } of PERSONA_PREFERENCE_FIELDS) {
    const explicit = result[jobKey];
    const explicitPresent =
      typeof explicit === 'string' ? explicit.trim().length > 0 : explicit !== undefined && explicit !== null;
    if (explicitPresent) continue;
    delete result[jobKey];
    const preference = persona[personaKey];
    if (preference !== null && preference !== undefined && preference !== '') {
      result[jobKey] = preference;
    }
  }
  return result;
}
