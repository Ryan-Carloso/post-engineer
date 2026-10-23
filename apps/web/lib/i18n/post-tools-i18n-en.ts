// apiKeys tool descriptions for the post/slot/generation MCP tools.
// Split out of en.ts, which is over the file-size cap and may not grow.
export const postToolDescEn = {
  toolDescGetSlot: 'Get one scheduled post\'s detail',
  toolDescUpdateSlotTopic: 'Edit a scheduled post\'s topic',
  toolDescDeleteSlot: 'Delete one scheduled post slot',
  toolDescListVideoGenerations: 'List video generation history',
  toolDescGetVideoGeneration: 'Get one video generation\'s detail',
  toolDescGetPost: "Get one post's detail (slot or generation)",
  toolDescGetPostMetrics: 'Get per-video performance metrics',
  toolDescCancelVideoTask: 'Cancel/remove one of your video tasks',
} as const;
