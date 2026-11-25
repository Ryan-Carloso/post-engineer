const RECIPE_LINES = [
  'post-engineer turns content into scheduled persona videos.',
  'Every video is generated from a complete, validated script — never improvised — and generation always costs prepaid tokens.',
  'When the user asks for a video about a topic — news of the day, a real place with photos, a concrete subject like a car or a product, GitHub pull requests, or first-time setup — call prompts (action: list) first and follow the matching recipe via prompts (action: get) instead of assembling the script yourself.',
  'The recipes pre-validate scripts, media and prices before any token is spent.',
];

export const ROUTING_LIFECYCLE =
  'Where each job lives: generate_video creates videos (charges tokens); publish_video publishes a video that already exists, with no generation and no charge; video_tasks tracks a generation and holds the generation history; schedules changes slots (list, cancel, retitle, delete a slot); posts reads a post\'s status, links and publish results, scheduled or published; insights measures published posts; experiments compares prompts; check_script checks a draft for free before any token is spent.';

export const POINTER_PERSONA_ACCOUNTS =
  'To rebind the accounts a persona publishes to, use accounts (action: set_persona_publishing); personas (action: get) only shows them.';

export const POINTER_IMAGES =
  'A persona\'s face and its library images live in persona_media; an image for one video segment is media (action: upload).';

export const POINTER_POSTS_SCHEDULES =
  'To read a post\'s status, links or publish results, use posts; to cancel, retitle or delete a slot, use schedules.';

export const POINTER_HISTORY =
  'video_tasks (action: list_generations) lists generations; posts (action: list) lists posts with their publish status.';

const ROUTING_POINTERS = [POINTER_PERSONA_ACCOUNTS, POINTER_IMAGES, POINTER_POSTS_SCHEDULES, POINTER_HISTORY];

export const SERVER_INSTRUCTIONS = [...RECIPE_LINES, ROUTING_LIFECYCLE, ...ROUTING_POINTERS].join(' ');
