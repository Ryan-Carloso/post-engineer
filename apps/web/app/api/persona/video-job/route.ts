import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import { attachGenerationTask, gateGeneration, recordGenerationStart, recordGenerationUpdate, refundFailedGeneration, startEngineVideoTask, uploadEngineTempAsset } from '@/lib/generation/video-generation';
import { buildJobPayload, hasNonEmptyString, type JobPersona } from '@/lib/generation/video-job-payload';
import { parsePersonaForm, VALID_VIDEO_ASPECTS } from '@/lib/persona-schema';
import { recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';
import { normalizeDebugTaskResponse } from '@/lib/debug-video';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

//---------------
// POST /api/persona/video-job — proxy to money-print.
// Auth = Supabase session (GitHub provider). money-print is stateless.
//
// NORMAL flow: JSON with personaId — persona loaded from the database.
// FACELESS flow: JSON without personaId — no persona is loaded; the job
// runs with documented defaults (fully faceless, no photo) and the voice
// (audio_url or voice_id) and video_subject supplied by the request.
// Persona-scoped API keys are rejected for faceless jobs: their allowlist
// names explicit personas and a faceless job uses none of them.
// DEBUG flow: multipart with debugMode=1 — "virtual persona" built from the
// form, nothing persisted. All flows go through the SAME buildJobPayload,
// gateGeneration (tokens) and engine.
//---------------

const SIGNED_URL_EXPIRES_SECONDS = 60 * 60; // a job can take a few minutes

//---------------
// FACELESS_PERSONA_NAME — the persona name recorded for faceless
// generations (History page) and sent to the engine.
//---------------
const FACELESS_PERSONA_NAME = 'Faceless generation';

// Engine-valid lip-sync qualities (LipSyncQuality in the engine schema is a
// non-Optional enum: any other value 422s). The face-mix block derives these
// from the persona's face_quality ('very_good' -> 'very-good') when the
// request does not define video_quality explicitly.
const VALID_VIDEO_QUALITIES = ['ok', 'very-good'] as const;

//---------------
// Custom audio_url limits: real audio files only.
// The max duration (60s, temporary product limit) is verified
// in the engine with ffprobe — here HEAD only guarantees type + size,
// before any token charge.
//---------------
const MAX_CUSTOM_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB — fits 1 min of uncompressed audio
const CUSTOM_AUDIO_HEAD_TIMEOUT_MS = 10_000;
const SSRF_MAX_REDIRECTS = 5;

type CustomAudioCheck = { ok: true } | { ok: false; error: string };

//---------------
// SSRF: the audio URL is fetched server-side, so it must point to a
// public address. Blocks private literal IPs, hostnames resolving to
// private IPs, and redirects to those destinations. Fail closed.
//---------------
function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 127) return false; // "this network" + loopback
    if (a === 10) return false; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
    if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 documentation
    if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 documentation
    if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 documentation
    if (a >= 224) return false; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return true;
  }
  if (family === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return false;
    if (normalized.startsWith('::ffff:')) {
      return isPublicIp(normalized.slice('::ffff:'.length)); // mapped IPv4
    }
    const firstGroup = normalized.split(':')[0] ?? '';
    const first = parseInt(firstGroup, 16);
    if (Number.isNaN(first)) return false;
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
    if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
    return true;
  }
  return false;
}

async function checkUrlIsPublic(url: string): Promise<CustomAudioCheck> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: 'audio_url must be a valid http(s) URL.' };
  }
  try {
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true });
    const allPublic = addresses.length > 0 && addresses.every((a) => isPublicIp(a.address));
    if (!allPublic) {
      return {
        ok: false,
        error:
          'audio_url must use a public address — private/internal URLs are not allowed ' +
          '(e.g. 127.0.0.1, 10.x.x.x, 169.254.169.254). Use a publicly accessible audio file.',
      };
    }
  } catch {
    return { ok: false, error: 'audio_url host could not be resolved. Use a publicly accessible audio file.' };
  }
  return { ok: true };
}

async function headWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CUSTOM_AUDIO_HEAD_TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// audio_url is commonly a pre-signed URL (?X-Amz-Signature=..., ?token=...).
// The query string carries credentials, so it must never land in server logs;
// origin + path stay so the log remains useful for debugging.
function redactUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return '[unparseable url]';
  }
}

async function checkCustomAudioUrl(url: string): Promise<CustomAudioCheck> {
  let current = url;
  for (let hop = 0; hop <= SSRF_MAX_REDIRECTS; hop++) {
    const safety = await checkUrlIsPublic(current);
    if (!safety.ok) return safety;

    let head: Response;
    try {
      head = await headWithTimeout(current);
    } catch (err) {
      console.warn('[video-job] audio_url unreachable in HEAD check', { url: redactUrlForLog(current), err });
      return { ok: false, error: 'audio_url must point to an accessible audio file.' };
    }

    const location = head.headers.get('location');
    if (head.status >= 300 && head.status < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, error: 'audio_url has an invalid redirect target.' };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { ok: false, error: 'audio_url must redirect to an http(s) URL.' };
      }
      if (hop === SSRF_MAX_REDIRECTS) {
        return { ok: false, error: 'audio_url redirected too many times.' };
      }
      current = next.toString();
      continue;
    }

    if (!head.ok) {
      return { ok: false, error: `audio_url returned HTTP ${head.status} during verification.` };
    }
    const contentType = head.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!contentType.startsWith('audio/')) {
      return {
        ok: false,
        error: `audio_url must point to an audio file (content-type: ${contentType || 'unknown'}).`,
      };
    }
    const contentLength = Number(head.headers.get('content-length'));
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return { ok: false, error: 'audio_url must report a valid content-length.' };
    }
    if (contentLength > MAX_CUSTOM_AUDIO_BYTES) {
      return {
        ok: false,
        error: `audio_url exceeds the ${MAX_CUSTOM_AUDIO_BYTES / 1024 / 1024} MB size limit.`,
      };
    }
    return { ok: true };
  }
  return { ok: false, error: 'audio_url redirected too many times.' };
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.videoJob);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };

  const isMultipart = request.headers.get('content-type')?.includes('multipart/form-data') ?? false;
  if (isMultipart) return debugVideoJob(request, auth.userId);

  let requestBody: Record<string, unknown>;
  try {
    requestBody = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  if (
    requestBody.video_script_prompt === undefined &&
    typeof requestBody.scriptPrompt === 'string'
  ) {
    requestBody = {
      ...requestBody,
      video_script_prompt: requestBody.scriptPrompt,
    };
  }
  delete requestBody.scriptPrompt;

  // Custom per-video audio: overrides the persona's voice_audio_url.
  // Accepts audio_url (snake) or audioUrl (camel); it is not forwarded as
  // a loose field to the engine — it becomes voice_audio_url inside persona.
  if (
    requestBody.audio_url === undefined &&
    typeof requestBody.audioUrl === 'string'
  ) {
    requestBody = {
      ...requestBody,
      audio_url: requestBody.audioUrl,
    };
  }
  delete requestBody.audioUrl;

  // Per-video library image override: accepts image_id (snake) or imageId
  // (camel); resolved against the persona's image library in the persona
  // branch below. Deleted here so it never reaches the engine as a loose
  // field. An empty string or a non-string is a client bug: rejected with
  // 400 here, before the faceless/persona split, so faceless callers also
  // get a signal instead of a silent ignore. Both spellings with different
  // values is ambiguous: rejected instead of silently preferring one.
  if (
    requestBody.image_id !== undefined &&
    requestBody.imageId !== undefined &&
    requestBody.image_id !== requestBody.imageId
  ) {
    return NextResponse.json(
      { success: false, error: 'Provide either image_id or imageId, not both.' },
      { status: 400 },
    );
  }
  const rawImageId =
    requestBody.image_id === undefined ? requestBody.imageId : requestBody.image_id;
  if (
    rawImageId !== undefined &&
    (typeof rawImageId !== 'string' || rawImageId.trim().length === 0)
  ) {
    return NextResponse.json(
      { success: false, error: 'image_id must be a non-empty string.' },
      { status: 400 },
    );
  }
  delete requestBody.image_id;
  delete requestBody.imageId;

  let customAudioUrl: string | undefined;
  if (requestBody.audio_url !== undefined) {
    if (
      typeof requestBody.audio_url !== 'string' ||
      !isHttpUrl(requestBody.audio_url)
    ) {
      return NextResponse.json(
        { success: false, error: 'audio_url must be a valid http(s) URL.' },
        { status: 400 },
      );
    }
    customAudioUrl = requestBody.audio_url;
  }
  delete requestBody.audio_url;

  if (customAudioUrl !== undefined) {
    const audioCheck = await checkCustomAudioUrl(customAudioUrl);
    if (!audioCheck.ok) {
      return NextResponse.json(
        { success: false, error: audioCheck.error },
        { status: 400 },
      );
    }
  }

  // video_subject is required by the engine and must be a string. Rejecting a
  // non-string here turns an opaque upstream 502 ("Video service rejected the
  // job") into an actionable client error. null is exempt: it is treated as
  // absent and defaulted from the persona niche downstream.
  if (
    requestBody.video_subject !== undefined &&
    requestBody.video_subject !== null &&
    typeof requestBody.video_subject !== 'string'
  ) {
    return NextResponse.json(
      { success: false, error: 'video_subject must be a string when provided.' },
      { status: 400 },
    );
  }

  // The other engine-facing fields are type-guarded the same way. Without
  // this, a non-string video_script_prompt (or video_language / video_aspect /
  // video_quality, or a non-numeric paragraph_number) is forwarded verbatim
  // and comes back as the same opaque 502 — so reject it here with an
  // actionable error. null is exempt: it is treated as absent downstream.
  for (const field of [
    'video_language',
    'video_aspect',
    'video_script_prompt',
    'video_quality',
  ] as const) {
    const value = requestBody[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return NextResponse.json(
        { success: false, error: `${field} must be a string when provided.` },
        { status: 400 },
      );
    }
  }
  // paragraph_number is also range-checked: the engine rejects non-integer /
  // out-of-range values with the same opaque 502 (its schema is
  // paragraph_number: int 1..10 — mirrored by the debug flow's zod schema),
  // so fail fast here with an actionable error. null is exempt: it is
  // treated as absent downstream.
  const paragraphNumber = requestBody.paragraph_number;
  if (paragraphNumber !== undefined && paragraphNumber !== null) {
    if (
      typeof paragraphNumber !== 'number' ||
      !Number.isInteger(paragraphNumber) ||
      paragraphNumber < 1 ||
      paragraphNumber > 10
    ) {
      return NextResponse.json(
        { success: false, error: 'paragraph_number must be an integer between 1 and 10 when provided.' },
        { status: 400 },
      );
    }
  }

  // Value checks for the known engine-facing keys: the allowlist closed the
  // unknown-key class, but a mistyped *value* for a known key still travels
  // to the engine and comes back as the opaque 502 (engine 422s). Mirror the
  // debug flow / engine schema constraints here. null is exempt (absent);
  // '' and whitespace-only strings are exempt for the enum-like fields (the
  // payload assembly treats them as absent via hasNonEmptyString/trim).
  const videoAspect = requestBody.video_aspect;
  if (
    typeof videoAspect === 'string' &&
    videoAspect.trim().length > 0 &&
    !(VALID_VIDEO_ASPECTS as ReadonlyArray<string>).includes(videoAspect)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: `video_aspect must be one of ${VALID_VIDEO_ASPECTS.join(', ')} when provided.`,
      },
      { status: 400 },
    );
  }
  const videoQuality = requestBody.video_quality;
  if (
    typeof videoQuality === 'string' &&
    videoQuality.trim().length > 0 &&
    !(VALID_VIDEO_QUALITIES as ReadonlyArray<string>).includes(videoQuality)
  ) {
    return NextResponse.json(
      {
        success: false,
        error: `video_quality must be one of ${VALID_VIDEO_QUALITIES.join(', ')} when provided.`,
      },
      { status: 400 },
    );
  }
  // The cap applies to the raw length, but a whitespace-only string is not
  // a long subject — the payload assembly treats it as absent
  // (hasNonEmptyString), so the cap check must too.
  const videoScriptPrompt = requestBody.video_script_prompt;
  if (
    typeof videoScriptPrompt === 'string' &&
    videoScriptPrompt.trim().length > 0 &&
    videoScriptPrompt.length > 2000
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'video_script_prompt must be at most 2000 characters when provided.',
      },
      { status: 400 },
    );
  }
  const videoSubject = requestBody.video_subject;
  if (
    typeof videoSubject === 'string' &&
    videoSubject.trim().length > 0 &&
    videoSubject.length > 300
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'video_subject must be at most 300 characters when provided.',
      },
      { status: 400 },
    );
  }
  // video_language is unbounded end-to-end (the engine declares it Optional[str]
  // with no max and the DB column is text), so cap it at the API boundary:
  // 35 is the BCP 47 max tag length. Mirrored in the shared zod schema for
  // the debug flow and persona creation.
  const videoLanguage = requestBody.video_language;
  if (
    typeof videoLanguage === 'string' &&
    videoLanguage.trim().length > 0 &&
    videoLanguage.length > 35
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'video_language must be at most 35 characters when provided.',
      },
      { status: 400 },
    );
  }

  // personaId is optional: omitting it (undefined/null) selects the faceless
  // flow — no persona is loaded and the job runs on the documented defaults.
  // An empty string is still a client bug, not faceless.
  const personaId = requestBody.personaId;
  const faceless = personaId === undefined || personaId === null;
  if (!faceless && (typeof personaId !== 'string' || personaId.length === 0)) {
    return NextResponse.json(
      { success: false, error: 'personaId is required.' },
      { status: 400 },
    );
  }

  // Ownership enforced by .eq('user_id', ...): service client fetches the persona.
  const supabase: SupabaseClient = createSupabaseServiceClient();

  let jobPersona: JobPersona;
  let recordPersonaId: string | null;
  // Rotation-history write deferred until after the token gate: a request
  // rejected before the gate must not mark an image as used.
  let libraryHistory: {
    personaId: string;
    imageId: string;
  } | null = null;

  if (faceless) {
    // A persona-scoped API key names explicit personas; a faceless job uses
    // none of them, so scoped keys are rejected. Unrestricted keys and web
    // sessions keep full access.
    if (isScopedApiKey(auth)) {
      return NextResponse.json(
        {
          success: false,
          error: 'This API key is restricted to specific personas and cannot generate faceless videos.',
        },
        { status: 403 },
      );
    }

    // image_id is persona-scoped: on a faceless job there is no library it
    // could resolve against, so a provided id is a caller bug — reject
    // loudly instead of silently discarding it.
    if (rawImageId !== undefined) {
      return NextResponse.json(
        { success: false, error: 'image_id requires a personaId: faceless videos have no image library.' },
        { status: 400 },
      );
    }

    // voice_id is a route-level voice source like audio_url (consumed here,
    // never forwarded as a loose engine field): type-guard it the same way
    // so a mistyped value fails fast instead of surfacing as the opaque 502.
    const voiceId = requestBody.voice_id;
    if (
      voiceId !== undefined &&
      voiceId !== null &&
      (typeof voiceId !== 'string' || voiceId.trim().length === 0)
    ) {
      return NextResponse.json(
        { success: false, error: 'voice_id must be a non-empty string when provided.' },
        { status: 400 },
      );
    }
    const resolvedVoiceId =
      typeof voiceId === 'string' && voiceId.trim().length > 0 ? voiceId.trim() : undefined;
    // Consumed by the route: keep it out of the engine payload allowlist warn.
    delete requestBody.voice_id;

    // The engine requires exactly one of voice_id / voice_audio_url. With no
    // persona there is no stored voice, so one of the two request sources is
    // mandatory — fail fast with an actionable 400 before the token gate.
    if (!customAudioUrl && !resolvedVoiceId) {
      return NextResponse.json(
        {
          success: false,
          error: 'No voice available: faceless generation requires audio_url or voice_id.',
        },
        { status: 400 },
      );
    }

    // No persona niche to default the subject from: the request must carry
    // it. (Length is capped by the shared guard above.)
    const facelessSubject = requestBody.video_subject;
    if (typeof facelessSubject !== 'string' || facelessSubject.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'video_subject is required for faceless generation.' },
        { status: 400 },
      );
    }

    // Documented faceless defaults: fully faceless (mix 0), no photo, 'ok'
    // billing tier. Language/aspect/script fall back to the request values
    // via the payload builder, then to the engine defaults. The engine
    // rejects a job carrying both voice sources, so when both are provided
    // audio_url wins and voice_id is dropped — same precedence as the
    // persona flow below.
    jobPersona = {
      name: FACELESS_PERSONA_NAME,
      voice_id: customAudioUrl ? undefined : resolvedVoiceId,
      voice_audio_url: customAudioUrl,
      face_mix_percent: 0,
      face_quality: 'ok',
    };
    recordPersonaId = null;
  } else {
    if (!isPersonaAllowed(auth.personaIds, personaId)) {
      return NextResponse.json(
        { success: false, error: 'This API key does not have access to this persona.' },
        { status: 403 },
      );
    }

    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .select('id, name, photo_path, avatar_url, voice_id, voice_audio_path, language, video_aspect, script_prompt, paragraph_number, niche, face_mix_percent, face_quality, recent_image_ids')
      .eq('id', personaId)
      .eq('user_id', user.id)
      .single();

    if (personaError || !persona) {
      return NextResponse.json(
        { success: false, error: 'Persona not found.' },
        { status: 404 },
      );
    }

    // Persona-sourced values bypass the request guards above, but a legacy row
    // can carry an over-cap niche, an invalid video_aspect or an over-long
    // script_prompt straight into the engine (opaque 502). Validate the stored
    // values with the same caps and fail fast with an actionable 400 — before
    // the token gate, so nothing is charged. Whitespace-only strings count as
    // absent for the caps, matching the request guards and the payload
    // assembly's absent semantics.
    const personaNiche = persona.niche as string | null;
    if (
      typeof personaNiche === 'string' &&
    personaNiche.trim().length > 0 &&
    personaNiche.length > 300
    ) {
      return NextResponse.json(
        { success: false, error: 'persona niche must be at most 300 characters: update the persona.' },
        { status: 400 },
      );
    }
    const personaLanguage = persona.language as string | null;
    if (
      typeof personaLanguage === 'string' &&
    personaLanguage.trim().length > 0 &&
    personaLanguage.length > 35
    ) {
      return NextResponse.json(
        { success: false, error: 'persona language must be at most 35 characters: update the persona.' },
        { status: 400 },
      );
    }
    const personaVideoAspect = persona.video_aspect as string | null;
    if (
      typeof personaVideoAspect === 'string' &&
    personaVideoAspect.trim().length > 0 &&
    !(VALID_VIDEO_ASPECTS as ReadonlyArray<string>).includes(personaVideoAspect)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `persona video_aspect must be one of ${VALID_VIDEO_ASPECTS.join(', ')}: update the persona.`,
        },
        { status: 400 },
      );
    }
    const personaScriptPrompt = persona.script_prompt as string | null;
    if (
      typeof personaScriptPrompt === 'string' &&
    personaScriptPrompt.trim().length > 0 &&
    personaScriptPrompt.length > 2000
    ) {
      return NextResponse.json(
        { success: false, error: 'persona script_prompt must be at most 2000 characters: update the persona.' },
        { status: 400 },
      );
    }
    const personaParagraphNumber = persona.paragraph_number as number | null;
    if (
      personaParagraphNumber !== null &&
    personaParagraphNumber !== undefined &&
    (typeof personaParagraphNumber !== 'number' ||
      !Number.isInteger(personaParagraphNumber) ||
      personaParagraphNumber < 1 ||
      personaParagraphNumber > 10)
    ) {
      return NextResponse.json(
        { success: false, error: 'persona paragraph_number must be an integer between 1 and 10: update the persona.' },
        { status: 400 },
      );
    }
    // face_mix_percent is the last persona-sourced value reaching the engine
    // and the billing gate verbatim: buildJobPayload forwards any numeric value
    // with no range check. A corrupt/legacy row with 150 or -5 would opaque-502
    // at the engine and charge an unchecked mix.
    const personaFaceMix = persona.face_mix_percent as number | null;
    if (
      personaFaceMix !== null &&
    personaFaceMix !== undefined &&
    (typeof personaFaceMix !== 'number' ||
      !Number.isFinite(personaFaceMix) ||
      personaFaceMix < 0 ||
      personaFaceMix > 100)
    ) {
      return NextResponse.json(
        { success: false, error: 'persona face_mix_percent must be a number between 0 and 100: update the persona.' },
        { status: 400 },
      );
    }

    // Same persona shape as the debug flow: resolved fields + signed URLs.
    // Custom per-video audio overrides the persona voice. The engine requires
    // exactly one of voice_id / voice_audio_url, so voice_id is dropped when
    // custom audio is present (otherwise the engine rejects the job).
    // signedUrl() never throws: a signing failure resolves to undefined and is
    // classified by the voice guard below.
    const voiceAudioUrl =
    customAudioUrl ?? (await signedUrl(supabase, persona.voice_audio_path as string | null));

    // The engine requires exactly one of voice_id / voice_audio_url. When the
    // persona has no voice configured and no custom audio was provided, fail
    // fast with an actionable 400 instead of the opaque 502 — and before the
    // token gate below, so nothing is charged.
    if (!voiceAudioUrl && !persona.voice_id) {
    // signedUrl() swallows storage errors: a persona WITH voice_audio_path
    // whose signed URL could not be created must not get the misleading
    // "no voice configured" message — report what actually happened.
      if (persona.voice_audio_path) {
        return NextResponse.json(
          {
            success: false,
            error: 'Voice audio is configured for this persona but could not be loaded. Please try again.',
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        {
          success: false,
          error:
          'No voice available: the persona has no voice configured and no custom audio_url was provided.',
        },
        { status: 400 },
      );
    }

    // A persona that requires a face (face_mix_percent > 0) but whose
    // photo_path cannot be signed would forward photo_url: undefined and
    // opaque-502 at the engine. signedUrl() swallows storage errors, so
    // classify a failed signing like the voice path: actionable 503 before
    // the token gate. Faceless personas are untouched — for them a missing
    // photo is legitimate.
    const avatarUrl = persona.avatar_url as string | null;
    const photoPath = persona.photo_path as string | null;
    let photoUrl = avatarUrl ?? (await signedUrl(supabase, photoPath));

    // Persona image library: deterministic per-video selection (explicit
    // image_id override, then tag/description keyword match excluding
    // recently used images, then primary/first). The engine still receives
    // a single resolved photo URL, so no engine changes are needed.
    // Legacy personas (empty library) keep the behavior above untouched.
    // rawImageId is pre-validated above (non-empty, non-whitespace string
    // when defined); trimmed so ' abc123 ' doesn't 404 in the exact-match
    // lookup with a confusing "not found" error.
    const requestedImageId = typeof rawImageId === 'string' ? rawImageId.trim() : null;
    const librarySelection = await resolveVideoImage(
      supabase,
      personaId,
      auth.userId,
      (persona.recent_image_ids as string[] | null) ?? [],
      {
        topic: typeof requestBody.video_subject === 'string' ? requestBody.video_subject : null,
        niche: personaNiche,
        script: typeof persona.script_prompt === 'string' ? persona.script_prompt : null,
        imageId: requestedImageId,
      },
    );
    if (!librarySelection.ok) {
      return NextResponse.json(
        { success: false, error: librarySelection.error },
        { status: librarySelection.status },
      );
    }
    if (librarySelection.image) {
      const libraryUrl = await signedUrl(supabase, librarySelection.image.image_path);
      // The library image was explicitly resolved for this video: a signing
      // failure must not silently fall back to a different face. Fail loud
      // with 503, before the token gate, like the legacy photo path below.
      if (!libraryUrl) {
        return NextResponse.json(
          {
            success: false,
            error: 'The selected persona image could not be loaded. Please try again.',
          },
          { status: 503 },
        );
      }
      photoUrl = libraryUrl;
      // An explicit override is the caller's pinned choice, not a rotation
      // pick: it must not pollute the anti-repeat history.
      if (requestedImageId === null) {
        libraryHistory = {
          personaId,
          imageId: librarySelection.image.id,
        };
      }
    }
    const faceMix = persona.face_mix_percent as number | null;
    // A legacy persona with face_mix_percent: null is face-requiring by the
    // historical default the mix field was added on top of: an unsignable photo
    // would forward photo_url: undefined and opaque-502 at the engine. Only a
    // genuinely faceless persona (mix 0) may proceed without a photo.
    if (!photoUrl && photoPath && (faceMix === null || faceMix > 0)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Persona photo is configured for this persona but could not be loaded. Please try again.',
        },
        { status: 503 },
      );
    }

    jobPersona = {
      name: persona.name as string,
      photo_url: photoUrl,
      voice_id: voiceAudioUrl ? undefined : ((persona.voice_id as string | null) ?? undefined),
      voice_audio_url: voiceAudioUrl,
      language: persona.language as string | null,
      video_aspect: persona.video_aspect as string | null,
      script_prompt: persona.script_prompt as string | null,
      paragraph_number: persona.paragraph_number as number | null,
      niche: persona.niche as string | null,
      face_mix_percent: persona.face_mix_percent as number | null,
      face_quality: persona.face_quality as string | null,
    };
    recordPersonaId = personaId;
  }

  // The engine requires video_subject. If neither the request nor the persona
  // niche yields one, fail fast with an actionable 400 instead of the opaque
  // 502 — and before the token gate, so nothing is charged. (Faceless jobs
  // already carry a request subject from the branch above; this stays as the
  // shared fail-fast shape.)
  const jobPayload = buildJobPayload(jobPersona, requestBody);
  if (!hasNonEmptyString(jobPayload.video_subject)) {
    return NextResponse.json(
      {
        success: false,
        error: faceless
          ? 'video_subject is required for faceless generation.'
          : 'video_subject is required: provide video_subject in the request or set a niche on the persona.',
      },
      { status: 400 },
    );
  }

  const generationId = randomUUID();
  // The charge follows the payload actually sent, not the persona record: an
  // explicit request video_quality overrides the persona's face_quality for
  // what the engine runs, so billing the persona rate would let callers get
  // very-good output at the ok price. (lipsync has no price dimension.)
  const effectiveFaceQuality =
    jobPayload.video_quality === 'very-good'
      ? 'very_good'
      : jobPayload.video_quality === 'ok'
        ? 'ok'
        : jobPersona.face_quality === 'very_good'
          ? 'very_good'
          : 'ok';
  const gate = await gateGeneration({
    supabase,
    userId: user.id,
    generationId,
    faceMixPercent: jobPersona.face_mix_percent ?? 0,
    faceQuality: effectiveFaceQuality,
  });
  if (!gate.ok) return gate.response;

  // History is recorded only after the engine ACCEPTS the job (below): a
  // failed generation is refunded, and it must not consume one of the 3
  // anti-repeat slots — otherwise the retry rotates away from the
  // best-matching image even though no video was produced.

  // Snapshot the generation for the History page right after the token
  // gate: persona name/subject are denormalized so the row renders even if
  // the persona is later renamed or deleted.
  await recordGenerationStart({
    supabase,
    userId: user.id,
    generationId,
    personaId: recordPersonaId,
    personaName: jobPersona.name,
    videoSubject:
      typeof jobPayload.video_subject === 'string' ? jobPayload.video_subject : null,
  });

  const engineTask = await startEngineVideoTask(auth.userId, jobPayload);
  if (!engineTask.ok || !engineTask.taskId) {
    await refundFailedGeneration(supabase, user.id, generationId);
    // Classify the failure directly from the outcome shape instead of
    // parsing a message: rejected (upstream answered non-2xx), unavailable
    // (no upstream answer at all), or accepted without a usable task id.
    const errorCode = !engineTask.ok
      ? engineTask.upstreamStatus !== undefined ? 'engine_rejected' : 'engine_unavailable'
      : 'no_task_id';
    const failureMessage = !engineTask.ok
      ? engineTask.upstreamStatus !== undefined
        ? 'Video service rejected the job.'
        : 'Video service is unavailable.'
      : 'Video service returned no task ID.';
    await recordGenerationUpdate({
      supabase,
      generationId,
      status: 'failed',
      errorCode,
      errorMessage: failureMessage,
      tokensRefunded: true,
    });
    return engineTask.ok
      ? NextResponse.json({ success: false, error: 'Video service returned no task ID.' }, { status: 502 })
      : engineTask.response;
  }

  await attachGenerationTask(supabase, generationId, engineTask.taskId);
  await recordGenerationUpdate({
    supabase,
    generationId,
    status: 'running',
    engineTaskId: engineTask.taskId,
  });

  // The engine accepted the job: now the rotation pick is committed, so a
  // failed generation can never mark an image as used (see above).
  if (libraryHistory) {
    await recordRecentImageId(
      supabase,
      libraryHistory.personaId,
      libraryHistory.imageId,
    );
  }

  return NextResponse.json({ success: true, taskId: engineTask.taskId });
}

//---------------
// debugVideoJob — DEBUG branch of video-job: same validation, same
// payload builder and same gate as the normal flow; the only difference is
// that the persona comes from the form (in memory) and nothing is persisted.
// Also available in production (QA).
//---------------
async function debugVideoJob(request: Request, userId: string): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid multipart payload.' }, { status: 400 });
  }

  const parsed = parsePersonaForm(formData, 'debug');
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }
  const form = parsed.value;
  const v = form.values;

  // Virtual persona — same fields as the DB persona, but from the form.
  const jobPersona: JobPersona = {
    name: v.name ?? 'Debug persona',
    language: v.language,
    video_aspect: v.videoAspect,
    script_prompt: v.scriptPrompt,
    niche: v.niche,
    face_mix_percent: v.personaMode === 'faceless' ? 0 : v.faceMixPercent ?? 0,
    face_quality: v.faceQuality ?? 'ok',
  };

  // House voice goes inline in the persona in every mode (same as the normal flow).
  jobPersona.voice_id = v.voiceId ?? undefined;

  // The engine requires exactly one of voice_id / voice_audio_url and the
  // debug flow has no custom-audio input — so without a house voice the job
  // would surface as the opaque 502. Same validation as the normal flow:
  // fail fast with an actionable 400 before the token gate — and before the
  // engine photo upload below, so a doomed request does not consume an
  // upstream upload per attempt.
  if (!jobPersona.voice_id) {
    return NextResponse.json(
      {
        success: false,
        error: 'This persona has no voice configured. Pick a house voice to generate a debug video.',
      },
      { status: 400 },
    );
  }

  if (v.personaMode === 'persona') {
    const avatarUrl = v.avatarUrl ?? undefined;
    let photoUrl = avatarUrl;
    if (form.photo && form.photoExtension) {
      // TEMPORARY storage in the engine (TTL 1h) — nothing goes to Supabase.
      const tempUrl = await uploadEngineTempAsset(userId, form.photo, form.photoExtension);
      if (!tempUrl) {
        return NextResponse.json({ success: false, error: 'Failed to upload debug photo.' }, { status: 502 });
      }
      photoUrl = tempUrl;
    }
    jobPersona.photo_url = photoUrl;
  }

  // Gate shared with the real flow — token charging.
  const generationId = randomUUID();
  const gate = await gateGeneration({
    supabase: createSupabaseServiceClient(),
    userId,
    generationId,
    faceMixPercent: jobPersona.face_mix_percent ?? 0,
    faceQuality: jobPersona.face_quality === 'very_good' ? 'very_good' : 'ok',
    // Intentionally billed from the persona here: the debug form has no
    // video_quality override, so the payload quality is always derived from
    // it. If a debug override is ever added, derive an effectiveFaceQuality
    // from the built payload like the normal flow above.
  });
  if (!gate.ok) return gate.response;

  await recordGenerationStart({
    supabase: createSupabaseServiceClient(),
    userId,
    generationId,
    personaId: null,
    personaName: jobPersona.name,
    videoSubject: typeof v.videoSubject === 'string' ? v.videoSubject : null,
  });

  const engineTask = await startEngineVideoTask(userId, buildJobPayload(jobPersona, { video_subject: v.videoSubject }));
  if (!engineTask.ok || !engineTask.taskId) {
    await refundFailedGeneration(createSupabaseServiceClient(), userId, generationId);
    const errorCode = !engineTask.ok
      ? engineTask.upstreamStatus !== undefined ? 'engine_rejected' : 'engine_unavailable'
      : 'no_task_id';
    const failureMessage = !engineTask.ok
      ? engineTask.upstreamStatus !== undefined
        ? 'Video service rejected the job.'
        : 'Video service is unavailable.'
      : 'Video service returned no task ID.';
    await recordGenerationUpdate({
      supabase: createSupabaseServiceClient(),
      generationId,
      status: 'failed',
      errorCode,
      errorMessage: failureMessage,
      tokensRefunded: true,
    });
    return engineTask.ok
      ? NextResponse.json({ success: false, error: 'Video service returned no task ID.' }, { status: 502 })
      : engineTask.response;
  }

  await attachGenerationTask(createSupabaseServiceClient(), generationId, engineTask.taskId);
  await recordGenerationUpdate({
    supabase: createSupabaseServiceClient(),
    generationId,
    status: 'running',
    engineTaskId: engineTask.taskId,
  });

  const task = normalizeDebugTaskResponse(engineTask.body);
  if (!task) {
    await refundFailedGeneration(createSupabaseServiceClient(), userId, generationId);
    const failureMessage = 'Engine returned an invalid task response.';
    await recordGenerationUpdate({
      supabase: createSupabaseServiceClient(),
      generationId,
      status: 'failed',
      errorCode: 'invalid_task_response',
      errorMessage: failureMessage,
      tokensRefunded: true,
    });
    return NextResponse.json(
      { success: false, error: failureMessage, debug: { upstreamStatus: 200, upstreamBody: engineTask.body } },
      { status: 502 },
    );
  }
  return NextResponse.json({
    success: true,
    taskId: task.taskId,
    state: task.state,
    progress: task.progress,
    tokensSpent: gate.cost,
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function signedUrl(
  supabase: SupabaseClient,
  path: string | null,
): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const { data, error } = await supabase.storage
      .from('personas')
      .createSignedUrl(path, SIGNED_URL_EXPIRES_SECONDS);
    if (error) {
      // The common supabase-js failure shape resolves { data: null, error }
      // instead of throwing — log it so the incident stays diagnosable.
      // Callers classify an undefined URL via their own guards.
      console.warn('[video-job] failed to sign storage URL', error);
    }
    return data?.signedUrl;
  } catch (err) {
    // Never propagate: callers classify an undefined URL via their own
    // guards, but the incident must stay diagnosable — do not suppress it.
    console.warn('[video-job] failed to sign storage URL', err);
    return undefined;
  }
}
