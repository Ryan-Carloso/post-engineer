// apiKeys lines for direct publish, signed upload, and connect-account.
// Split out of en.ts, which is over the file-size cap and may not grow.
export const videoUploadToolDescEn = {
  toolDescPublishVideoDirect: 'Publish a video directly',
  toolDescCreateVideoUpload: 'Create a signed video upload',
  toolDescCompleteVideoUpload: 'Verify a signed video upload',
  toolDescPublishUploadedVideo: 'Publish an uploaded video by ID',
  toolDescConnectAccount: 'Connect a social account',
} as const;
