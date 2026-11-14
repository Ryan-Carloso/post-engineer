// Request/response schemas of the signed-upload video endpoints for
// generate-openapi.mjs, split out because openapi-schemas.mjs is over
// the file-size cap and may not grow. The helpers come in as arguments
// so this module has no import cycle with openapi-schemas.mjs.

const PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue'];

export function videoOperationSchemas({ success, object, str }) {
  return {
    // apps/web/app/api/videos/upload-url/route.ts (parseMintBody)
    'POST /api/videos/upload-url': {
      description:
        'Mint a signed video upload: returns the uploadId, the signedUrl to PUT the video bytes to directly, and the expiry. The upload is bound to the caller and capped at 2GB.',
      request: object(
        {
          contentType: { type: 'string', enum: ['video/mp4', 'video/quicktime'] },
          sizeBytes: { type: 'integer', minimum: 1, maximum: 2147483648 },
        },
        ['contentType', 'sizeBytes'],
      ),
      response: success({
        uploadId: str,
        signedUrl: str,
        token: str,
        storagePath: str,
        expiresAt: str,
        maxBytes: { type: 'integer' },
      }),
      extraResponses: {
        413: 'Declared size over the 2GB video limit.',
        502: 'The signed upload URL could not be created.',
      },
    },
    // apps/web/app/api/videos/uploads/[uploadId]/complete/route.ts
    'POST /api/videos/uploads/[uploadId]/complete': {
      description:
        'Verify a signed video upload after the PUT: the server checks the real content (magic bytes) and size, then marks it ready. Idempotent for an already-ready upload.',
      response: success({
        uploadId: str,
        status: { type: 'string', enum: ['ready'] },
        contentType: { type: 'string', enum: ['video/mp4', 'video/quicktime'] },
        sizeBytes: { type: 'integer' },
      }),
      extraResponses: {
        409: 'The upload was already consumed, or changed while being verified.',
        410: 'The upload expired before completion. Mint a new one.',
        413: 'The stored video is over the 2GB limit.',
      },
    },
    // apps/web/app/api/videos/publish-by-id/route.ts (parsePublishBody)
    'POST /api/videos/publish-by-id': {
      description:
        'Publish a completed signed-upload video by uploadId — the remote replacement for publish_video (action: from_file). Single-use: one publish consumes the upload. Provider field rules mirror publish_video (action: from_file) (YouTube: title, description, tags, privacyStatus; Rumble/Fanvue: title, description; Pinterest: boardId plus description or caption; the rest: caption).',
      request: object(
        {
          uploadId: str,
          provider: { type: 'string', enum: PROVIDERS },
          accountIds: { type: 'array', items: str, minItems: 1 },
          title: str,
          description: str,
          tags: { type: 'array', items: str },
          privacyStatus: { type: 'string', enum: ['public', 'private', 'unlisted'] },
          caption: str,
          boardId: str,
        },
        ['uploadId', 'provider', 'accountIds'],
      ),
      response: success({
        provider: { type: 'string', enum: PROVIDERS },
        results: { type: 'array', items: object({ accountId: str, success: { type: 'boolean' } }, ['accountId', 'success']) },
        successCount: { type: 'integer' },
        logId: str,
      }),
      extraResponses: {
        409: 'The upload is not completed yet, or was already used to publish.',
        410: 'The upload expired before publishing. Mint a new one.',
        413: 'The stored video is over the 2GB limit.',
      },
    },
  };
}
