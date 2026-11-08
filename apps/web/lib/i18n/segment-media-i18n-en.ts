// apiKeys tool descriptions for the segments-script video tools and the
// recipe self-serve pair (list_prompts/get_prompt). Split out of en.ts,
// which is over the file-size cap and may not grow.
export const segmentMediaToolDescEn = {
  toolDescGeneratePersonaVideo: 'Generate and schedule one persona video from a script',
  toolDescGeneratePersonaVideoBatch: 'Generate a batch of videos: every 6th face video is free',
  toolDescValidateScript: 'Validate a script mechanically, without spending tokens',
  toolDescScoreDraft: 'Score a draft mechanically against your own measured posts',
  toolDescUploadMedia: 'Upload a segment image (JPG, PNG, WebP, max 8MB)',
  toolDescCheckMedia: 'Check a segment image URL mechanically',
  toolDescListPrompts: 'List the recipe prompts this server can run',
  toolDescGetPrompt: 'Get one recipe prompt by slug',
} as const;
