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
  const detail = object({ ...summaryFields, prompt: str }, [...Object.keys(summaryFields), 'prompt']);
  const slug = { type: 'string', maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
  const title = { type: 'string', minLength: 1, maxLength: 120 };
  const description = { type: 'string', maxLength: 500 };
  const text = { type: 'string', minLength: 1, maxLength: 20000 };
  const owned = { 403: 'A persona-scoped API key cannot manage prompts.', 404: 'Unknown prompt, or not yours.' };
  const taken = 'The slug is reserved by an official prompt (PROMPT_SLUG_RESERVED), already yours, or used by another public prompt (PROMPT_SLUG_TAKEN).';
  return {
    'GET /api/prompts': { response: success({ prompts: { type: 'array', items: summary } }) },
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
  };
}
