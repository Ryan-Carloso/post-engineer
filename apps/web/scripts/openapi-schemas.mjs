import { metricsOperationSchemas } from './openapi-metrics-schemas.mjs'; import { videoOperationSchemas } from './openapi-videos-schemas.mjs'; import { promptOperationSchemas } from './openapi-prompts-schemas.mjs'; import { shareLinkOperationSchemas } from './openapi-share-links-schemas.mjs'; import { OAUTH_CONNECT_PROVIDERS, SCHEDULE_ACCOUNT_COLUMNS, SOCIAL_PROVIDERS as providers } from '../../../shared/contracts/providers.ts';

const object = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});
const str = { type: 'string' };
const strArray = { type: 'array', items: str };
const int = { type: 'integer' };
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
      kind: { type: 'string', enum: ['hook', 'content'] },
      text: str,
      cta: { type: 'boolean', description: "Marks the take that performs this video's CTA (issue #639)." },
      media: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, properties: { mediaId: str, url: str } } },
    },
  },
};

const segmentsBody = object(
  {
    segments: {
      type: 'array',
      description: 'Segments in order: hook first, then content takes. 60-200 words in total.',
      items: { $ref: '#/components/schemas/Segment' },
    },
    fullLipsync: {
      type: 'boolean',
      description: 'Optional. Media is optional when true (full lip sync); otherwise every segment needs a media list, about one image per ~2s, at most 30.',
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

const generateBody = object(
  {
    personaId: { type: 'string', description: 'Optional: a faceless post needs no persona.' },
    title: { type: 'string', description: 'Slot label.' },
    publishing: object(
      {
        mode: { type: 'string', enum: ['scheduled', 'asap'], default: 'scheduled' },
        providers: { ...strArray, maxItems: 20 },
        accounts: { type: 'object', additionalProperties: strArray },
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
    }, ['segments']),
    promptVersionId: { type: 'string', format: 'uuid', description: 'The versionId returned with the prompt (GET /api/prompts/[slug]) this script was written from. Experiments compare videos by prompt version; omit when the script was not written from a prompt.' },
    idempotencyKey: str,
    cta: {
      type: 'object',
      nullable: true,
      description: 'Per-video CTA override (issue #639): explicit wins over the persona default; null disables the CTA for this video.',
      properties: {
        type: { type: 'string', enum: ['follow', 'comment', 'share', 'save', 'link', 'buy', 'other'] },
        url: { type: 'string', maxLength: 2048 },
        instruction: { type: 'string', maxLength: 500 },
      },
      required: ['type'],
      additionalProperties: false,
    },
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
  ctaType: { type: 'string', enum: ['follow', 'comment', 'share', 'save', 'link', 'buy', 'other'] },
  ctaUrl: { type: 'string', maxLength: 2048 },
  ctaInstruction: { type: 'string', maxLength: 500 },
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
  ...fields(str, ['videoAspect', 'videoLayout', 'scriptPrompt', 'ctaType', 'ctaUrl', 'ctaInstruction']),
  paragraphNumber: int,
  ...fields(str, ['niche', 'faceQuality']),
});

const scheduleSummary = object({
  id: str,
  persona_id: { type: 'string', nullable: true },
  providers: strArray,
  ...fields(strArray, Object.values(SCHEDULE_ACCOUNT_COLUMNS)),
  days_of_week: { type: 'array', items: int },
  ...fields(int, ['start_hour', 'end_hour', 'posts_per_day']),
  timezone: str,
  active: { type: 'boolean' },
  created_at: { type: 'string', format: 'date-time' },
  publish_mode: str,
});

const anyObject = { type: 'object', additionalProperties: true };
const engineEnvelope = object({
  status: { type: 'integer' },
  message: str,
  body: { ...anyObject, description: 'Task record. state: -1 failed, 1 complete, 3 queued, 4 processing.' },
});
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

const toolConfigPresence = {
  configured: { type: 'boolean' },
  searchTool: { type: 'string', enum: ['tavily', 'exa', 'own'], nullable: true },
  stockSources: { type: 'array', items: { type: 'string', enum: ['pexels', 'pixabay', 'coverr'] } },
  keysPresent: object(
    fields({ type: 'boolean' }, ['tavily', 'exa', 'pexels', 'pixabay', 'coverr']),
    ['tavily', 'exa', 'pexels', 'pixabay', 'coverr'],
  ),
  keysLast4: object(
    fields({ type: 'string', nullable: true }, ['tavily', 'exa', 'pexels', 'pixabay', 'coverr']),
    ['tavily', 'exa', 'pexels', 'pixabay', 'coverr'],
  ),
};

export const operationSchemas = {
  'POST /api/videos/generate-and-schedule': {
    extraResponses: {
      402: 'INSUFFICIENT_TOKENS: the balance does not cover the video.',
      409: 'PERSONA_ALREADY_SCHEDULED: this persona already has an active schedule. IDEMPOTENCY_KEY_CONSUMED: the idempotency key belongs to a deleted schedule; send a new key.',
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
  'POST /api/videos/validate-script': {
    request: segmentsBody,
    response: success({
      valid: { type: 'boolean' },
      ...fields(int, ['segmentCount', 'totalWords', 'hookWords', 'contentWords', 'mediaCount']),
      hookWindowSeconds: object({ min: { type: 'number' }, max: { type: 'number' } }),
      measuredDurationSeconds: { type: 'number', nullable: true },
      measured: { type: 'string', enum: ['pending'] },
      measuredReason: str,
    }),
  },
  'POST /api/videos/score-draft': {
    request: object(
      {
        draft: { type: 'string', minLength: 1, maxLength: 10000 },
        network: { type: 'string', enum: [...providers] },
        personaId: { type: 'string', format: 'uuid' },
        kind: { type: 'string', enum: ['post', 'script'] },
      },
      ['draft'],
    ),
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
  'GET /api/billing/tokens': {
    response: success({
      balance: { type: 'number', description: 'Paid plus free tokens.' },
      free: { type: 'number' },
    }),
  },
  'POST /api/persona': {
    contentType: multipart,
    request: object(personaFields, ['name']),
    response: success({
      personaId: str,
      imageIds: strArray,
      warnings: { type: 'array', items: object({ code: str }) },
    }),
  },
  'PATCH /api/persona': {
    query: personaIdQuery,
    contentType: multipart,
    request: object(personaFields),
    response: ok,
  },
  'DELETE /api/persona': { query: personaIdQuery, response: ok },
  'GET /api/persona/list': {
    response: object({
      authenticated: { type: 'boolean' },
      personas: { type: 'array', items: personaSummary },
    }),
  },
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
  'GET /api/schedule/slots/[slotId]': {
    description: `${slotIdPath} The slot post detail fields are returned at the top level next to success.`,
    response: success({}),
  },
  'PATCH /api/schedule/slots/[slotId]': {
    request: object({ title: { type: 'string', minLength: 1 } }, ['title']),
    response: success({ title: str }),
  },
  'DELETE /api/schedule/slots/[slotId]': { response: ok },
  'GET /api/account': {
    response: object({
      authenticated: { type: 'boolean' },
      accounts: { type: 'array', items: anyObject },
      message: str,
    }),
  },
  'GET /api/tool-config': {
    response: success(toolConfigPresence),
  },
  'PUT /api/tool-config': {
    request: object(
      {
        searchTool: { type: 'string', enum: ['tavily', 'exa', 'own'], nullable: true },
        stockSources: { type: 'array', items: { type: 'string', enum: ['pexels', 'pixabay', 'coverr'] } },
        keys: object(fields({ ...str, minLength: 1, maxLength: 512 }, ['tavily', 'exa', 'pexels', 'pixabay', 'coverr'])),
      },
      ['searchTool', 'stockSources', 'keys'],
    ),
    response: success({ ...toolConfigPresence, configured: { type: 'boolean', enum: [true] } }),
  },
  'GET /api/pinterest/boards': {
    query: [{ name: 'accountId', required: true, description: 'Pinterest user id stored at OAuth connect.' }],
    response: success({
      boards: {
        type: 'array',
        items: object(
          {
            id: str,
            name: { type: 'string', nullable: true },
            description: { type: 'string', nullable: true },
          },
          ['id'],
        ),
      },
    }),
  },
  'DELETE /api/account': {
    query: [
      { name: 'provider', required: true, enum: providers },
      { name: 'providerAccountId', required: true },
    ],
    response: ok,
  },
  'POST /api/account/connect-url': {
    request: object({ provider: { type: 'string', enum: [...OAUTH_CONNECT_PROVIDERS] } }, ['provider']),
    response: success({ auth_url: { type: 'string', format: 'uri', description: 'https URL to open in a browser.' } }),
  },
  'POST /api/bluesky-connect': {
    request: object({ handle: str, appPassword: str }, ['handle', 'appPassword']),
    response: success({ accountId: str, did: str }),
    extraResponses: { 422: 'Bluesky rejected the handle or app password (code BLUESKY_CREDENTIAL_REJECTED).' },
  },
  'POST /api/threespeak-connect': {
    request: object({ username: str, postingKey: str }, ['username', 'postingKey']),
    response: success({ accountId: str, username: str }),
    extraResponses: { 422: '3Speak rejected the username or posting key (code THREESPEAK_CREDENTIAL_REJECTED).' },
  },
  'POST /api/rumble-connect': {
    request: object({ channelId: str, accessToken: str }, ['channelId', 'accessToken']),
    response: success({ accountId: str, channelId: str }),
  },
  'POST /api/telegram-connect': {
    request: object(
      {
        botToken: { type: 'string', description: 'Bot token issued by @BotFather.' },
        chatId: { type: 'string', description: 'Public @username or numeric chat ID of the channel or group.' },
        chatType: { type: 'string', enum: ['channel', 'group'], description: 'The destination kind; checked against the real chat.' },
      },
      ['botToken', 'chatId', 'chatType'],
    ),
    response: success({ accountId: str, chatId: str, chatType: { type: 'string', enum: ['channel', 'group', 'supergroup'] }, title: str }),
    extraResponses: {
      403: 'The bot is not in the chat or cannot post there (code TELEGRAM_BOT_NOT_MEMBER or TELEGRAM_BOT_CANNOT_POST).',
      404: 'Telegram could not find the chat (code TELEGRAM_CHAT_NOT_FOUND).',
      422: 'Telegram rejected the bot token (code TELEGRAM_TOKEN_REJECTED).',
    },
  },
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
  'POST /api/media/upload': {
    contentType: multipart,
    request: object({ file: { type: 'string', format: 'binary', description: 'JPG, PNG or WebP.' } }, ['file']),
    response: success({ mediaId: str, expiresInSeconds: { type: 'integer' } }),
  },
  'POST /api/media/publish-existing': {
    request: object(
      {
        media: {
          oneOf: [
            object({ kind: { type: 'string', enum: ['task'] }, taskId: str }, ['kind', 'taskId']),
            object(
              { kind: { type: 'string', enum: ['upload'] }, uploadId: { type: 'string', format: 'uuid' } },
              ['kind', 'uploadId'],
            ),
            object(
              {
                kind: { type: 'string', enum: ['image'] },
                imageData: { type: 'string', description: 'Base64 image bytes (JPEG or PNG, at most 8 MB).' },
                contentType: { type: 'string', enum: ['image/jpeg', 'image/png'] },
              },
              ['kind', 'imageData', 'contentType'],
            ),
          ],
        },
        title: str,
        description: str,
        personaId: str,
        publishing: object(
          {
            mode: { type: 'string', enum: ['scheduled', 'asap'] },
            providers: { type: 'array', items: str, minItems: 1 },
            accounts: { type: 'object', additionalProperties: strArray },
            schedule: object(
              {
                publishAt: {
                  type: 'string',
                  description: 'The one moment to publish (3h-30d ahead): with an offset, or wall-clock in timezone.',
                },
                timezone: str,
              },
              ['publishAt', 'timezone'],
            ),
            pinterestBoardId: str,
          },
          ['mode', 'providers'],
        ),
        tags: strArray,
        privacyStatus: str,
        caption: str,
        idempotencyKey: {
          type: 'string',
          description: 'Retry with the same key: scheduled replays the schedule, asap replays the recorded posts per account.',
        },
      },
      ['media', 'title', 'description', 'publishing'],
    ),
    response: success({
      mode: { type: 'string', enum: ['scheduled', 'asap'] },
      replayed: { type: 'boolean' },
      schedule: object({ id: str }),
      slots: {
        type: 'array',
        items: object({ id: str, slot_at: { type: 'string', format: 'date-time' }, title: str, status: str }),
      },
      mediaKind: { type: 'string', enum: ['task', 'upload', 'image'] },
      publishes: {
        type: 'array',
        items: object({ provider: str, success: { type: 'boolean' }, results: { type: 'array', items: anyObject } }),
      },
      logId: str,
    }),
    extraResponses: {
      409: 'The video upload was already used to publish, is already scheduled, or is not completed yet.',
      410: 'The video upload expired before publishing. Mint a new one.',
      413: 'The finished video is over the 2GB limit.',
      502: 'The video service is unavailable.',
    },
  },
  'POST /api/media/check': {
    request: object({ url: { type: 'string', format: 'uri', description: 'http(s) URL.' } }, ['url']),
    response: success({ code: str }),
  },
  ...metricsOperationSchemas({ success, object, anyObject, str }), ...videoOperationSchemas({ success, object, str }), ...promptOperationSchemas({ success, object, str }), ...shareLinkOperationSchemas({ success, object, str }),
  'GET /api/posts/[id]': {
    response: success({
      kind: { type: 'string', enum: ['generation', 'slot'] },
      generation: anyObject,
    }),
  },
  'GET /api/persona/voices': {
    response: object({
      voices: {
        type: 'array',
        items: object({ id: str, label: str, provider: str, gender: str, accent: str, kind: str, description: str }),
      },
    }),
  },
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
  'POST /api/persona/voices/[voiceId]/preview': {
    request: object({ text: { type: 'string', description: 'Optional preview text.' } }),
    responseContent: 'audio/mpeg',
    response: { type: 'string', format: 'binary' },
  },
  'GET /api/schedule/status': {
    query: [{ name: 'limit', required: false }, { name: 'from', required: false }, { name: 'to', required: false }],
    response: success({
      upcoming: { type: 'array', items: anyObject },
      recent: { type: 'array', items: anyObject },
      slots: { type: 'array', items: anyObject, description: 'Range mode only: every slot with slot_at in [from, to).' },
      truncated: { type: 'boolean', description: 'Range mode only: true when the slot cap was hit.' },
    }),
  },
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
  'GET /api/billing/transactions': {
    query: [{ name: 'limit', required: false }, { name: 'offset', required: false }],
    response: success({
      transactions: { type: 'array', items: anyObject },
      ...fields(int, ['total', 'limit', 'offset']),
    }),
  },
  'POST /api/upload-content': {
    contentType: multipart,
    description: 'Provider-specific form fields (video file, title, caption) are read by the provider handler; see the MCP publish_video (action: from_file) tool.',
    request: object({ provider: { type: 'string', enum: providers }, userId: str }, ['provider']),
    response: object({ success: { type: 'boolean' } }, ['success']),
  },
};
