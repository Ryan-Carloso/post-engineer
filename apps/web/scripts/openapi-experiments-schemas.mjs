export const experimentLinkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['experimentId', 'variantId', 'pair'],
  description: 'Join a paired A/B experiment: this video is one variant of one pair. Checked before the charge.',
  properties: {
    experimentId: { type: 'string', format: 'uuid' },
    variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,47}$' },
    pair: { type: 'integer', minimum: 1, maximum: 20 },
  },
};

export function experimentOperationSchemas({ success, object, anyObject, str }) {
  const variant = object(
    {
      variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,47}$' },
      name: { type: 'string', minLength: 1, maxLength: 80 },
      description: { type: 'string', minLength: 1, maxLength: 500 },
    },
    ['variantId', 'name', 'description'],
  );
  return {
    'POST /api/experiments': {
      request: object(
        {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          variable: { type: 'string', enum: ['hook'] },
          personaId: { type: 'string', format: 'uuid', nullable: true, description: 'Omit or null for a faceless experiment.' },
          targetPairs: { type: 'integer', minimum: 3, maximum: 20 },
          variants: { type: 'array', items: variant, minItems: 2, maxItems: 2 },
        },
        ['name', 'variable', 'targetPairs', 'variants'],
      ),
      response: success({ experiment: anyObject }),
    },
    'GET /api/experiments': {
      response: success({ experiments: { type: 'array', items: anyObject }, truncated: { type: 'boolean' } }),
    },
    'GET /api/experiments/[id]': {
      query: [{ name: 'window', required: false, enum: ['24h', '7d', '28d'] }],
      response: success({
        experiment: anyObject,
        window: str,
        videos: { type: 'array', items: anyObject },
        results: anyObject,
        truncated: { type: 'boolean' },
      }),
    },
  };
}
