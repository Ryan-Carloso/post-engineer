// apiKeys tool descriptions for the post/slot/generation MCP tools.
// Split out of en.ts, which is over the file-size cap and may not grow.
export const postToolDescEn = {
  toolDescGetSlot: 'Get one scheduled post\'s detail',
  toolDescUpdateSlotTitle: 'Edit a scheduled post\'s title',
  toolDescDeleteSlot: 'Delete one scheduled post slot',
  toolDescListVideoGenerations: 'List video generation history',
  toolDescGetVideoGeneration: 'Get one video generation\'s detail',
  toolDescGetPost: "Get one post's detail (slot or generation)",
  toolDescGetPostMetrics: 'Get per-video performance metrics',
  toolDescGetYouTubeRetentionCurve: "Get one of your YouTube videos' retention curve",
  toolDescCancelVideoTask: 'Cancel/remove one of your video tasks',
  toolDescCreateExperiment: 'Create an A/B test of two hook styles',
  toolDescListExperiments: 'List your A/B tests',
  toolDescAddExperimentPair: 'Create both videos of one A/B test pair',
  toolDescGetExperimentResults: 'Compare the two variants of an A/B test',
} as const;
