import { batchOperationSchemas } from './openapi-batch-schemas.mjs';

export function metricsOperationSchemas({ success, object, anyObject, str }) {
  return {
    ...batchOperationSchemas({ success, object, str }),
    'GET /api/metrics': {
      query: [
        { name: 'window', required: true, enum: ['24h', '7d', '28d'] },
        ...['persona', 'account', 'provider', 'angle'].map((name) => ({ name, required: false })),
      ],
      response: success({ rows: { type: 'array', items: anyObject }, truncated: { type: 'boolean' } }),
    },
    'GET /api/metrics/retention-curve': {
      extraResponses: {
        403: 'YOUTUBE_ANALYTICS_SCOPE_MISSING or YOUTUBE_RECONNECT_REQUIRED: reconnect YouTube.',
        502: 'YOUTUBE_ANALYTICS_REJECTED or YOUTUBE_ANALYTICS_UNAVAILABLE: retry later.',
      },
      query: [
        { name: 'account', required: true },
        { name: 'video', required: true },
      ],
      response: success({
        points: {
          type: 'array',
          items: object({
            ratio: { type: 'number' },
            audienceWatchRatio: { type: 'number' },
            relativeRetentionPerformance: { type: 'number', nullable: true },
          }),
        },
        startDate: str,
        endDate: str,
        provisional: { type: 'boolean' },
      }),
    },
  };
}
