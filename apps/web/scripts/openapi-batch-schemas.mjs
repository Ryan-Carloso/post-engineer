// Request/response schema of POST /api/videos/batch-discount (issue #487)
// for generate-openapi.mjs. Reached through openapi-metrics-schemas.mjs
// because openapi-schemas.mjs is over the file-size cap. The helpers come in
// as arguments so this module has no import cycle with openapi-schemas.mjs.

export function batchOperationSchemas({ success, object, str }) {
  const freeVideo = object(
    { scheduleId: str, slotId: str, discountTokens: { type: 'integer', minimum: 1 } },
    ['scheduleId', 'slotId', 'discountTokens'],
  );
  return {
    // apps/web/app/api/videos/batch-discount/route.ts (BodySchema)
    'POST /api/videos/batch-discount': {
      extraResponses: {
        404: 'SCHEDULE_NOT_FOUND: a schedule does not exist, is not yours, or has no video.',
        409: 'BATCH_CONFLICT: a video already belongs to another batch; BATCH_WINDOW_EXCEEDED: the videos were not created within 10 minutes of the first.',
      },
      request: object(
        {
          batchKey: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' },
          scheduleIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 12 },
        },
        ['batchKey', 'scheduleIds'],
      ),
      response: success({
        batchId: str,
        videos: { type: 'integer' },
        faceVideos: { type: 'integer' },
        earnedFreeVideos: { type: 'integer' },
        freeVideos: { type: 'array', items: freeVideo },
        discountTokens: { type: 'integer' },
        chargedTokens: { type: 'integer' },
        warnings: { type: 'array', items: str, description: 'Stable warning codes: BATCH_DISCOUNT_CREDIT_FAILED, BATCH_DISCOUNT_SLOT_UPDATE_FAILED.' },
      }),
    },
  };
}
