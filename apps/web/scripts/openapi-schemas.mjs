// Hand-written request/response schemas for generate-openapi.mjs, keyed by
// "METHOD /api/path". Each entry mirrors the route's own validation (cited in
// the comment); endpoints without an entry keep the generic responses.
import { experimentLinkSchema, metricsOperationSchemas } from './openapi-metrics-schemas.mjs';

const object = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});
const str = { type: 'string' };
const strArray = { type: 'array', items: str };
const int = { type: 'integer' };
// The same schema for each named field, e.g. fields(int, ['a', 'b']).
const fields = (schema, names) => Object.fromEntries(names.map((name) => [name, schema]));

export const componentSchemas = {
  Error: object(
    {
      success: { type: 'boolean', enum: [false] },
      error: str,
      code: { type: 'string', description: 'Stable error code.' },
      field: { type: 'string', description: 'Offending request field, when known.' },
      errors: {
        type: 'array',
        description:
          'Up to 20 validation problems (generate-and-schedule 400 only). The first entry matches the top-level code, error and field.',
        items: object(
          {
            code: str,
            message: str,
            field: { type: 'string', description: 'Offending request field, when known.' },
          },
          ['code', 'message'],
        ),
      },
    },
    ['success', 'error'],
  ),
  Segment: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'text'],
    properties: {
      kind: { type: 'string', enum: ['hook', 'body', 'cta'] },
      text: str,
      media: {
        type: 'object',
        additionalProperties: false,
        properties: { mediaId: str, url: str },
      },
      terms: strArray,
    },
  },
};

const segmentsBody = object(
  {
    segments: {
      type: 'array',
      description: 'Hook first, body, CTA last. 60-200 words in total.',
      items: { $ref: '#/components/schemas/Segment' },
    },
  },
  ['segments'],
);

const success = (properties) => object({ success: { type: 'boolean', enum: [true] }, ...properties }, ['success']);

const slotResult = object({
  slotId: str,
  slotAt: { type: 'string', format: 'date-time' },
  title: str,
  taskId: { type: 'string', nullable: true },
  status: str,
});

// apps/web/app/api/videos/generate-and-schedule/route.ts (BodySchema)
const generateBody = object(
  {
    personaId: { type: 'string', description: 'Optional: a faceless post needs no persona.' },
    title: { type: 'string', description: 'Slot label.' },
    publishing: object(
      {
        mode: { type: 'string', enum: ['scheduled', 'asap'], default: 'scheduled' },
        providers: { ...strArray, maxItems: 20 },
        accounts: { type: 'object', additionalProperties: strArray },
        // OpenAPI 3.0 cannot express "required unless mode is asap" (the route 400s).
        schedule: {
          ...object({ startAt: str, times: strArray, timezone: str }, ['startAt', 'times', 'timezone']),
          description: "Required when mode is 'scheduled' (the default); forbidden when mode is 'asap'.",
        },
        timezone: { type: 'string', description: 'asap mode only (IANA zone).' },
      },
      ['providers'],
    ),
    options: object({
      faceless: { type: 'boolean' },
      facelessMaterial: { type: 'string', enum: ['broll', 'svg'] },
      fullLipsync: { type: 'boolean', description: 'Persona talks for the whole video, not only the hook. Not with faceless.' },
      audioUrl: str,
      imageId: str,
      segments: {
        type: 'array',
        maxItems: 12,
        items: { $ref: '#/components/schemas/Segment' },
      },
      webhookUrl: str,
      voiceId: str,
      videoAspect: { type: 'string', enum: ['9:16', '16:9'] },
      videoLayout: { type: 'string', enum: ['standard', 'react'] },
      paragraphNumber: { type: 'integer', minimum: 1, maximum: 10 },
      language: str,
      niche: str,
    }, ['segments']), // segments-validation.ts: 400 without them
    experiment: experimentLinkSchema,
    idempotencyKey: str,
  },
  ['title', 'publishing', 'options'],
);


const personaFields = {
  name: { type: 'string', description: 'Required on create.' },
  avatarUrl: { type: 'string', description: 'Exactly one of photo or avatarUrl on create.' },
  photo: { type: 'string', format: 'binary', description: 'PNG, JPEG or WebP.' },
  voiceId: str,
  language: { type: 'string', maxLength: 35 },
  videoAspect: { type: 'string', enum: ['9:16', '16:9', '1:1'] },
  videoLayout: { type: 'string', enum: ['standard', 'react'] },
  scriptPrompt: { type: 'string', maxLength: 2000 },
  ctaText: { type: 'string', maxLength: 200 },
  niche: { type: 'string', maxLength: 300 },
  paragraphNumber: { type: 'integer', minimum: 1, maximum: 10 },
  faceQuality: { type: 'string', enum: ['ok', 'very_good'] },
};
const multipart = 'multipart/form-data';
const personaIdQuery = [{ name: 'personaId', required: true }];

const personaSummary = object({
  ...fields(str, ['id', 'name']),
  createdAt: { type: 'string', format: 'date-time' },
  ...fields(str, ['avatarUrl', 'photoUrl', 'libraryUrl', 'voiceId', 'voiceAudioUrl', 'language']),
  ...fields(str, ['videoAspect', 'videoLayout', 'scriptPrompt', 'ctaText']),
  paragraphNumber: int,
  ...fields(str, ['niche', 'faceQuality']),
});

const scheduleSummary = object({
  id: str,
  persona_id: { type: 'string', nullable: true },
  providers: strArray,
  ...fields(strArray, ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads'].map((p) => `${p}_account_ids`)),
  days_of_week: { type: 'array', items: int },
  ...fields(int, ['start_hour', 'end_hour', 'posts_per_day']),
  timezone: str,
  active: { type: 'boolean' },
  created_at: { type: 'string', format: 'date-time' },
  publish_mode: str,
});

const anyObject = { type: 'object', additionalProperties: true };
const providers = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads'];
// Engine-backed routes proxy the engine response, wrapped as BaseResponse.
const engineEnvelope = object({
  status: { type: 'integer' },
  message: str,
  body: { ...anyObject, description: 'Task record. state: -1 failed, 1 complete, 3 queued, 4 processing.' },
});
// Responses return the DB row shape (snake_case), even though the POST
// form field and the PATCH body take isPrimary.
const imageSchema = object({
  id: str,
  tag: { type: 'string', maxLength: 100, nullable: true },
  description: { type: 'string', maxLength: 500, nullable: true },
  is_primary: { type: 'boolean' },
  created_at: { type: 'string', format: 'date-time' },
  image_url: { type: 'string', nullable: true, description: 'Signed URL; null when signing failed (GET only).' },
  image_url_error: { type: 'boolean', description: 'true when image_url could not be signed (GET only).' },
});
const imageWarnings = { type: 'array', items: str, description: 'Stable warning codes.' };
const clonedVoice = { ...anyObject, description: 'Cloned voice record.' };

const slotIdPath = 'slotId is the slot id returned by generate-and-schedule.';
const ok = success({});

export const operationSchemas = {
  'POST /api/videos/generate-and-schedule': {
    extraResponses: {
      402: 'INSUFFICIENT_TOKENS: the balance does not cover the video.',
      409: 'PERSONA_ALREADY_SCHEDULED: this persona already has an active schedule.',
      502: 'The engine did not accept any video (each one refunded); retry with backoff.',
    },
    request: generateBody,
    response: success({
      schedule: object({ id: str, mode: str }),
      slots: { type: 'array', items: slotResult },
      replayed: { type: 'boolean' },
      warnings: { type: 'array', items: object({ code: str }) },
    }),
  },
  // apps/web/app/api/videos/validate-script/route.ts
  'POST /api/videos/validate-script': {
    request: segmentsBody,
    response: success({
      valid: { type: 'boolean' },
      ...fields(int, ['segmentCount', 'totalWords', 'hookWords', 'bodyWords', 'ctaWords', 'mediaCount']),
      hookWindowSeconds: object({ min: { type: 'number' }, max: { type: 'number' } }),
      measuredDurationSeconds: { type: 'number', nullable: true },
      measured: { type: 'string', enum: ['pending'] },
      measuredReason: str,
    }),
  },
  // apps/web/app/api/videos/score-draft/route.ts (parseBody)
  'POST /api/videos/score-draft': {
    request: object(
      {
        draft: { type: 'string', minLength: 1, maxLength: 10000 },
        network: { type: 'string', enum: ['linkedin', 'youtube', 'instagram', 'bluesky', 'threads'] },
        personaId: { type: 'string', format: 'uuid' },
        kind: { type: 'string', enum: ['post', 'script'] },
      },
      ['draft'],
    ),
    // apps/web/lib/draft-scoring.ts (DraftScore), spread next to success.
    response: success({
      score: { type: 'integer' },
      reasons: { type: 'array', items: object({ rule: str, detail: str, points: { type: 'integer' } }) },
      counts: object({
        ...fields(int, ['chars', 'words', 'hashtags', 'links', 'firstLineWords']),
        slopHits: strArray,
        topThemeMatch: { type: 'string', nullable: true },
      }),
      baseline: object({
        postsMeasured: { type: 'integer' },
        topAngles: { type: 'array', items: object({ angle: str, engagement: { type: 'number' }, posts: { type: 'integer' } }) },
        medianEngagement: { type: 'number', nullable: true },
        bestEngagement: { type: 'number', nullable: true },
        truncated: { type: 'boolean' },
      }),
      publishCheck: {
        ...object({ network: str, ok: { type: 'boolean' }, failures: strArray, warnings: strArray }),
        nullable: true,
        description: 'null for kind "script": caption limits do not apply to spoken text.',
      },
    }),
  },
  // apps/web/app/api/billing/tokens/route.ts
  'GET /api/billing/tokens': {
    response: success({
      balance: { type: 'number', description: 'Paid plus free tokens.' },
      free: { type: 'number' },
    }),
  },
  // apps/web/app/api/persona/route.ts (postHandler: FormData via parsePersonaForm)
  'POST /api/persona': {
    contentType: multipart,
    request: object(personaFields, ['name']),
    response: success({
      personaId: str,
      imageIds: strArray,
      warnings: { type: 'array', items: object({ code: str }) },
    }),
  },
  // patchHandler: personaId in the query, FormData body, every field optional
  'PATCH /api/persona': {
    query: personaIdQuery,
    contentType: multipart,
    request: object(personaFields),
    response: ok,
  },
  // deleteHandler: personaId in the query
  'DELETE /api/persona': { query: personaIdQuery, response: ok },
  // apps/web/app/api/persona/list/route.ts
  'GET /api/persona/list': {
    response: object({
      authenticated: { type: 'boolean' },
      personas: { type: 'array', items: personaSummary },
    }),
  },
  // apps/web/app/api/schedule/route.ts
  'GET /api/schedule': {
    response: success({ schedules: { type: 'array', items: scheduleSummary } }),
  },
  'DELETE /api/schedule': {
    query: [{ name: 'id', required: true }],
    response: success({
      cancelledSlotIds: strArray,
      refunds: { description: 'Token refunds issued for cancelled slots.' },
    }),
  },
  // apps/web/app/api/schedule/slots/[slotId]/route.ts
  'GET /api/schedule/slots/[slotId]': {
    description: `${slotIdPath} The slot post detail fields are returned at the top level next to success.`,
    response: success({}),
  },
  'PATCH /api/schedule/slots/[slotId]': {
    request: object({ title: { type: 'string', minLength: 1 } }, ['title']),
    response: success({ title: str }),
  },
  'DELETE /api/schedule/slots/[slotId]': { response: ok },
  // apps/web/app/api/account/route.ts
  'GET /api/account': {
    response: object({
      authenticated: { type: 'boolean' },
      accounts: { type: 'array', items: anyObject },
      message: str,
    }),
  },
  'DELETE /api/account': {
    query: [
      { name: 'provider', required: true, enum: providers },
      { name: 'providerAccountId', required: true },
    ],
    response: ok,
  },
  // apps/web/app/api/account/connect-url/route.ts
  'POST /api/account/connect-url': {
    request: object({ provider: { type: 'string', enum: ['youtube', 'instagram', 'linkedin', 'threads'] } }, ['provider']),
    response: success({ auth_url: { type: 'string', format: 'uri', description: 'https URL to open in a browser.' } }),
  },
  // apps/web/app/api/bluesky-connect/route.ts (JSON or form body)
  'POST /api/bluesky-connect': {
    request: object({ handle: str, appPassword: str }, ['handle', 'appPassword']),
    response: success({ accountId: str, did: str }),
    extraResponses: { 422: 'Bluesky rejected the handle or app password (code BLUESKY_CREDENTIAL_REJECTED).' },
  },
  // apps/web/app/api/persona/faces/route.ts
  'GET /api/persona/faces': {
    response: object({
      faces: {
        type: 'array',
        items: object({
          id: str, url: str, name: str, gender: str, age: str, ethnicity: str, hair: str, description: str,
        }),
      },
    }),
  },
  // apps/web/app/api/persona/images/route.ts
  'GET /api/persona/images': {
    query: personaIdQuery,
    response: success({ images: { type: 'array', items: imageSchema } }),
  },
  'POST /api/persona/images': {
    contentType: multipart,
    request: object(
      {
        personaId: str,
        image: { type: 'string', format: 'binary' },
        tag: { type: 'string', maxLength: 100 },
        description: { type: 'string', maxLength: 500 },
        isPrimary: { type: 'string', enum: ['true', 'false'] },
      },
      ['personaId', 'image'],
    ),
    response: success({ image: imageSchema, warnings: imageWarnings }),
  },
  'PATCH /api/persona/images': {
    request: object(
      {
        id: str,
        tag: { type: 'string', maxLength: 100 },
        description: { type: 'string', maxLength: 500 },
        isPrimary: { type: 'boolean' },
      },
      ['id'],
    ),
    response: success({ image: { ...imageSchema, nullable: true }, warnings: imageWarnings }),
  },
  'DELETE /api/persona/images': { query: [{ name: 'id', required: true }], response: ok },
  // apps/web/app/api/media/upload/route.ts
  'POST /api/media/upload': {
    contentType: multipart,
    request: object({ file: { type: 'string', format: 'binary', description: 'JPG, PNG or WebP.' } }, ['file']),
    response: success({ mediaId: str, expiresInSeconds: { type: 'integer' } }),
  },
  // apps/web/app/api/media/check/route.ts
  'POST /api/media/check': {
    request: object({ url: { type: 'string', format: 'uri', description: 'http(s) URL.' } }, ['url']),
    response: success({ code: str }),
  },
  ...metricsOperationSchemas({ success, object, anyObject, str }),
  // apps/web/app/api/posts/[id]/route.ts
  'GET /api/posts/[id]': {
    response: success({
      kind: { type: 'string', enum: ['generation', 'slot'] },
      generation: anyObject,
    }),
  },
  // apps/web/app/api/persona/voices/route.ts
  'GET /api/persona/voices': {
    // Verified live: 65 voices, each with these keys.
    response: object({
      voices: {
        type: 'array',
        items: object({ id: str, label: str, provider: str, gender: str, accent: str, kind: str, description: str }),
      },
    }),
  },
  // apps/web/app/api/persona/cloned-voices/**
  'GET /api/persona/cloned-voices': {
    response: success({ voices: { type: 'array', items: clonedVoice } }),
  },
  'POST /api/persona/cloned-voices': {
    contentType: multipart,
    request: object(
      {
        file: { type: 'string', format: 'binary', description: 'Reference audio.' },
        consent: { type: 'string', enum: ['true'], description: 'Voice cloning consent; must be "true".' },
        language: { type: 'string', description: 'English only.' },
        denoise: { type: 'string', enum: ['true', 'false'] },
      },
      ['file', 'consent', 'language', 'denoise'],
    ),
    response: success({ voice: clonedVoice }),
  },
  'GET /api/persona/cloned-voices/[cloneId]': { response: success({ voice: clonedVoice }) },
  'DELETE /api/persona/cloned-voices/[cloneId]': { response: ok },
  'POST /api/persona/cloned-voices/[cloneId]/preview': {
    query: [{ name: 'language', required: false }],
    request: object({ text: { type: 'string', description: 'Optional preview text.' } }),
    responseContent: 'audio/mpeg',
    response: { type: 'string', format: 'binary' },
  },
  // apps/web/app/api/persona/voices/[voiceId]/preview/route.ts
  'POST /api/persona/voices/[voiceId]/preview': {
    request: object({ text: { type: 'string', description: 'Optional preview text.' } }),
    responseContent: 'audio/mpeg',
    response: { type: 'string', format: 'binary' },
  },
  // apps/web/app/api/prompts/route.ts and prompts/[slug]/route.ts
  'GET /api/prompts': { response: success({ prompts: { type: 'array', items: object(fields(str, ['slug', 'title', 'description'])) } }) },
  'GET /api/prompts/[slug]': { response: success({ prompt: object(fields(str, ['slug', 'title', 'description', 'prompt'])) }) },
  // apps/web/app/api/schedule/status/route.ts
  'GET /api/schedule/status': {
    query: [{ name: 'limit', required: false }],
    response: success({
      upcoming: { type: 'array', items: anyObject },
      recent: { type: 'array', items: anyObject },
    }),
  },
  // apps/web/app/api/persona/delete-preview/route.ts
  'GET /api/persona/delete-preview': {
    query: personaIdQuery,
    response: success({
      persona: object({ id: str, name: str }),
      counts: object({
        ...fields(int, ['schedules', 'upcomingSlots', 'publishedSlots', 'failedSlots', 'generatedVideos', 'personaImages']),
      }),
      videos: { type: 'array', items: anyObject },
      videosTruncated: { type: 'boolean' },
      linksIncomplete: { type: 'boolean' },
    }),
  },
  // apps/web/app/api/persona/publishing-accounts/route.ts
  'GET /api/persona/publishing-accounts': {
    query: personaIdQuery,
    response: success({ defaults: anyObject }),
  },
  'PUT /api/persona/publishing-accounts': {
    query: personaIdQuery,
    request: object({
      accounts: { type: 'object', additionalProperties: strArray, description: 'Account ids per provider.' },
    }, ['accounts']),
    response: success({ defaults: anyObject }),
  },
  // apps/web/app/api/persona/video-generations/**
  'GET /api/persona/video-generations': {
    query: [{ name: 'limit', required: false }],
    response: success({ generations: { type: 'array', items: anyObject } }),
  },
  'GET /api/persona/video-generations/[generationId]': {
    response: success({
      generation: object({
        ...fields(str, ['id', 'generationId', 'engineTaskId', 'personaName', 'videoSubject', 'status']),
        errorCode: { type: 'string', nullable: true },
        tokensRefunded: { type: 'boolean' },
      }),
    }),
  },
  // apps/web/app/api/persona/video-status|video-task: engine proxies
  'GET /api/persona/video-status/[taskId]': {
    response: engineEnvelope,
    extraResponses: {
      410: 'Terminal: the engine no longer has this task. Stop polling; GET /api/schedule/slots/{slotId} says whether the video was delivered or failed and refunded.',
      502: 'Engine unavailable or state unverifiable; retry with backoff.',
    },
  },
  'DELETE /api/persona/video-task/[taskId]': {
    response: engineEnvelope,
    extraResponses: { 502: 'Engine unavailable; retry with backoff.' },
  },
  // apps/web/app/api/billing/transactions/route.ts
  'GET /api/billing/transactions': {
    query: [{ name: 'limit', required: false }, { name: 'offset', required: false }],
    response: success({
      transactions: { type: 'array', items: anyObject },
      ...fields(int, ['total', 'limit', 'offset']),
    }),
  },
  // apps/web/app/api/upload-content/route.ts
  'POST /api/upload-content': {
    contentType: multipart,
    description: 'Provider-specific form fields (video file, title, caption) are read by the provider handler; see the MCP publish_video_direct tool.',
    request: object({ provider: { type: 'string', enum: providers }, userId: str }, ['provider']),
    response: object({ success: { type: 'boolean' } }, ['success']),
  },
};
