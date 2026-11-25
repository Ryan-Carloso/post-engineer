const RECIPE_LINES = [
  'post-engineer turns content into scheduled persona videos.',
  'Every video is generated from a complete, validated script — never improvised — and generation always costs prepaid tokens.',
  'When the user asks for a video about a topic — news of the day, a real place with photos, a concrete subject like a car or a product, GitHub pull requests, or first-time setup — call prompts (action: list) first and follow the matching recipe via prompts (action: get) instead of assembling the script yourself.',
  'The recipes pre-validate scripts, media and prices before any token is spent.',
];

export const SERVER_INSTRUCTIONS = [...RECIPE_LINES].join(' ');
