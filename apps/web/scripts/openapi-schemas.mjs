import { personaCardFormFields, personaCardOperationSchemas } from './openapi-persona-card-schemas.mjs'; import { metricsOperationSchemas } from './openapi-metrics-schemas.mjs'; import { videoOperationSchemas } from './openapi-videos-schemas.mjs'; import { promptOperationSchemas } from './openapi-prompts-schemas.mjs'; import { shareLinkOperationSchemas } from './openapi-share-links-schemas.mjs'; import { OAUTH_CONNECT_PROVIDERS, SCHEDULE_ACCOUNT_COLUMNS, SOCIAL_PROVIDERS as providers } from '../../../shared/contracts/providers.ts';

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
    },
    ['success', 'error'],
  ),
};

const success = (properties) => object({ success: { type: 'boolean', enum: [true] }, ...properties }, ['success']);

const personaFields = { ...personaCardFormFields,
  name: { type: 'string', description: 'Required on create.' },
  photo: { type: 'string', format: 'binary', description: 'Optional. PNG, JPEG or WebP.' },
  publishingAccounts: { type: 'string', description: 'Create only: JSON object of account ids per provider.' },
};
const multipart = 'multipart/form-data';
const personaIdQuery = [{ name: 'personaId', required: true }];

const personaSummary = object({
  ...fields(str, ['id', 'name']),
  createdAt: { type: 'string', format: 'date-time' },
  ...fields(str, ['avatarUrl', 'photoUrl']),
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
  'POST /api/persona': {
    contentType: multipart,
    request: object(personaFields, ['name']),
    response: success({ personaId: str }),
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
    response: success({ cancelledSlotIds: strArray }),
  },
  'GET /api/schedule/slots/[slotId]': {
    description: `slotId is the slot id returned by publish-existing. The slot post detail fields are returned at the top level next to success.`,
    response: success({}),
  },
  'PATCH /api/schedule/slots/[slotId]': {
    description: 'Send title, firstComment or both. firstComment is posted as a comment on the post right after it publishes (YouTube, Instagram, Bluesky, LinkedIn, Threads, Facebook and Telegram; other networks skip it); null or an empty string removes it.',
    request: object({ title: { type: 'string', minLength: 1 }, firstComment: { type: 'string', nullable: true, maxLength: 1000 } }),
    response: success({ title: str, firstComment: { type: 'string', nullable: true } }),
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
  'POST /api/media/publish-existing': {
    request: object(
      {
        media: {
          oneOf: [
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
        firstComment: {
          type: 'string',
          maxLength: 1000,
          description: 'Posted as a comment on the new post of each network that has a comment API (YouTube, Instagram, Bluesky, LinkedIn, Threads, Facebook, Telegram); the others skip it. A failed comment never fails the post: the account result carries a warnings code. It cannot be pinned.',
        },
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
      mediaKind: { type: 'string', enum: ['upload', 'image'] },
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
      402: 'TRIAL_EXPIRED: the free trial ended; publishing and scheduling are blocked.',
    },
  },
  ...metricsOperationSchemas({ success, object, anyObject, str }), ...videoOperationSchemas({ success, object, str }), ...promptOperationSchemas({ success, object, str }), ...shareLinkOperationSchemas({ success, object, str }), ...personaCardOperationSchemas({ success, object, str }),
  'GET /api/posts/[id]': {
    response: success({
      slot: anyObject,
      schedule: anyObject,
      persona: { ...object({ id: str, name: str }), nullable: true },
      prompt: { ...anyObject, nullable: true },
    }),
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
        ...fields(int, ['schedules', 'upcomingSlots', 'publishedSlots', 'failedSlots']),
      }),
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
  'POST /api/upload-content': {
    contentType: multipart,
    description: 'Provider-specific form fields (video file, title, caption) are read by the provider handler; see the MCP publish_video (action: from_file) tool.',
    request: object({ provider: { type: 'string', enum: providers }, userId: str }, ['provider']),
    response: object({ success: { type: 'boolean' } }, ['success']),
    extraResponses: { 402: 'TRIAL_EXPIRED: the free trial ended; publishing is blocked.' },
  },
};
