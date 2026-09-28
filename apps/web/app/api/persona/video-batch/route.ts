import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey, type PersonaScopeContext } from '@/lib/api-keys';
import {
  recordGenerationStart,
  recordGenerationUpdate,
  startEngineVideoBatch,
  uploadEngineTempAsset,
} from '@/lib/generation/video-generation';
import { parsePersonaForm, VALID_VIDEO_ASPECTS } from '@/lib/persona-schema';
import { IMAGE_BUCKET, recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { MAX_BATCH_TOPICS } from '@/lib/video-batch';
import { logger } from '@/lib/logger';

//---------------
// POST /api/persona/video-batch — one request, N persona videos (1..10).
//
// Proxies the engine's POST /api/v1/persona-videos/batch: the engine
// validates the items, bills all N videos upfront (fail-fast 400
// INSUFFICIENT_TOKENS — nothing created, nothing charged), and runs the
// tasks sequentially on the warm container. Billing stays engine-side, so
// this route never gateGenerations — that would double-charge.
//
// Two caller shapes, mirroring /api/persona/video-job:
// - JSON: { personaId?, topics[], webhookUrl?, voiceId?, imageId? } — a
//   stored persona, or faceless defaults when personaId is omitted.
// - multipart: the debug persona form + a `topics` JSON field — a virtual
//   persona built from the form, nothing persisted (persona page).
//
// Each accepted video gets its own video_generations history row and its
// own task id; per-video progress streams at
// /api/persona/video-events/:taskId. Terminal history side effects run
// through /api/persona/video-status/:taskId, which understands
// engine-billed (batch) generations and skips the web-side refund for them
// (the engine owns that charge).
//
// V1 limits: no custom audio_url for batch (faceless needs voiceId); the
// debug form's scriptPrompt does not apply — the engine builds each video's
// script prompt from the persona fields, same as single /persona-videos.
//---------------

const SIGNED_URL_EXPIRES_SECONDS = 60 * 60; // a batch can take a while

const MAX_TOPIC_LENGTH = 300;

//---------------
// parseTopics — shared topics validation for both caller shapes.
// Trims lines, drops empties; 1..10 topics, each 1..300 chars.
//---------------
export function parseTopics(
  value: unknown,
): { ok: true; topics: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'topics must be an array of 1 to 10 video topics.' };
  }
  const topics: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return { ok: false, error: 'Each topic must be a string.' };
    }
    const topic = item.trim();
    if (topic.length === 0) {
      return { ok: false, error: 'Topics must not be empty.' };
    }
    if (topic.length > MAX_TOPIC_LENGTH) {
      return { ok: false, error: `Each topic must be at most ${MAX_TOPIC_LENGTH} characters.` };
    }
    topics.push(topic);
  }
  if (topics.length === 0) {
    return { ok: false, error: 'Provide at least one video topic.' };
  }
  if (topics.length > MAX_BATCH_TOPICS) {
    return { ok: false, error: `A batch holds at most ${MAX_BATCH_TOPICS} videos.` };
  }
  return { ok: true, topics };
}

//---------------
// parseWebhookUrl — optional callback URL; empty counts as absent.
// Mirrors the engine's check (http(s) scheme only), failing fast here so a
// bad URL never reaches the engine as an opaque 502.
//---------------
export function parseWebhookUrl(
  value: unknown,
): { ok: true; url?: string } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, error: 'webhookUrl must be a valid http(s) URL.' };
  }
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    return { ok: false, error: 'webhookUrl must be a valid http(s) URL.' };
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, error: 'webhookUrl must be a valid http(s) URL.' };
  }
  return { ok: true, url: value };
}

//---------------
// signedUrl — storage signing that never throws (same contract as the
// video-job route's local helper): a signing failure resolves to undefined
// and the caller classifies it with its own guard.
//---------------
async function signedUrl(
  supabase: SupabaseClient,
  path: string | null,
): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_EXPIRES_SECONDS);
    if (error) {
      logger.warn('[video-batch] failed to sign storage URL', error as unknown as Record<string, unknown>);
    }
    return data?.signedUrl;
  } catch (err) {
    logger.warn('[video-batch] failed to sign storage URL', err as Record<string, unknown>);
    return undefined;
  }
}

interface BatchEnginePersona {
  id?: string;
  name: string;
  language?: string;
  niche?: string;
  photo_url?: string;
  voice_id?: string;
  voice_audio_url?: string;
}

interface ResolvedBatchRequest {
  enginePersona: BatchEnginePersona;
  topics: string[];
  faceMixPercent: number;
  faceQuality: 'ok' | 'very_good';
  webhookUrl?: string;
  personaName: string;
  recordPersonaId: string | null;
  // Library image resolved for the whole batch (the engine batch contract
  // carries one persona/photo for all items); the id feeds the anti-repeat
  // rotation history after the engine accepts.
  libraryImageId: string | null;
  pinnedImage: boolean;
}

type AuthContext = PersonaScopeContext & { userId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

//---------------
// pickDualParam — ambiguous dual-spelling params (snake_case + camelCase)
// are 400 when both are present with different values, never silent
// precedence. Identical values are accepted.
//---------------
function pickDualParam(
  body: Record<string, unknown>,
  snake: string,
  camel: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const snakeValue = body[snake];
  const camelValue = body[camel];
  if (snakeValue !== undefined && camelValue !== undefined && snakeValue !== camelValue) {
    return { ok: false, error: `Provide either ${snake} or ${camel}, not both.` };
  }
  return { ok: true, value: snakeValue === undefined ? camelValue : snakeValue };
}

function isInsufficientBody(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const message = body.message;
  return typeof message === 'string' && message.includes('INSUFFICIENT');
}

//---------------
// resolveJsonBatch — the JSON caller shape: a stored persona (or faceless
// defaults). Mirrors the /api/persona/video-job JSON branch guards: the
// same fail-fast 400s/403s/404/503s, before the engine bills anything.
// The image library is resolved per topic so batch videos keep the
// deterministic per-video selection (accumulating picks so topics in one
// batch don't repeat the same image).
//---------------
async function resolveJsonBatch(
  body: Record<string, unknown>,
  auth: AuthContext,
  userId: string,
): Promise<{ ok: true; resolved: ResolvedBatchRequest } | { ok: false; response: NextResponse }> {
  const topics = parseTopics(body.topics);
  if (!topics.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: topics.error }, { status: 400 }) };
  }
  const webhookParam = pickDualParam(body, 'webhook_url', 'webhookUrl');
  if (!webhookParam.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: webhookParam.error }, { status: 400 }) };
  }
  const webhook = parseWebhookUrl(webhookParam.value);
  if (!webhook.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: webhook.error }, { status: 400 }) };
  }

  const personaId = body.personaId;
  const faceless = personaId === undefined || personaId === null;
  if (!faceless && (typeof personaId !== 'string' || personaId.length === 0)) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'personaId is required.' }, { status: 400 }) };
  }

  const supabase: SupabaseClient = createSupabaseServiceClient();

  // image_id is persona-scoped: without a persona there is no library it
  // could resolve against — reject loudly instead of silently discarding.
  const imageParam = pickDualParam(body, 'image_id', 'imageId');
  if (!imageParam.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: imageParam.error }, { status: 400 }) };
  }
  const rawImageId = imageParam.value;
  if (rawImageId !== undefined && (typeof rawImageId !== 'string' || rawImageId.trim().length === 0)) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'image_id must be a non-empty string.' }, { status: 400 }) };
  }
  const requestedImageId = typeof rawImageId === 'string' ? rawImageId.trim() : null;

  if (faceless) {
    if (isScopedApiKey(auth)) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'This API key is restricted to specific personas and cannot generate faceless videos.' },
          { status: 403 },
        ),
      };
    }
    if (requestedImageId !== null) {
      return { ok: false, response: NextResponse.json({ success: false, error: 'image_id requires a personaId: faceless videos have no image library.' }, { status: 400 }) };
    }
    const voiceParam = pickDualParam(body, 'voice_id', 'voiceId');
    if (!voiceParam.ok) {
      return { ok: false, response: NextResponse.json({ success: false, error: voiceParam.error }, { status: 400 }) };
    }
    const voiceId = voiceParam.value;
    if (voiceId !== undefined && voiceId !== null && (typeof voiceId !== 'string' || voiceId.trim().length === 0)) {
      return { ok: false, response: NextResponse.json({ success: false, error: 'voice_id must be a non-empty string when provided.' }, { status: 400 }) };
    }
    const resolvedVoiceId = typeof voiceId === 'string' && voiceId.trim().length > 0 ? voiceId.trim() : undefined;
    // V1: batch faceless runs on a house voice only — no custom audio_url
    // (the SSRF-checked HEAD flow lives in the single-video route).
    if (!resolvedVoiceId) {
      return {
        ok: false,
        response: NextResponse.json({ success: false, error: 'No voice available: batch faceless generation requires voice_id.' }, { status: 400 }),
      };
    }
    return {
      ok: true,
      resolved: {
        enginePersona: { name: 'Faceless generation', voice_id: resolvedVoiceId, language: 'pt-BR' },
        topics: topics.topics,
        faceMixPercent: 0,
        faceQuality: 'ok',
        webhookUrl: webhook.url,
        personaName: 'Faceless generation',
        recordPersonaId: null,
        libraryImageId: null,
        pinnedImage: false,
      },
    };
  }

  const id = personaId as string;
  if (!isPersonaAllowed(auth.personaIds, id)) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'This API key does not have access to this persona.' }, { status: 403 }) };
  }

  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select('id, name, photo_path, avatar_url, voice_id, voice_audio_path, language, video_aspect, script_prompt, paragraph_number, niche, face_mix_percent, face_quality, recent_image_ids')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (personaError) {
    // PGRST116 = .single() matched zero rows: the persona is missing or
    // belongs to someone else. Any other error is a real DB failure — a
    // bare 404 would tell the client to stop retrying and leave zero
    // diagnostic trail, so log it and report 500.
    if (personaError.code === 'PGRST116') {
      return { ok: false, response: NextResponse.json({ success: false, error: 'Persona not found.' }, { status: 404 }) };
    }
    logger.error('[video-batch] persona lookup failed', personaError, { personaId: id });
    return { ok: false, response: NextResponse.json({ success: false, error: 'Failed to load persona.' }, { status: 500 }) };
  }
  if (!persona) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'Persona not found.' }, { status: 404 }) };
  }

  // Stored-value caps — same as the single-video route: a legacy row must
  // not reach the engine (opaque 502) after the batch is billed.
  const personaNiche = persona.niche as string | null;
  if (typeof personaNiche === 'string' && personaNiche.trim().length > 0 && personaNiche.length > 300) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'persona niche must be at most 300 characters: update the persona.' }, { status: 400 }) };
  }
  const personaLanguage = persona.language as string | null;
  if (typeof personaLanguage === 'string' && personaLanguage.trim().length > 0 && personaLanguage.length > 35) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'persona language must be at most 35 characters: update the persona.' }, { status: 400 }) };
  }
  const personaVideoAspect = persona.video_aspect as string | null;
  if (
    typeof personaVideoAspect === 'string' &&
    personaVideoAspect.trim().length > 0 &&
    !(VALID_VIDEO_ASPECTS as ReadonlyArray<string>).includes(personaVideoAspect)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: `persona video_aspect must be one of ${VALID_VIDEO_ASPECTS.join(', ')}: update the persona.` },
        { status: 400 },
      ),
    };
  }
  const personaFaceMix = persona.face_mix_percent as number | null;
  const personaParagraphNumber = persona.paragraph_number as number | null;
  if (
    personaParagraphNumber !== null &&
    personaParagraphNumber !== undefined &&
    (typeof personaParagraphNumber !== 'number' ||
      !Number.isInteger(personaParagraphNumber) ||
      personaParagraphNumber < 1 ||
      personaParagraphNumber > 10)
  ) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'persona paragraph_number must be an integer between 1 and 10: update the persona.' }, { status: 400 }) };
  }
  if (
    personaFaceMix !== null &&
    personaFaceMix !== undefined &&
    (typeof personaFaceMix !== 'number' || !Number.isFinite(personaFaceMix) || personaFaceMix < 0 || personaFaceMix > 100)
  ) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'persona face_mix_percent must be a number between 0 and 100: update the persona.' }, { status: 400 }) };
  }

  const voiceAudioUrl = await signedUrl(supabase, persona.voice_audio_path as string | null);
  if (!voiceAudioUrl && !persona.voice_id) {
    if (persona.voice_audio_path) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Voice audio is configured for this persona but could not be loaded. Please try again.' },
          { status: 503 },
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'No voice available: the persona has no voice configured.' },
        { status: 400 },
      ),
    };
  }

  // One library resolution per batch: the engine batch contract carries a
  // single persona (one photo) for all items, so per-video image variety
  // is a follow-up. The first topic anchors the deterministic selection.
  const rawRecentIds: unknown = persona.recent_image_ids;
  const recentIds: string[] = Array.isArray(rawRecentIds)
    ? rawRecentIds.filter((rid): rid is string => typeof rid === 'string')
    : [];
  const firstTopic = topics.topics[0] as string;
  const selection = await resolveVideoImage(supabase, id, userId, recentIds, {
    topic: firstTopic,
    niche: personaNiche,
    script: typeof persona.script_prompt === 'string' ? persona.script_prompt : null,
    imageId: requestedImageId,
  });
  if (!selection.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: selection.error }, { status: selection.status }) };
  }
  let libraryImageId: string | null = null;
  let photoUrl: string | null = null;
  if (selection.image) {
    const libraryUrl = await signedUrl(supabase, selection.image.image_path);
    // The library image was explicitly resolved for this batch: a signing
    // failure must not silently fall back to a different face. Fail loud
    // with 503, before the engine bills, like the single-video route.
    if (!libraryUrl) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'The selected persona image could not be loaded. Please try again.' },
          { status: 503 },
        ),
      };
    }
    photoUrl = libraryUrl;
    libraryImageId = selection.image.id;
  } else {
    // No library image: avatar, then the legacy photo_path (signed lazily,
    // like the single-video route — a library-backed batch must not pay a
    // signing round-trip for a stale photo_path).
    const avatarUrl = persona.avatar_url as string | null;
    photoUrl = avatarUrl ?? (await signedUrl(supabase, persona.photo_path as string | null)) ?? null;
  }

  // A face-requiring persona (legacy null counts as face-requiring, like
  // the single-video route) with an unsignable photo would opaque-502 at
  // the engine after billing — fail loud with 503 instead.
  if (!photoUrl && (personaFaceMix === null || personaFaceMix > 0)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Persona photo is configured for this persona but could not be loaded. Please try again.' },
        { status: 503 },
      ),
    };
  }

  const faceMix = personaFaceMix ?? 0;
  const faceQuality = persona.face_quality === 'very_good' ? 'very_good' : 'ok';
  return {
    ok: true,
    resolved: {
      enginePersona: {
        id,
        name: persona.name as string,
        language: typeof personaLanguage === 'string' && personaLanguage.trim().length > 0 ? personaLanguage : undefined,
        niche: typeof personaNiche === 'string' && personaNiche.trim().length > 0 ? personaNiche : undefined,
        // Exactly one visual: the engine rejects photo+avatar together.
        photo_url: photoUrl ?? undefined,
        voice_id: voiceAudioUrl ? undefined : ((persona.voice_id as string | null) ?? undefined),
        voice_audio_url: voiceAudioUrl,
      },
      topics: topics.topics,
      faceMixPercent: faceMix,
      faceQuality,
      webhookUrl: webhook.url,
      personaName: persona.name as string,
      recordPersonaId: id,
      libraryImageId,
      pinnedImage: requestedImageId !== null,
    },
  };
}

//---------------
// resolveDebugBatch — the multipart caller shape: the debug persona form
// plus a `topics` JSON field. Builds the virtual persona exactly like the
// debug branch of /api/persona/video-job (same voice guard, same temp
// photo upload), nothing persisted.
//---------------
async function resolveDebugBatch(
  formData: FormData,
  userId: string,
): Promise<{ ok: true; resolved: ResolvedBatchRequest } | { ok: false; response: NextResponse }> {
  // image_id is persona-scoped: the debug flow builds an in-memory persona
  // with no saved image library — reject loudly like the debug video-job.
  // A conflicting dual spelling is its own 400, never silent precedence.
  if (formData.has('image_id') && formData.has('imageId')) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Provide either image_id or imageId, not both.' },
        { status: 400 },
      ),
    };
  }
  if (formData.has('image_id') || formData.has('imageId')) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'image_id requires a saved persona: debug videos have no image library.' },
        { status: 400 },
      ),
    };
  }

  let rawTopics: unknown;
  try {
    const field = formData.get('topics');
    rawTopics = typeof field === 'string' ? JSON.parse(field) : field;
  } catch {
    return { ok: false, response: NextResponse.json({ success: false, error: 'topics must be a JSON array of 1 to 10 video topics.' }, { status: 400 }) };
  }
  const topics = parseTopics(rawTopics);
  if (!topics.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: topics.error }, { status: 400 }) };
  }
  const webhookSnake = formData.get('webhook_url');
  const webhookCamel = formData.get('webhookUrl');
  if (
    typeof webhookSnake === 'string' &&
    typeof webhookCamel === 'string' &&
    webhookSnake !== webhookCamel
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Provide either webhook_url or webhookUrl, not both.' },
        { status: 400 },
      ),
    };
  }
  const webhook = parseWebhookUrl(webhookSnake ?? webhookCamel);
  if (!webhook.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: webhook.error }, { status: 400 }) };
  }

  const parsed = parsePersonaForm(formData, 'debug');
  if (!parsed.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: parsed.error }, { status: 400 }) };
  }
  const form = parsed.value;
  const v = form.values;

  const faceMixPercent = v.personaMode === 'faceless' ? 0 : (v.faceMixPercent ?? 0);
  const voiceId = v.voiceId ?? undefined;
  // The engine requires exactly one of voice_id / voice_audio_url and the
  // debug flow has no custom-audio input — same guard as debug video-job.
  if (!voiceId) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'This persona has no voice configured. Pick a house voice to generate debug videos.' },
        { status: 400 },
      ),
    };
  }

  let photoUrl: string | undefined;
  if (v.personaMode === 'persona') {
    photoUrl = v.avatarUrl ?? undefined;
    if (form.photo && form.photoExtension) {
      // TEMPORARY storage in the engine (TTL 1h) — nothing goes to Supabase.
      const tempUrl = await uploadEngineTempAsset(userId, form.photo, form.photoExtension);
      if (!tempUrl) {
        return { ok: false, response: NextResponse.json({ success: false, error: 'Failed to upload debug photo.' }, { status: 502 }) };
      }
      photoUrl = tempUrl;
    }
  }

  return {
    ok: true,
    resolved: {
      enginePersona: {
        name: v.name ?? 'Debug persona',
        language: v.language ?? undefined,
        niche: v.niche ?? undefined,
        photo_url: photoUrl,
        voice_id: voiceId,
      },
      topics: topics.topics,
      faceMixPercent,
      faceQuality: v.faceQuality === 'very_good' ? 'very_good' : 'ok',
      webhookUrl: webhook.url,
      personaName: v.name ?? 'Debug persona',
      recordPersonaId: null,
      libraryImageId: null,
      pinnedImage: false,
    },
  };
}

//---------------
// finalizeBatch — engine call + per-video history rows + response.
// Runs only after every validation above passed; the engine bills the N
// videos here (fail-fast INSUFFICIENT_TOKENS → 402 so the client opens the
// upgrade dialog, same as the token gate's 402).
//---------------
async function finalizeBatch(
  supabase: SupabaseClient,
  userId: string,
  resolved: ResolvedBatchRequest,
): Promise<NextResponse> {
  const enginePayload: Record<string, unknown> = {
    persona: resolved.enginePersona,
    items: resolved.topics.map((topic) => ({ topic })),
    face_mix_percent: resolved.faceMixPercent,
    face_quality: resolved.faceQuality,
  };
  if (resolved.webhookUrl !== undefined) {
    enginePayload.webhook_url = resolved.webhookUrl;
  }

  const engineBatch = await startEngineVideoBatch(userId, enginePayload);
  if (!engineBatch.ok || !engineBatch.taskIds || engineBatch.taskIds.length !== resolved.topics.length) {
    if (!engineBatch.ok && engineBatch.upstreamStatus === 400 && isInsufficientBody(engineBatch.upstreamBody)) {
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient tokens for ${resolved.topics.length} videos.`,
          code: 'INSUFFICIENT',
        },
        { status: 402 },
      );
    }
    logger.error(
      '[video-batch] engine did not return the expected task ids',
      engineBatch.ok ? undefined : engineBatch.upstreamBody,
      { expected: resolved.topics.length },
    );
    return engineBatch.ok
      ? NextResponse.json({ success: false, error: 'Video service returned no task IDs.' }, { status: 502 })
      : engineBatch.response;
  }

  // History is recorded only after the engine ACCEPTS the batch (202): one
  // row per video, each carrying its engine task id so the terminal flow on
  // /api/persona/video-status/:taskId advances them.
  const taskIds = engineBatch.taskIds;
  for (let index = 0; index < taskIds.length; index++) {
    const generationId = randomUUID();
    const taskId = taskIds[index] as string;
    await recordGenerationStart({
      supabase,
      userId,
      generationId,
      personaId: resolved.recordPersonaId,
      personaName: resolved.personaName,
      videoSubject: resolved.topics[index] as string,
    });
    await recordGenerationUpdate({
      supabase,
      generationId,
      status: 'running',
      engineTaskId: taskId,
    });
  }

  // Rotation pick committed only now: a rejected batch must not mark the
  // image as used. An explicit image_id override is the caller's pinned
  // choice, not a rotation pick — it stays out of the history.
  if (resolved.libraryImageId !== null && !resolved.pinnedImage && resolved.recordPersonaId !== null) {
    await recordRecentImageId(supabase, resolved.recordPersonaId, resolved.libraryImageId, userId);
  }

  return NextResponse.json({ success: true, taskIds });
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.videoJob);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const isMultipart = request.headers.get('content-type')?.includes('multipart/form-data') ?? false;
  if (isMultipart) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid multipart payload.' }, { status: 400 });
    }
    const resolved = await resolveDebugBatch(formData, auth.userId);
    if (!resolved.ok) return resolved.response;
    return finalizeBatch(createSupabaseServiceClient(), auth.userId, resolved.resolved);
  }

  let requestBody: Record<string, unknown>;
  try {
    requestBody = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const resolved = await resolveJsonBatch(requestBody, auth, auth.userId);
  if (!resolved.ok) return resolved.response;
  return finalizeBatch(createSupabaseServiceClient(), auth.userId, resolved.resolved);
}
