export function metricsOperationSchemas({ success, object, anyObject, str }) {
  return {
    'GET /api/metrics': {
      query: [
        { name: 'window', required: true, enum: ['24h', '7d', '28d'] },
        ...['persona', 'account', 'provider', 'angle'].map((name) => ({ name, required: false })),
      ],
      response: success({ rows: { type: 'array', items: anyObject }, truncated: { type: 'boolean' } }),
    },
    'GET /api/metrics/last-24h': {
      query: ['persona', 'account', 'provider'].map((name) => ({ name, required: false })),
      response: success({
        rows: { type: 'array', items: anyObject },
        totals: object({
          views: { type: 'number' },
          engagement: { type: 'number' },
          videos: { type: 'number' },
          measurements: { type: 'number' },
        }),
        skipped: object({ noBaseline: { type: 'number' }, stale: { type: 'number' } }),
        counterResets: { type: 'number' },
        truncated: { type: 'boolean' },
        asOf: { type: 'string', nullable: true },
      }),
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
