export function videoTaskOperationSchemas({ engineEnvelope }) {
  return {
    'GET /api/persona/video-status/[taskId]': {
      response: engineEnvelope,
      extraResponses: {
        410: 'Terminal: the engine no longer has this task. Stop polling; GET /api/schedule/slots/{slotId} says whether the video was delivered or failed and refunded.',
        429: 'API-key and OAuth callers may poll one task at most once per minute; a faster poll answers errorType RATE_LIMITED and a Retry-After header with the seconds left. Wait that long before the next poll.',
        502: 'Engine unavailable or state unverifiable; retry with backoff.',
      },
    },
    'DELETE /api/persona/video-task/[taskId]': {
      response: engineEnvelope,
      extraResponses: {
        429: 'At most 10 cancels per minute per user; a faster call answers errorType RATE_LIMITED and a Retry-After header with the seconds left.',
        502: 'Engine unavailable; retry with backoff.',
      },
    },
  };
}
