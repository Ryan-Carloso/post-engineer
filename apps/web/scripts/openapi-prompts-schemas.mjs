export function promptOperationSchemas({ success, object, str }) {
  const visibility = { type: 'string', enum: ['private', 'public'] };
  const summaryFields = {
    slug: str,
    title: str,
    description: str,
    source: {
      type: 'string',
      enum: ['own', 'community'],
      description: 'own: written by the caller. community: a public prompt written by another user, not verified by post-engineer.',
    },
    visibility: { ...visibility, description: 'Community prompts are public; an own prompt is private until its owner makes it public.' },
    verified: { type: 'boolean', description: 'true when Post Engineer checked the prompt. Only Post Engineer sets it.' },
  };
  const summary = object(summaryFields, Object.keys(summaryFields));
  const detailFields = {
    ...summaryFields,
    prompt: str,
    body: { type: 'string', description: 'The stored prompt text as written, the text the edit form loads.' },
    versionId: { type: 'string', format: 'uuid', description: 'The current version of this prompt text. Pass it as promptVersionId when generating a video from this prompt.' },
    version: { type: 'integer', minimum: 1, description: 'Version number: a new one each time the prompt text changes.' },
  };
  const detail = object(detailFields, Object.keys(detailFields));
  const promptResult = object(
    {
      versionId: { type: 'string', format: 'uuid', nullable: true, description: 'null groups the videos made without a prompt.' },
      slug: { type: 'string', nullable: true },
      title: { type: 'string', nullable: true },
      version: { type: 'integer', nullable: true },
      source: { type: 'string', enum: ['official', 'user'], nullable: true },
      videos: { type: 'integer' },
      medianViews: { type: 'number', nullable: true },
      lift: { type: 'number', nullable: true, description: 'Median of each video views divided by the median views of the other videos of the same account.' },
      pValue: { type: 'number', nullable: true, description: 'Two-sided sign test of the lifts against 1.' },
      label: { type: 'string', enum: ['insufficient', 'no_signal', 'indicative', 'clear'] },
      direction: { type: 'string', enum: ['above', 'below'], nullable: true },
    },
    ['versionId', 'slug', 'title', 'version', 'source', 'videos', 'medianViews', 'lift', 'pValue', 'label', 'direction'],
  );
  const accountResult = object(
    {
      provider: str,
      accountId: str,
      videos: { type: 'integer' },
      baselineViews: { type: 'number', nullable: true },
      prompts: { type: 'array', items: promptResult },
    },
    ['provider', 'accountId', 'videos', 'baselineViews', 'prompts'],
  );
  const slug = { type: 'string', maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
  const title = { type: 'string', minLength: 1, maxLength: 120 };
  const description = { type: 'string', maxLength: 500 };
  const text = { type: 'string', minLength: 1, maxLength: 20000 };
  const owned = { 403: 'A persona-scoped API key cannot manage prompts.', 404: 'Unknown prompt, or not yours.' };
  const historyOwned = {
    403: 'A persona-scoped API key cannot manage prompts.',
    404: 'Unknown prompt, not yours, or unknown version (PROMPT_NOT_FOUND, PROMPT_VERSION_NOT_FOUND). The history is owner-only: a public prompt of another user has none to read.',
  };
  const versionId = { type: 'string', format: 'uuid' };
  const versionSummary = object(
    {
      versionId,
      version: { type: 'integer', minimum: 1 },
      title: { ...str, description: 'The title the prompt had when this version was saved.' },
      createdAt: { type: 'string', format: 'date-time' },
      preview: { ...str, description: 'The first 280 characters of the text.' },
      previewTruncated: { type: 'boolean', description: 'true when the text is longer than the preview.' },
      bodyLength: { type: 'integer', minimum: 1, description: 'Length of the full text in characters (code points).' },
      current: { type: 'boolean', description: 'true for the version the prompt text is now.' },
    },
    ['versionId', 'version', 'title', 'createdAt', 'preview', 'previewTruncated', 'bodyLength', 'current'],
  );
  const versionDetail = object(
    {
      versionId,
      version: { type: 'integer', minimum: 1 },
      title: str,
      createdAt: { type: 'string', format: 'date-time' },
      body: { ...str, description: 'The full text of this version.' },
      current: { type: 'boolean' },
    },
    ['versionId', 'version', 'title', 'createdAt', 'body', 'current'],
  );
  const taken = 'The slug is already yours, or used by another public prompt (PROMPT_SLUG_TAKEN).';
  return {
    'GET /api/prompts': {
      query: [{ name: 'q', required: false }, { name: 'source', required: false }],
      response: success({ prompts: { type: 'array', items: summary } }),
    },
    'GET /api/prompts/[slug]': { response: success({ prompt: detail }) },
    'POST /api/prompts': {
      request: { ...object({ slug, title, description, prompt: text, visibility }, ['slug', 'title', 'prompt']), additionalProperties: false },
      response: success({ prompt: detail }),
      extraResponses: { ...owned, 409: taken },
    },
    'PATCH /api/prompts/[slug]': {
      request: { ...object({ title, description, prompt: text, visibility }), additionalProperties: false, minProperties: 1 },
      response: success({ prompt: detail }),
      extraResponses: { ...owned, 409: taken },
    },
    'DELETE /api/prompts/[slug]': { response: success({}), extraResponses: owned },
    'GET /api/prompts/[slug]/versions': {
      query: [{ name: 'limit', required: false }, { name: 'before', required: false }],
      description:
        'Owner-only. Lists the saved texts of your own prompt, newest first. limit is 1 to 50 (default 20). before is a version number from 2 to 999999999: pass nextCursor to read the next page.',
      response: success({
        currentVersion: { type: 'integer', minimum: 1 },
        versions: { type: 'array', items: versionSummary },
        truncated: { type: 'boolean', description: 'true when older versions remain.' },
        nextCursor: { type: 'integer', nullable: true, description: 'Pass it as before to read the next page; null on the last page.' },
      }),
      extraResponses: historyOwned,
    },
    'GET /api/prompts/[slug]/versions/[version]': {
      description: 'Owner-only. Reads one saved text of your own prompt in full.',
      response: success({ version: versionDetail }),
      extraResponses: historyOwned,
    },
    'POST /api/prompts/[slug]/versions/[version]/restore': {
      description:
        'Owner-only. Makes an old version the current text by saving it as a new version; the title stays. Experiment results count the new version separately from the old one. restored is false, and nothing is written, when the text already is the current one.',
      request: {
        ...object({ expectedCurrentVersion: { type: 'integer', minimum: 1, description: 'The currentVersion you read from the list.' } }, ['expectedCurrentVersion']),
        additionalProperties: false,
      },
      response: success({ restored: { type: 'boolean' }, prompt: detail }),
      extraResponses: { ...historyOwned, 409: 'The prompt changed since expectedCurrentVersion (PROMPT_VERSION_CONFLICT). Read the list again.' },
    },
    'GET /api/experiments': {
      query: [{ name: 'window', required: false, enum: ['24h', '7d', '28d'] }],
      response: success({
        window: str,
        accounts: { type: 'array', items: accountResult, description: 'One entry per publishing account: prompts are compared only inside one account.' },
        truncated: { type: 'boolean' },
      }),
    },
    'POST /api/experiments': {
      description:
        'Runs a prompt comparison in two calls. Without quoteKey it is a quote: nothing is charged and the response carries the plan (one slot per video, the prompt versions rotated over the posting times), the total tokens, warnings, a quoteKey and its expiresAt (15 minutes). With the quoteKey and expiresAt of a quote it is the confirm: the total is charged once, one schedule with a slot per video is created and every video is started. A retry with the same quoteKey replays and never charges twice.',
      request: {
        ...object(
          {
            personaId: { type: 'string' },
            account: { ...object({ provider: str, accountId: str }, ['provider', 'accountId']), additionalProperties: false, description: 'The one account that posts every video.' },
            videoType: { type: 'string', enum: ['full_lipsync', 'hook_lipsync', 'voiceover'] },
            options: { type: 'object', description: 'Shared video options: the generate-and-schedule options without videoType and segments.' },
            startAt: { type: 'string', description: 'ISO date-time of the earliest first post.' },
            times: { type: 'array', items: str, minItems: 1, maxItems: 5, description: 'Posting times of day, HH:MM, in timezone.' },
            timezone: str,
            variants: {
              type: 'array',
              minItems: 2,
              maxItems: 4,
              description: 'Prompt versions to compare. Each has the same number of videos (5-15, at most 40 in total, at most 20 when videoType is full_lipsync), each with its own script.',
              items: {
                ...object(
                  {
                    versionId: { type: 'string', format: 'uuid' },
                    videos: { type: 'array', minItems: 5, maxItems: 15, items: object({ title: str, description: str, segments: { type: 'array', items: { type: 'object' } } }, ['title', 'description', 'segments']) },
                  },
                  ['versionId', 'videos'],
                ),
                additionalProperties: false,
              },
            },
            quoteKey: { type: 'string', description: 'The quoteKey of the quote to confirm. Send it with expiresAt, or send neither to get a quote.' },
            expiresAt: { type: 'string', description: 'The expiresAt of that quote.' },
          },
          ['account', 'videoType', 'startAt', 'times', 'timezone', 'variants'],
        ),
        additionalProperties: false,
      },
      response: success({
        stage: { type: 'string', enum: ['quote', 'confirmed'] },
        quoteKey: str,
        expiresAt: str,
        perVideoTokens: { type: 'number' },
        totalTokens: { type: 'number' },
        scheduleId: str,
        replayed: { type: 'boolean' },
        chargedTokens: { type: 'number' },
        slots: { type: 'array', items: { type: 'object' } },
        warnings: { type: 'array', items: { type: 'object' } },
      }),
      extraResponses: {
        402: 'Not enough tokens for the whole experiment (INSUFFICIENT_TOKENS).',
        409: 'The quote expired (QUOTE_EXPIRED) or the price or plan changed since the quote (QUOTE_CHANGED): ask for a new quote.',
      },
    },
  };
}
