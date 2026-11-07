// Request/response schemas of the metrics endpoints for generate-openapi.mjs,
// split out of openapi-schemas.mjs (over the file-size cap). The helpers come
// in as arguments so this module has no import cycle with openapi-schemas.mjs.

export function metricsOperationSchemas({ success, object, anyObject, str }) {
  return {
    // apps/web/app/api/metrics/route.ts (KNOWN_PARAMS)
    'GET /api/metrics': {
      // parseMetricsQuery: omitting window returns 400 "window must be 24h, 7d or 28d."
      query: [
        { name: 'window', required: true, enum: ['24h', '7d', '28d'] },
        ...['persona', 'account', 'provider', 'angle'].map((name) => ({ name, required: false })),
      ],
      response: success({ rows: { type: 'array', items: anyObject }, truncated: { type: 'boolean' } }),
    },
    // apps/web/app/api/metrics/retention-curve/route.ts (readParams)
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
