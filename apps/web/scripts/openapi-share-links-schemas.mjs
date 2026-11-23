export function shareLinkOperationSchemas({ success, object, str }) {
  const nullableTime = { type: 'string', format: 'date-time', nullable: true };
  const personaIds = {
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    nullable: true,
    description: 'null: the page shows every persona. A list limits it to those personas.',
  };
  const linkFields = {
    id: { type: 'string', format: 'uuid' },
    personaIds,
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { ...nullableTime, description: 'null: the link never expires.' },
  };
  const link = object(
    { ...linkFields, revokedAt: nullableTime, lastViewedAt: nullableTime },
    ['id', 'personaIds', 'createdAt', 'expiresAt', 'revokedAt', 'lastViewedAt'],
  );
  const scoped = { 403: 'A persona-scoped API key cannot manage share links.' };
  return {
    'POST /api/share-links': {
      description: 'Creates a public read-only link (no login) to the metrics summary of the first 7 days and this week\'s posts. The token is returned once; only its hash is stored. At most 10 links can be active at a time.',
      request: {
        ...object({
          personaIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 50, description: 'Limit the page to these personas. Omit for every persona.' },
          expiresInDays: { type: 'integer', minimum: 1, maximum: 365, description: 'Omit for a link that never expires.' },
        }),
        additionalProperties: false,
      },
      response: success({
        ...linkFields,
        token: { ...str, description: 'Shown once, never again.' },
        path: str,
        url: { ...str, description: 'The public link. Treat it as a secret: anyone who has it can read the page.' },
      }),
      extraResponses: { ...scoped, 404: 'A persona in personaIds is unknown, or not yours.', 409: 'You already have 10 active share links (SHARE_LINK_LIMIT).' },
    },
    'GET /api/share-links': {
      description: 'Lists your share links, newest first, without the token.',
      response: success({ links: { type: 'array', items: link } }),
      extraResponses: scoped,
    },
    'DELETE /api/share-links/[id]': {
      description: 'Revokes a share link at once. Revoking a revoked link succeeds with alreadyRevoked true.',
      response: success({ alreadyRevoked: { type: 'boolean' } }),
      extraResponses: { ...scoped, 404: 'Unknown share link, or not yours.' },
    },
  };
}
