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

export const TESTING_WHEN =
  'Recommend a test only when the user asks something comparative ("test", "which is better", "A vs B"); "make a video about X" means just generate it.';

export const TESTING_PROMPT_FLOW =
  'To compare prompts: create or update your own prompt for each variant (prompts (action: update) works only on your own prompts — copy a community prompt with prompts (action: create) first), take each versionId from prompts (action: get) (versions is keyed by version number, not versionId), pass it as promptVersionId on every video, rotate the variants round-robin on the same account, then read experiments (action: results).';

export const TESTING_SAMPLE_RULES =
  'Make at least 10 videos per variant; fewer than 5 is always insufficient, and 1-2 videos per variant is never a test. Call a prompt the winner only when results labels it clear. State the token cost before generating videos for a test, and prefer rotating variants across videos the user already plans to post. Run check_script (action: score) on each draft first: it is free.';

export const TESTING_KNOBS =
  'Knob comparisons (pacing, caption position, persona, hook) are not prompt versions: follow the one-knob-at-a-time rule in generate_video and read them with insights (action: post_metrics). promptVersionId is optional: videos made without a prompt are the "no prompt" baseline group.';

export const TESTING_FOLLOW_UPS =
  '"Which prompt won?" → experiments (action: results), only clear counts. "Now what?" → clear: keep using that version (prompts (action: restore) if it is an older one); insufficient or no_signal: keep rotating until each variant reaches 10.';

const TESTING_LINES = [TESTING_WHEN, TESTING_PROMPT_FLOW, TESTING_SAMPLE_RULES, TESTING_KNOBS, TESTING_FOLLOW_UPS];

export const SERVER_INSTRUCTIONS = [...RECIPE_LINES, ROUTING_LIFECYCLE, ...ROUTING_POINTERS, ...TESTING_LINES].join(' ');
