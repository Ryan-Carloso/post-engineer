export function promptOperationSchemas({ success, object, str }) {
  const visibility = { type: 'string', enum: ['private', 'public'] };
  const summaryFields = {
    slug: str,
    title: str,
    description: str,
    source: {
      type: 'string',
      enum: ['official', 'own', 'community'],
      description: 'official: shipped with post-engineer. own: written by the caller. community: a public prompt written by another user, not verified by post-engineer.',
    },
    visibility: { ...visibility, description: 'Official and community prompts are public; an own prompt is private until its owner makes it public.' },
  };
  const summary = object(summaryFields, Object.keys(summaryFields));
  const detailFields = {
    ...summaryFields,
    prompt: str,
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
  const taken = 'The slug is reserved by an official prompt (PROMPT_SLUG_RESERVED), already yours, or used by another public prompt (PROMPT_SLUG_TAKEN).';
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
    'GET /api/experiments': {
      query: [{ name: 'window', required: false, enum: ['24h', '7d', '28d'] }],
      response: success({
        window: str,
        accounts: { type: 'array', items: accountResult, description: 'One entry per publishing account: prompts are compared only inside one account.' },
        truncated: { type: 'boolean' },
      }),
    },
  };
}
