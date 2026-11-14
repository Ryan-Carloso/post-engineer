// apiKeys descriptions of the 16 MCP intent tools (issue #566), shown on the
// MCP docs card. Split out of en.ts, which is over the file-size cap and may not grow.
export const mcpToolDescEn = {
  toolDescGenerateVideo: 'Generate and schedule one video or a batch (every 6th face video is free)',
  toolDescVideoTasks: 'Follow your videos: status, wait, history',
  toolDescCancelVideo: 'Cancel a video that is still generating',
  toolDescPersonas: 'List, create, update and delete personas',
  toolDescPersonaMedia: "Stock faces and a persona's image library",
  toolDescVoices: 'House voices, previews and voice clones',
  toolDescAccounts: 'Connect accounts and choose where a persona publishes',
  toolDescSchedules: 'Your scheduled posts: list, cancel, edit',
  toolDescPosts: 'Your upcoming and published posts',
  toolDescInsights: 'Post metrics and YouTube retention curves',
  toolDescExperiments: 'A/B tests of two hook styles',
  toolDescMedia: 'Upload and check segment images',
  toolDescBilling: 'Token balance and ledger',
  toolDescPrompts: 'The recipe prompts this server can run',
  toolDescCheckScript: 'Validate and score a script without spending tokens',
  toolDescPublishVideo: 'Publish a ready-made video directly',
} as const;
