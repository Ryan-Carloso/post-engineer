export function promptOperationSchemas({ success, object, str }) {
  const status = { type: 'string', enum: ['private', 'pending', 'approved', 'rejected'] };
  const summaryFields = {
    slug: str,
    title: str,
    description: str,
    source: {
      type: 'string',
      enum: ['official', 'own', 'community'],
      description: 'official: shipped with post-engineer. own: written by the caller. community: written by another user and approved by a reviewer, not verified by post-engineer.',
    },
    status: { ...status, nullable: true, description: 'The review status of an own prompt; null for official and community prompts.' },
    rejectionReason: { type: 'string', nullable: true, description: 'Why a reviewer rejected an own prompt; null otherwise.' },
  };
  const summary = object(summaryFields, Object.keys(summaryFields));
  const detail = object({ ...summaryFields, prompt: str }, [...Object.keys(summaryFields), 'prompt']);
  const slug = { type: 'string', maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
  const title = { type: 'string', minLength: 1, maxLength: 120 };
  const description = { type: 'string', maxLength: 500 };
  const text = { type: 'string', minLength: 1, maxLength: 20000 };
  const owned = { 403: 'A persona-scoped API key cannot manage prompts.', 404: 'Unknown prompt, or not yours.' };
  const reviewer = { 403: 'The caller is not a prompt reviewer (PROMPT_REVIEWER_REQUIRED).' };
  return {
    'GET /api/prompts': { response: success({ prompts: { type: 'array', items: summary } }) },
    'GET /api/prompts/[slug]': { response: success({ prompt: detail }) },
    'POST /api/prompts': {
      request: { ...object({ slug, title, description, prompt: text }, ['slug', 'title', 'prompt']), additionalProperties: false },
      response: success({ prompt: detail }),
      extraResponses: { ...owned, 409: 'The slug is reserved by an official prompt (PROMPT_SLUG_RESERVED) or already yours (PROMPT_SLUG_TAKEN).' },
    },
    'PATCH /api/prompts/[slug]': {
      request: { ...object({ title, description, prompt: text }), additionalProperties: false, minProperties: 1 },
      response: success({ prompt: detail }),
      extraResponses: owned,
    },
    'DELETE /api/prompts/[slug]': { response: success({}), extraResponses: owned },
    'POST /api/prompts/[slug]/visibility': {
      request: { ...object({ visibility: { type: 'string', enum: ['public', 'private'] } }, ['visibility']), additionalProperties: false },
      response: success({ prompt: detail }),
      extraResponses: { ...owned, 409: 'The prompt cannot move to that visibility from its current status (PROMPT_STATE_CONFLICT).' },
    },
    'GET /api/admin/prompts': {
      response: success({
        truncated: { type: 'boolean' },
        prompts: {
          type: 'array',
          items: object(
            { id: { type: 'string', format: 'uuid' }, slug: str, title: str, description: str, prompt: str, contentHash: str, authorId: str, requestedAt: str },
            ['id', 'slug', 'title', 'description', 'prompt', 'contentHash', 'authorId', 'requestedAt'],
          ),
        },
      }),
      extraResponses: reviewer,
    },
    'POST /api/admin/prompts/[id]/review': {
      request: {
        ...object(
          {
            decision: { type: 'string', enum: ['approve', 'reject'] },
            contentHash: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'The contentHash read from GET /api/admin/prompts; the decision applies only if the text still has it.' },
            reason: { type: 'string', minLength: 1, maxLength: 500, description: 'Required for reject; shown to the owner.' },
          },
          ['decision', 'contentHash'],
        ),
        additionalProperties: false,
      },
      response: success({ slug: str, status }),
      extraResponses: {
        ...reviewer,
        404: 'Unknown prompt id.',
        409: 'The text changed or the prompt was already reviewed (PROMPT_REVIEW_STALE), or another approved prompt owns the slug (PROMPT_SLUG_TAKEN).',
      },
    },
  };
}
