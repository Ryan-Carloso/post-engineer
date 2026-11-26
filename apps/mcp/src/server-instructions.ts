const RECIPE_LINES = [
  'post-engineer schedules and publishes finished media (videos and images) to social accounts, measures the posts, and compares prompts.',
  'It does not generate video: make the media with your own tool, upload it, then publish it.',
  'When the user asks for copy about a topic — news of the day, a real place, a concrete subject like a car or a product, GitHub pull requests — call prompts (action: list) first and follow the matching prompt via prompts (action: get) instead of assembling the copy yourself.',
];

export const ROUTING_LIFECYCLE =
  'Where each job lives: publish_video uploads media (create_upload, complete_upload) and publishes it now or schedules it (publish_existing); schedules changes slots (cancel, retitle, delete a slot) and lists them; posts reads a post\'s status, links and publish results, scheduled or published; insights measures published posts; experiments compares prompts. The free trial lasts 7 days: after it ends, publish_video and schedules creation fail with TRIAL_EXPIRED and the message names the contact link; reading stays allowed.';

export const POINTER_PERSONA_ACCOUNTS =
  'To rebind the accounts a persona publishes to, use accounts (action: set_persona_publishing); personas (action: get) only shows them.';

export const POINTER_IMAGES =
  'A persona\'s photo is set with personas (action: create or update); its identity card lives in persona_media.';

export const POINTER_POSTS_SCHEDULES =
  'To read a post\'s status, links or publish results, use posts; to cancel, retitle or delete a slot, use schedules.';

export const POINTER_HISTORY =
  'posts (action: list) lists posts with their publish status.';

const ROUTING_POINTERS = [POINTER_PERSONA_ACCOUNTS, POINTER_IMAGES, POINTER_POSTS_SCHEDULES, POINTER_HISTORY];

export const TESTING_WHEN =
  'Recommend a test only when the user asks something comparative ("test", "which is better", "A vs B"); "post this" means just publish it.';

export const TESTING_PROMPT_FLOW =
  'To compare prompts: create or update your own prompt for each variant (prompts (action: update) works only on your own prompts — copy a community prompt with prompts (action: create) first), take each versionId from prompts (action: get) (versions is keyed by version number, not versionId), pass it as promptVersionId when you schedule each post with publish_video (action: publish_existing, mode scheduled), rotate the variants round-robin on the same account, then read experiments (action: results).';

export const TESTING_SAMPLE_RULES =
  'Schedule at least 10 posts per variant; fewer than 5 is always insufficient. Call a prompt the winner only when results labels it clear. Prefer rotating variants across posts the user already plans to make.';

export const TESTING_KNOBS =
  'Other comparisons (posting time, caption style) are read with insights (action: post_metrics). promptVersionId is optional: posts made without a prompt are the "no prompt" baseline group.';

export const TESTING_FOLLOW_UPS =
  '"Which prompt won?" → experiments (action: results), only clear counts. "Now what?" → clear: keep using that version (prompts (action: restore) if it is an older one); insufficient or no_signal: keep rotating until each variant reaches 10.';

const TESTING_LINES = [TESTING_WHEN, TESTING_PROMPT_FLOW, TESTING_SAMPLE_RULES, TESTING_KNOBS, TESTING_FOLLOW_UPS];

export const SERVER_INSTRUCTIONS = [...RECIPE_LINES, ROUTING_LIFECYCLE, ...ROUTING_POINTERS, ...TESTING_LINES].join(' ');
